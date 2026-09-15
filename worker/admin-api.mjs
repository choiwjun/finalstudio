import {
  clearSessionCookie,
  createSessionToken,
  isAuthenticated,
  MIN_ADMIN_PASSWORD_LENGTH,
  sameOrigin,
  sessionCookie,
} from "./admin-auth.mjs";
import {
  adminKeywordRow,
  adminPostRow,
  validateAdminPost,
} from "./admin-data.mjs";
import { json } from "./http.mjs";

const MAX_JSON_BYTES = 300_000;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const ALLOWED_CATEGORIES = new Set(["economy-business", "ai", "travel"]);
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const GITHUB_WORKFLOW_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const loginFailures = new Map();

function clientKey(request) {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

function loginBlocked(request, now) {
  const entry = loginFailures.get(clientKey(request));
  return (
    entry &&
    now - entry.startedAt < FAILURE_WINDOW_MS &&
    entry.count >= MAX_LOGIN_FAILURES
  );
}

function recordLoginFailure(request, now) {
  const key = clientKey(request);
  const previous = loginFailures.get(key);
  const entry =
    previous && now - previous.startedAt < FAILURE_WINDOW_MS
      ? { startedAt: previous.startedAt, count: previous.count + 1 }
      : { startedAt: now, count: 1 };
  loginFailures.set(key, entry);
}

function clearLoginFailures(request) {
  loginFailures.delete(clientKey(request));
}

async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > MAX_JSON_BYTES) throw new Error("payload too large");
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) throw new Error("payload too large");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error("invalid JSON");
  }
}

function adminNotConfigured(env) {
  return (
    typeof env?.ADMIN_PASSWORD !== "string" ||
    env.ADMIN_PASSWORD.length < MIN_ADMIN_PASSWORD_LENGTH
  );
}

function requiresSameOrigin(request) {
  return sameOrigin(request)
    ? null
    : json({ ok: false, error: "origin_not_allowed" }, 403);
}

async function login(request, env) {
  if (request.method !== "POST")
    return json({ ok: false, error: "method_not_allowed" }, 405);
  const originError = requiresSameOrigin(request);
  if (originError) return originError;
  if (adminNotConfigured(env))
    return json({ ok: false, error: "admin_not_configured" }, 503);
  const now = Date.now();
  if (loginBlocked(request, now))
    return json({ ok: false, error: "too_many_attempts" }, 429);
  let body;
  try {
    body = await readJson(request);
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }
  if (
    typeof body.password !== "string" ||
    body.password.length < MIN_ADMIN_PASSWORD_LENGTH ||
    body.password.length > 256
  ) {
    recordLoginFailure(request, now);
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }
  if (!(await secureEqualText(body.password, env.ADMIN_PASSWORD))) {
    recordLoginFailure(request, now);
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }
  clearLoginFailures(request);
  const token = await createSessionToken(
    env.ADMIN_PASSWORD,
    Math.floor(now / 1000),
  );
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(token) });
}

async function logout(request) {
  if (request.method !== "POST")
    return json({ ok: false, error: "method_not_allowed" }, 405);
  const originError = requiresSameOrigin(request);
  if (originError) return originError;
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
}

async function session(request, env) {
  if (request.method !== "GET")
    return json({ ok: false, error: "method_not_allowed" }, 405);
  return json({ ok: true, authenticated: await isAuthenticated(request, env) });
}

async function requireAdmin(request, env) {
  if (adminNotConfigured(env))
    return json({ ok: false, error: "admin_not_configured" }, 503);
  if (!(await isAuthenticated(request, env)))
    return json({ ok: false, error: "authentication_required" }, 401);
  return null;
}

async function listAdminPosts(sql) {
  const rows = await sql`
    SELECT slug, title, description, pub_date, publish_at, status, topic, angle, author, body_markdown, payload, updated_at
    FROM posts
    ORDER BY updated_at DESC, slug ASC
  `;
  return json({
    ok: true,
    data: rows.map(adminPostRow),
    meta: { count: rows.length },
  });
}

async function listAdminKeywords(sql) {
  const rows = await sql`
    SELECT record_key, category, head_keyword, status, collected_at, payload
    FROM keyword_records
    ORDER BY collected_at DESC, head_keyword ASC
  `;
  return json({
    ok: true,
    data: rows.map(adminKeywordRow),
    meta: { count: rows.length },
  });
}

