import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { connectDatabase } from "./lib/db.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  currentDir,
  "../../db/migrations/001_initial.sql",
);
const migrationVersion = "001_initial";

function splitStatements(source) {
  return source
    .replace(/--[^\n]*/g, "")
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function migrateDatabase({ sql, migrationSource }) {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  const applied = await sql`
    SELECT version FROM schema_migrations WHERE version = ${migrationVersion}
  `;
  if (applied.length > 0) return { applied: false, version: migrationVersion };

  const statements = splitStatements(migrationSource);
  await sql.transaction([
    ...statements.map((statement) => sql.query(statement, [])),
    sql.query("INSERT INTO schema_migrations (version) VALUES ($1)", [
      migrationVersion,
    ]),
  ]);
  return { applied: true, version: migrationVersion };
}

async function main() {
  const migrationSource = await readFile(migrationPath, "utf8");
  const result = await migrateDatabase({
    sql: connectDatabase(),
    migrationSource,
  });
  process.stdout.write(
    `${result.applied ? `Applied Neon migration ${result.version}` : `Neon migration ${result.version} already applied`}\n`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await main();
}
