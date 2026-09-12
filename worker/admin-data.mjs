const STATUS_VALUES = new Set(["draft", "scheduled", "published"]);
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY_CHARS = 200_000;

function textField(value, name, maxLength) {
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) throw new Error(`${name} is invalid`);
  return value.trim();
}

function optionalDate(value, name) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(new Date(value).valueOf())) throw new Error(`${name} is invalid`);
  return value;
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function validateBody(body) {
  if (typeof body !== "string" || body.length > MAX_BODY_CHARS) throw new Error("bodyMarkdown is invalid");
  if (body.replace(/\s/g, "").length === 0) throw new Error("bodyMarkdown is empty");
}

export function validateAdminPost(input) {
  if (!input || typeof input !== "object") throw new Error("request body must be an object");
  const slug = textField(input.slug, "slug", 128);
  if (!SLUG_RE.test(slug)) throw new Error("slug is invalid");
  const status = textField(input.status, "status", 20);
  if (!STATUS_VALUES.has(status)) throw new Error("status must be draft, scheduled, or published");
  const bodyMarkdown = input.bodyMarkdown;
  validateBody(bodyMarkdown);
  const metadata = { ...plainObject(input.metadata) };
  const author = textField(input.author, "author", 100);
  const testedAt = optionalDate(input.testedAt ?? metadata.testedAt, "testedAt");
  const publishAt = optionalDate(input.publishAt, "publishAt");
  if (status === "scheduled" && !publishAt) throw new Error("scheduled posts require publishAt");
  if (status !== "draft" && (!testedAt || author === "TBD")) throw new Error("public posts require testedAt and a real author");
  if (status !== "draft" && bodyMarkdown.replace(/\s/g, "").length < 1500) throw new Error("public posts require at least 1,500 non-whitespace characters");
  if (status !== "draft" && /\[(?:직접 확인 필요|출처 URL 확인 필요|테스트 필요|스크린샷)[^\]]*\]/.test(bodyMarkdown)) throw new Error("public posts must resolve review markers");
  const normalizedMetadata = {
    ...metadata,
    title: textField(input.title, "title", 300),
    description: textField(input.description, "description", 1_000),
    pubDate: textField(input.pubDate, "pubDate", 10),
    status,
    topic: textField(input.topic, "topic", 100),
    angle: textField(input.angle, "angle", 1_000),
    author,
    testedAt,
    publishAt,
  };
  if (!DATE_RE.test(normalizedMetadata.pubDate)) throw new Error("pubDate is invalid");
  return {
    slug,
    title: normalizedMetadata.title,
    description: normalizedMetadata.description,
    pubDate: normalizedMetadata.pubDate,
    publishAt,
    status,
    topic: normalizedMetadata.topic,
    angle: normalizedMetadata.angle,
    author,
    bodyMarkdown,
    metadata: normalizedMetadata,
  };
}

export function adminPostRow(row) {
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    pubDate: row.pub_date,
    publishAt: row.publish_at,
    status: row.status,
    topic: row.topic,
    angle: row.angle,
    author: row.author,
    bodyMarkdown: row.body_markdown,
    metadata: row.payload,
    updatedAt: row.updated_at,
  };
}

export function adminKeywordRow(row) {
  return {
    recordKey: row.record_key,
    category: row.category,
    headKeyword: row.head_keyword,
    status: row.status,
    collectedAt: row.collected_at,
    record: row.payload,
  };
}

export { MAX_BODY_CHARS };
