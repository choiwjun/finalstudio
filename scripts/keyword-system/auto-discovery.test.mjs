import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  AUTO_CATEGORY_QUERIES,
  buildAutomaticSeedDocument,
  extractTopicCandidates,
} from './lib/auto-discovery.mjs';

const BLOG_FIXTURE = new URL('./fixtures/naver-api-hub/blog-success.json', import.meta.url);

async function readFixture() {
  return JSON.parse(await readFile(BLOG_FIXTURE, 'utf8'));
}

test('extracts deterministic two- or three-token topics from NAVER blog titles', async () => {
  const response = await readFixture();

  const first = extractTopicCandidates(
    { category: 'ai', query: 'AI 인공지능', response },
    { limit: 5 },
  );
  const second = extractTopicCandidates(
    { category: 'ai', query: 'AI 인공지능', response },
    { limit: 5 },
  );

  assert.deepEqual(first, second);
  assert.equal(first[0].topic, '엑셀 자동화');
  assert.ok(first.every((candidate) => candidate.topic.split(' ').length >= 2));
  assert.ok(first.every((candidate) => !candidate.topic.includes('방법입니다')));
  assert.ok(first.every((candidate) => candidate.discovery_score > 0));
});

test('does not confuse the internal extraction score with popularity evidence', async () => {
  const response = await readFixture();
  const [candidate] = extractTopicCandidates(
    { category: 'travel', query: '여행', response },
    { limit: 1 },
  );

  assert.equal(candidate.supporting_results, 1);
  assert.equal(candidate.occurrences, 1);
  assert.equal(candidate.discovery_score, 101);
  assert.equal(Object.hasOwn(candidate, 'search_volume'), false);
  assert.equal(Object.hasOwn(candidate, 'revenue'), false);
});

test('converts automatically discovered topics into the existing seed contract', () => {
  const document = buildAutomaticSeedDocument([
    {
      category: 'ai',
      topics: [
        { topic: '엑셀 자동화', search_intent: '방법' },
        { topic: '업무 자동화', search_intent: '개념' },
      ],
    },
  ]);

  assert.deepEqual(document, {
    version: 1,
    inputs: [
      {
        category: 'ai',
        seeds: ['엑셀 자동화', '업무 자동화'],
        title: '엑셀 자동화',
        description: 'NAVER 블로그 검색 결과에서 자동 발견된 발행 주제 후보: 엑셀 자동화',
        intent: '방법',
        discovery_rank: 1,
      },
      {
        category: 'ai',
        seeds: ['업무 자동화', '엑셀 자동화'],
        title: '업무 자동화',
        description: 'NAVER 블로그 검색 결과에서 자동 발견된 발행 주제 후보: 업무 자동화',
        intent: '개념',
        discovery_rank: 2,
      },
    ],
  });
});

test('uses only the approved top-level category queries', () => {
  assert.deepEqual(AUTO_CATEGORY_QUERIES.map(({ category }) => category), [
    'economy-business',
    'ai',
    'travel',
  ]);
});
