import { neon } from "@neondatabase/serverless";
import { handleAdminRequest } from "./admin-api.mjs";
import { json } from "./http.mjs";

function hasDatabaseUrl(env) {
  return (
    typeof env?.DATABASE_URL === "string" && env.DATABASE_URL.trim() !== ""
  );
}

function parseLimit(url) {
  const raw = url.searchParams.get("limit");
  if (raw === null) return 20;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return null;
  return limit;
}

function validCategory(category) {
  return (
    category === null || ["economy-business", "ai", "travel"].includes(category)
  );
}

function publicPost(row, includeBody = false) {
  const result = {
    slug: row.slug,
    title: row.title,
    description: row.description,
    pubDate: row.pub_date,
    publishAt: row.publish_at,
    status: row.status,
    topic: row.topic,
    angle: row.angle,
    author: row.author,
    metadata: row.payload,
  };
  return includeBody ? { ...result, bodyMarkdown: row.body_markdown } : result;
}

function publicKeyword(row) {
  return {
    recordKey: row.record_key,
    category: row.category,
    headKeyword: row.head_keyword,
    status: row.status,
    collectedAt: row.collected_at,
    record: row.payload,
  };
}

async function databaseResponse({ env, connect, query, errorLabel }) {
  if (!hasDatabaseUrl(env))
    return json({ ok: false, error: "database_not_configured" }, 503);
  try {
    return await query(connect(env.DATABASE_URL));
  } catch (error) {
    console.error(`${errorLabel} failed`, error);
    return json({ ok: false, error: "database_unavailable" }, 503);
  }
}

async function postsResponse(url, env, connect) {
  const limit = parseLimit(url);
  const topic = url.searchParams.get("topic");
  if (limit === null) return json({ ok: false, error: "invalid_limit" }, 400);
  if (topic !== null && (topic.length === 0 || topic.length > 100)) {
    return json({ ok: false, error: "invalid_topic" }, 400);
  }
  return databaseResponse({
    env,
    connect,
    errorLabel: "Neon posts query",
    query: async (sql) => {
      const topicFilter = topic === null ? sql`` : sql` AND topic = ${topic}`;
      const rows = await sql`
        SELECT slug, title, description, pub_date, publish_at, status, topic, angle, author, payload
        FROM posts
        WHERE status = 'published'${topicFilter}
        ORDER BY COALESCE(publish_at, pub_date::timestamptz) DESC, slug ASC
        LIMIT ${limit}
      `;
      return json({
        ok: true,
        data: rows.map((row) => publicPost(row)),
        meta: { limit, count: rows.length },
      });
    },
  });
}

async function postResponse(slug, env, connect) {
  return databaseResponse({
    env,
    connect,
    errorLabel: "Neon post query",
    query: async (sql) => {
      const rows = await sql`
        SELECT slug, title, description, pub_date, publish_at, status, topic, angle, author, body_markdown, payload
        FROM posts
        WHERE slug = ${slug} AND status = 'published'
        LIMIT 1
      `;
      if (rows.length === 0)
        return json({ ok: false, error: "post_not_found" }, 404);
      return json({ ok: true, data: publicPost(rows[0], true) });
    },
  });
}

async function keywordsResponse(url, env, connect) {
  const limit = parseLimit(url);
  const category = url.searchParams.get("category");
  if (limit === null) return json({ ok: false, error: "invalid_limit" }, 400);
  if (!validCategory(category))
    return json({ ok: false, error: "invalid_category" }, 400);
  return databaseResponse({
    env,
    connect,
    errorLabel: "Neon keywords query",
    query: async (sql) => {
      const categoryFilter =
        category === null ? sql`` : sql` AND category = ${category}`;
      const rows = await sql`
        SELECT record_key, category, head_keyword, status, collected_at, payload
        FROM keyword_records
        WHERE status = 'ready-to-write'${categoryFilter}
        ORDER BY collected_at DESC, head_keyword ASC
        LIMIT ${limit}
      `;
      return json({
        ok: true,
        data: rows.map(publicKeyword),
        meta: { limit, count: rows.length },
      });
    },
  });
}

function parseSlug(pathname) {
  const prefix = "/api/posts/";
  if (!pathname.startsWith(prefix)) return null;
  const encoded = pathname.slice(prefix.length);
  if (encoded.includes("/")) return null;
  try {
    const slug = decodeURIComponent(encoded);
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(slug) ? slug : null;
  } catch {
    return null;
  }
}

export function createWorker({ connect = neon } = {}) {
  return {
    async fetch(request, env) {
      let url;
      try {
        url = new URL(request.url);
      } catch {
        return json({ ok: false, error: "invalid_request_url" }, 400);
      }
      const adminResponse = await handleAdminRequest({
        request,
        url,
        env,
        connect,
      });
      if (adminResponse) return adminResponse;
      if (request.method !== "GET")
        return json({ ok: false, error: "method_not_allowed" }, 405);
      if (url.pathname === "/api/health/db") {
        return databaseResponse({
          env,
          connect,
          errorLabel: "Neon health check",
          query: async (sql) => {
            const rows = await sql`SELECT 1 AS ok`;
            return json({
              ok: rows?.[0]?.ok === 1,
              service: "wjblog",
              database: "connected",
            });
          },
        });
      }
      if (url.pathname === "/api/posts")
        return postsResponse(url, env, connect);
      if (url.pathname === "/api/keywords")
        return keywordsResponse(url, env, connect);
      const slug = parseSlug(url.pathname);
      if (slug !== null) return postResponse(slug, env, connect);
      if (!env?.ASSETS?.fetch)
        return json({ ok: false, error: "assets_not_configured" }, 500);
      return env.ASSETS.fetch(request);
    },
  };
}

export default createWorker();
