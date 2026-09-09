import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const FIXTURES = resolve(ROOT, 'fixtures', 'naver-api-hub');

export function fixturePath(name) {
  return resolve(FIXTURES, name);
}

export async function loadFixtureText(name) {
  return readFile(fixturePath(name), 'utf8');
}

export async function loadFixture(name) {
  const text = await loadFixtureText(name);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { path: fixturePath(name), text, json };
}

export async function readJsonFixture(name) {
  const fixture = await loadFixture(name);
  assert.notEqual(fixture.json, undefined, `fixture must contain JSON: ${name}`);
  return fixture.json;
}

export function readJsonl(lines) {
  return lines.filter((line) => line.trim()).map((line) => JSON.parse(line));
}

export function makeValidRecord(overrides = {}) {
  return {
    category: 'ai-it',
    head_keyword: '엑셀 자동화',
    related_keywords: ['엑셀 매크로', '업무 자동화'],
    search_intent: '방법',
    content_angle: '공식 근거와 실제 확인 항목을 중심으로 설명',
    source: ['naver-api-hub-blog', 'naver-api-hub-trend'],
    collected_at: '2026-09-09T00:00:00.000Z',
    freshness: 'fresh',
    risk_flags: [],
    evidence_available: true,
    status: 'candidate',
    ...overrides,
  };
}
