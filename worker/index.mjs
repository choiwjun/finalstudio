import { neon } from "@neondatabase/serverless";

const JSON_HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
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
      if (url.pathname === "/api/health/db") {
        if (request.method !== "GET") {
          return json({ ok: false, error: "method_not_allowed" }, 405);
        }
        if (typeof env?.DATABASE_URL !== "string" || env.DATABASE_URL.trim() === "") {
          return json({ ok: false, error: "database_not_configured" }, 503);
        }
        try {
          const sql = connect(env.DATABASE_URL);
          const rows = await sql`SELECT 1 AS ok`;
          return json({ ok: rows?.[0]?.ok === 1, service: "wjblog", database: "connected" });
        } catch (error) {
          console.error("Neon health check failed", error);
          return json({ ok: false, error: "database_unavailable" }, 503);
        }
      }
      return env.ASSETS.fetch(request);
    },
  };
}

export default createWorker();
