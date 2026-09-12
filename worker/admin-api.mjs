import {
  clearSessionCookie,
  createSessionToken,
  isAuthenticated,
  sameOrigin,
  sessionCookie,
} from "./admin-auth.mjs";
import { adminKeywordRow, adminPostRow, validateAdminPost } from "./admin-data.mjs";
import { json } from "./http.mjs";

const MAX_JSON_BYTES = 300_000;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const loginFailures = new Map();

function clientKey(request) {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

function loginBlocked(request, now) {
  const entry = loginFailures.get(clientKey(request));
  return entry && now - entry.startedAt < FAILURE_WINDOW_MS && entry.count >= MAX_LOGIN_FAILURES;
}

function recordLoginFailure(request, now) {
  const key = clientKey(request);
  const previous = loginFailures.get(key);
  const entry = previous && now - previous.startedAt < FAILURE_WINDOW_MS
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
  return typeof env?.ADMIN_PASSWORD !== "string" || env.ADMIN_PASSWORD.length < 16;
}

function requiresSameOrigin(request) {
  return sameOrigin(request) ? null : json({ ok: false, error: "origin_not_allowed" }, 403);
}

async function login(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const originError = requiresSameOrigin(request);
  if (originError) return originError;
  if (adminNotConfigured(env)) return json({ ok: false, error: "admin_not_configured" }, 503);
  const now = Date.now();
  if (loginBlocked(request, now)) return json({ ok: false, error: "too_many_attempts" }, 429);
  let body;
  try {
    body = await readJson(request);
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }
  if (typeof body.password !== "string" || body.password.length < 16 || body.password.length > 256) {
    recordLoginFailure(request, now);
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }
  if (!(await secureEqualText(body.password, env.ADMIN_PASSWORD))) {
    recordLoginFailure(request, now);
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }
  clearLoginFailures(request);
  const token = await createSessionToken(env.ADMIN_PASSWORD, Math.floor(now / 1000));
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(token) });
}

async function logout(request) {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const originError = requiresSameOrigin(request);
  if (originError) return originError;
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
}

async function session(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
  return json({ ok: true, authenticated: await isAuthenticated(request, env) });
}

async function requireAdmin(request, env) {
  if (adminNotConfigured(env)) return json({ ok: false, error: "admin_not_configured" }, 503);
  if (!(await isAuthenticated(request, env))) return json({ ok: false, error: "authentication_required" }, 401);
  return null;
}

async function listAdminPosts(sql) {
  const rows = await sql`
    SELECT slug, title, description, pub_date, publish_at, status, topic, angle, author, body_markdown, payload, updated_at
    FROM posts
    ORDER BY updated_at DESC, slug ASC
  `;
  return json({ ok: true, data: rows.map(adminPostRow), meta: { count: rows.length } });
}

async function listAdminKeywords(sql) {
  const rows = await sql`
    SELECT record_key, category, head_keyword, status, collected_at, payload
    FROM keyword_records
    ORDER BY collected_at DESC, head_keyword ASC
  `;
  return json({ ok: true, data: rows.map(adminKeywordRow), meta: { count: rows.length } });
}

async function saveAdminPost(request, sql) {
  if (request.method !== "PUT") return json({ ok: false, error: "method_not_allowed" }, 405);
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
    return json({ ok: false, error: error instanceof Error ? error.message : "invalid_post" }, 422);
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

async function secureEqualText(left, right) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

async function hash(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
  let sql;
  try {
    sql = connect(env.DATABASE_URL);
    if (url.pathname === "/api/admin/posts") {
      if (request.method === "GET") return listAdminPosts(sql);
      return saveAdminPost(request, sql);
    }
    if (url.pathname === "/api/admin/keywords" && request.method === "GET") return listAdminKeywords(sql);
    return json({ ok: false, error: "not_found" }, 404);
  } catch (error) {
    console.error("Admin database request failed", error);
    return json({ ok: false, error: "database_unavailable" }, 503);
  }
}

export { MAX_JSON_BYTES };
