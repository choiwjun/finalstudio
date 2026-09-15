import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";
import YAML from "yaml";
import { validatePost } from "../lib/content-contract.mjs";
import { connectDatabase } from "./lib/db.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, "../..");
const postsDir = join(projectRoot, "src/content/posts");
const recordsPath = join(projectRoot, "data/keywords/records.json");
const tombstonesPath = join(projectRoot, "data/deleted-posts.json");

function parseDocument(text, fileName) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error(`${fileName}: missing front matter`);
  const frontmatter = YAML.parse(match[1]);
  if (!frontmatter || typeof frontmatter !== "object") {
    throw new Error(`${fileName}: front matter must be an object`);
  }
  const errors = validatePost(fileName, text);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return {
    frontmatter,
    body: text.slice(match[0].length).replace(/^\n/, ""),
  };
}

function isoDate(value, field) {
  if (value instanceof Date && !Number.isNaN(value.valueOf()))
    return value.toISOString();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
    return `${value}T00:00:00.000Z`;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()))
    throw new Error(`${field} must be a valid date`);
  return date.toISOString();
}

function dateOnly(value, field) {
  return isoDate(value, field).slice(0, 10);
}

function contentHash(text) {
  return createHash("sha256").update(text).digest("hex");
}

function keywordKey(record) {
  return createHash("sha256")
    .update(`${record.category}\u0000${record.head_keyword}`)
    .digest("hex")
    .slice(0, 32);
}

export function buildKeywordRow(record) {
  if (!record || typeof record !== "object")
    throw new Error("keyword record must be an object");
  if (!record.category || !record.head_keyword)
    throw new Error("keyword record requires category and head_keyword");
  return {
    recordKey: keywordKey(record),
    category: record.category,
    headKeyword: record.head_keyword,
    status: record.status ?? "candidate",
    collectedAt: isoDate(record.collected_at, "collected_at"),
    payload: JSON.stringify(record),
  };
}

export function buildPostRow(slug, text) {
  const { frontmatter, body } = parseDocument(text, slug);
  return {
    slug,
    title: frontmatter.title,
    description: frontmatter.description,
    pubDate: dateOnly(frontmatter.pubDate, `${slug}.pubDate`),
    publishAt: frontmatter.publishAt
      ? isoDate(frontmatter.publishAt, `${slug}.publishAt`)
      : null,
    status: frontmatter.status,
    topic: frontmatter.topic,
    angle: frontmatter.angle,
    author: frontmatter.author,
    bodyMarkdown: body,
    contentHash: contentHash(text),
    payload: JSON.stringify(frontmatter),
  };
}

async function readPosts() {
  const entries = await readdir(postsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && extname(entry.name) === ".md")
    .sort((a, b) => a.name.localeCompare(b.name));
  return Promise.all(
    files.map(async (entry) => {
      const text = await readFile(join(postsDir, entry.name), "utf8");
      return buildPostRow(entry.name.slice(0, -3), text);
    }),
  );
}

async function readKeywords() {
  let records;
  try {
    records = JSON.parse(await readFile(recordsPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(
      `data/keywords/records.json could not be read: ${message}`,
      { cause: error },
    );
  }
  if (!Array.isArray(records))
    throw new Error("data/keywords/records.json must contain an array");
  return records.map(buildKeywordRow);
}

const keywordUpsert = `
  INSERT INTO keyword_records (record_key, category, head_keyword, status, collected_at, payload)
  VALUES ($1, $2, $3, $4, $5, $6::jsonb)
  ON CONFLICT (record_key) DO UPDATE SET
    category = EXCLUDED.category,
    head_keyword = EXCLUDED.head_keyword,
    status = EXCLUDED.status,
    collected_at = EXCLUDED.collected_at,
    payload = EXCLUDED.payload,
    updated_at = now()
`;

const postUpsert = `
  INSERT INTO posts (slug, title, description, pub_date, publish_at, status, topic, angle, author, body_markdown, content_hash, payload)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
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
`;

export function buildSyncQueries(keywordRows, postRows, sql, tombstones = []) {
  return [
    ...keywordRows.map((row) =>
      sql.query(keywordUpsert, [
        row.recordKey,
        row.category,
        row.headKeyword,
        row.status,
        row.collectedAt,
        row.payload,
      ]),
    ),
    // keyword_records는 워커에 쓰기 경로가 없는 순수 repo 미러라
    // 저장소에서 사라진 레코드는 그대로 비운다.
    sql.query("DELETE FROM keyword_records WHERE NOT (record_key = ANY($1::text[]))", [
      keywordRows.map((row) => row.recordKey),
    ]),
    ...postRows.map((row) =>
      sql.query(postUpsert, [
        row.slug,
        row.title,
        row.description,
        row.pubDate,
        row.publishAt,
        row.status,
        row.topic,
        row.angle,
        row.author,
        row.bodyMarkdown,
        row.contentHash,
        row.payload,
      ]),
    ),
    // posts 테이블은 관리자 화면이 직접 쓰는 행을 포함할 수 있어서
    // 명시된 tombstone slug만 지운다. 저장소에 다시 생긴 slug는 repo 우선.
    ...tombstones
      .filter((slug) => !postRows.some((row) => row.slug === slug))
      .map((slug) =>
        sql.query("DELETE FROM posts WHERE slug = $1", [slug]),
      ),
  ];
}

async function readTombstones() {
  let value;
  try {
    value = JSON.parse(await readFile(tombstonesPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  if (value === null || typeof value !== "object" || !Array.isArray(value.deleted))
    throw new Error("data/deleted-posts.json must contain a deleted array");
  return value.deleted.map((entry) => {
    if (
      !entry ||
      typeof entry.slug !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,100}$/u.test(entry.slug)
    )
      throw new Error("invalid tombstone slug in data/deleted-posts.json");
    return entry.slug;
  });
}

export async function collectSyncRows() {
  const [keywordRows, postRows, tombstones] = await Promise.all([
    readKeywords(),
    readPosts(),
    readTombstones(),
  ]);
  return { keywordRows, postRows, tombstones };
}

async function main() {
  const { keywordRows, postRows, tombstones } = await collectSyncRows();
  if (process.argv.includes("--dry-run")) {
    process.stdout.write(
      `Validated ${keywordRows.length} keyword records, ${postRows.length} posts, ${tombstones.length} tombstones\n`,
    );
    return;
  }
  const sql = connectDatabase();
  const queries = buildSyncQueries(keywordRows, postRows, sql, tombstones);
  if (queries.length > 0) await sql.transaction(queries);
  process.stdout.write(
    `Synced ${keywordRows.length} keyword records and ${postRows.length} posts to Neon (${tombstones.length} tombstones applied)\n`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await main();
}