function githubAutomationConfig(env) {
  const token = typeof env?.GITHUB_TOKEN === "string" ? env.GITHUB_TOKEN.trim() : "";
  const repository = typeof env?.GITHUB_REPOSITORY === "string" && env.GITHUB_REPOSITORY.trim()
    ? env.GITHUB_REPOSITORY.trim()
    : "choiwjun/finalstudio";
  const workflow = typeof env?.GITHUB_WORKFLOW === "string" && env.GITHUB_WORKFLOW.trim()
    ? env.GITHUB_WORKFLOW.trim()
    : "keyword-auto-draft.yml";
  if (!token) return { error: "automation_not_configured" };
  if (!GITHUB_REPOSITORY_PATTERN.test(repository) || !GITHUB_WORKFLOW_PATTERN.test(workflow))
    return { error: "automation_configuration_invalid" };
  return { token, repository, workflow };
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "wjblog-admin",
  };
}

async function requestAutoDraftStatus(request, env) {
  if (request.method !== "GET")
    return json({ ok: false, error: "method_not_allowed" }, 405);
  const requestId = new URL(request.url).searchParams.get("request_id")?.trim() ?? "";
  if (!REQUEST_ID_PATTERN.test(requestId))
    return json({ ok: false, error: "invalid_request_id" }, 400);
  const config = githubAutomationConfig(env);
  if ("error" in config)
    return json({ ok: false, error: config.error }, 503);
  try {
    const runsResponse = await fetch(
      `https://api.github.com/repos/${config.repository}/actions/workflows/${config.workflow}/runs?event=workflow_dispatch&branch=main&per_page=20`,
      { headers: githubHeaders(config.token) },
    );
    if (!runsResponse.ok)
      return json({ ok: false, error: "automation_status_unavailable" }, 502);
    const runs = await runsResponse.json();
    const run = (runs.workflow_runs ?? []).find((candidate) =>
      typeof candidate?.display_title === "string" && candidate.display_title.startsWith(`Keyword draft ${requestId} /`),
    );
    if (!run) return json({ ok: true, status: "queued", requestId });
    const status = run.status === "completed" ? "completed" : "running";
    const stages = [];
    if (run.status === "completed" || run.status === "in_progress") {
      const runId = Number(run.id);
      if (Number.isSafeInteger(runId) && runId > 0) {
        const jobsResponse = await fetch(
          `https://api.github.com/repos/${config.repository}/actions/runs/${runId}/jobs?per_page=20`,
          { headers: githubHeaders(config.token) },
        );
        if (jobsResponse.ok) {
          const jobs = await jobsResponse.json();
          for (const job of jobs.jobs ?? []) {
            for (const step of job.steps ?? [])
              stages.push({ name: step.name, status: step.status, conclusion: step.conclusion });
          }
        }
      }
    }
    return json({
      ok: true,
      status,
      conclusion: run.conclusion,
      requestId,
      url: typeof run.html_url === "string" ? run.html_url : undefined,
      stages,
      failureReason: run.conclusion === "failure" ? "생성 단계 또는 품질 게이트가 실패했습니다." : undefined,
    });
  } catch (error) {
    console.error("GitHub workflow status request failed", error);
    return json({ ok: false, error: "automation_status_unavailable" }, 502);
  }
}

async function requestAutoDraft(request, env, sql) {
  if (request.method !== "POST")
    return json({ ok: false, error: "method_not_allowed" }, 405);
  let body;
  try {
    body = await readJson(request);
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
  if (
    !ALLOWED_CATEGORIES.has(category) ||
    keyword === "" ||
    keyword.length > 300 ||
    CONTROL_CHARACTER_PATTERN.test(keyword)
  )
    return json({ ok: false, error: "invalid_keyword_selection" }, 400);

  const rows = await sql`
    SELECT record_key
    FROM keyword_records
    WHERE category = ${category} AND head_keyword = ${keyword} AND status = 'ready-to-write'
    LIMIT 1
  `;
  if (rows.length === 0)
    return json({ ok: false, error: "keyword_not_ready" }, 409);

  const config = githubAutomationConfig(env);
  if ("error" in config)
    return json({ ok: false, error: config.error }, 503);
  const requestId = crypto.randomUUID();
  let response;
  try {
    response = await fetch(
      `https://api.github.com/repos/${config.repository}/actions/workflows/${config.workflow}/dispatches`,
      {
        method: "POST",
        headers: { ...githubHeaders(config.token), "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "main", inputs: { category, keyword, request_id: requestId } }),
      },
    );
  } catch (error) {
    console.error("GitHub workflow dispatch request failed", error);
    return json({ ok: false, error: "automation_dispatch_failed" }, 502);
  }
  if (!response.ok) {
    console.error("GitHub workflow dispatch failed", response.status);
    return json({ ok: false, error: "automation_dispatch_failed" }, 502);
  }
  return json({ ok: true, status: "queued", category, keyword, requestId });
}

async function saveAdminPost(request, sql) {
  if (request.method !== "PUT")
    return json({ ok: false, error: "method_not_allowed" }, 405);
  let body;
  try {
    body = await readJson(request);
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }
  let post;
  try {
    post = validateAdminPost(body);
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "invalid_post",
      },
      422,
    );
  }
  const payload = JSON.stringify(post.metadata);
  const rows = await sql`
    INSERT INTO posts (slug, title, description, pub_date, publish_at, status, topic, angle, author, body_markdown, content_hash, payload)
    VALUES (
      ${post.slug}, ${post.title}, ${post.description}, ${post.pubDate}, ${post.publishAt}, ${post.status},
      ${post.topic}, ${post.angle}, ${post.author}, ${post.bodyMarkdown}, ${await hash(post.bodyMarkdown)}, ${payload}::jsonb
    )
    ON CONFLICT (slug) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      pub_date = EXCLUDED.pub_date,
      publish_at = EXCLUDED.publish_at,
      status = EXCLUDED.status,
      topic = EXCLUDED.topic,
      angle = EXCLUDED.angle,
      author = EXCLUDED.author,
      body_markdown = EXCLUDED.body_markdown,
      content_hash = EXCLUDED.content_hash,
      payload = EXCLUDED.payload,
      updated_at = now()
    RETURNING slug, title, description, pub_date, publish_at, status, topic, angle, author, body_markdown, payload, updated_at
  `;
  return json({ ok: true, data: adminPostRow(rows[0]) });
}

async function deleteAdminPost(request, sql, slug) {
  if (request.method !== "DELETE")
    return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(slug))
    return json({ ok: false, error: "invalid_slug" }, 400);
  const rows = await sql`
    DELETE FROM posts
    WHERE slug = ${slug}
    RETURNING slug
  `;
  if (rows.length === 0)
    return json({ ok: false, error: "post_not_found" }, 404);
  return json({ ok: true, data: { slug } });
}

async function secureEqualText(left, right) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1)
    difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

async function hash(value) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function handleAdminRequest({ request, url, env, connect }) {
  if (url.pathname === "/api/admin/login") return login(request, env);
  if (url.pathname === "/api/admin/logout") return logout(request);
  if (url.pathname === "/api/admin/session") return session(request, env);
  if (!url.pathname.startsWith("/api/admin/")) return null;

  const authError = await requireAdmin(request, env);
  if (authError) return authError;
  if (["POST", "PUT", "DELETE"].includes(request.method)) {
    const originError = requiresSameOrigin(request);
    if (originError) return originError;
  }
  if (url.pathname === "/api/admin/auto-draft/status")
    return requestAutoDraftStatus(request, env);

  let sql;
  try {
    sql = connect(env.DATABASE_URL);
    if (url.pathname === "/api/admin/posts") {
      if (request.method === "GET") return listAdminPosts(sql);
      return saveAdminPost(request, sql);
    }
    if (url.pathname.startsWith("/api/admin/posts/")) {
      const slug = decodeURIComponent(
        url.pathname.slice("/api/admin/posts/".length),
      );
      return deleteAdminPost(request, sql, slug);
    }
    if (url.pathname === "/api/admin/keywords" && request.method === "GET")
      return listAdminKeywords(sql);
    if (url.pathname === "/api/admin/auto-draft")
      return requestAutoDraft(request, env, sql);
    return json({ ok: false, error: "not_found" }, 404);
  } catch (error) {
    console.error("Admin database request failed", error);
    return json({ ok: false, error: "database_unavailable" }, 503);
  }
}

export { MAX_JSON_BYTES };
