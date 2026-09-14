import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  AUTO_CATEGORY_QUERIES,
  buildAutomaticSeedDocument,
  collectPhraseStats,
  extractTopicCandidates,
  relatedPhrasesForTopic,
  topicCandidatesFromStats,
} from './lib/auto-discovery.mjs';
import { normalizeKeywordKey } from './lib/contracts.mjs';

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

test('related keywords come from phrases co-occurring in the same NAVER items', async () => {
  const response = await readFixture();
  const stats = collectPhraseStats('AI 인공지능', response);
  const topics = topicCandidatesFromStats(stats, {
    category: 'ai',
    query: 'AI 인공지능',
    limit: 3,
  });
  const headKeys = new Set(topics.map((topic) => normalizeKeywordKey(topic.topic)));

  const related = relatedPhrasesForTopic(stats, topics[0].topic, {
    excludeKeys: headKeys,
  });

  assert.ok(related.length > 0);
  // Every related phrase shares at least one source result with the topic.
  const topicIndexes = new Set(topics[0].source_result_indexes);
  for (const phrase of related) {
    const entry = stats.get(normalizeKeywordKey(phrase));
    assert.ok(entry.result_indexes.some((index) => topicIndexes.has(index)));
    // Head topics and sub/superset duplicates of the topic are excluded.
    assert.equal(headKeys.has(normalizeKeywordKey(phrase)), false);
    assert.equal(
      normalizeKeywordKey(phrase).includes(normalizeKeywordKey(topics[0].topic)),
      false,
    );
    assert.equal(
      normalizeKeywordKey(topics[0].topic).includes(normalizeKeywordKey(phrase)),
      false,
    );
  }
});

test('seed document prefers co-occurrence related keywords over sibling topics', () => {
  const document = buildAutomaticSeedDocument([
    {
      category: 'ai',
      topics: [
        {
          topic: '엑셀 자동화',
          search_intent: '방법',
          related_keywords: ['엑셀 기능', '반복 업무', '업무 줄이기'],
        },
        { topic: '업무 자동화', search_intent: '개념' },
      ],
    },
  ]);

  assert.deepEqual(document.inputs[0].seeds, [
    '엑셀 자동화',
    '엑셀 기능',
    '반복 업무',
    '업무 줄이기',
  ]);
  // A topic without related_keywords keeps the sibling-topic fallback.
  assert.deepEqual(document.inputs[1].seeds, ['업무 자동화', '엑셀 자동화']);
});

test('related_keywords on a topic are deduplicated and never repeat the head term', () => {
  const document = buildAutomaticSeedDocument([
    {
      category: 'ai',
      topics: [
        {
          topic: '엑셀 자동화',
          related_keywords: ['엑셀 자동화', '엑셀 기능', '엑셀 기능', ' ', 7],
        },
      ],
    },
  ]);
  assert.deepEqual(document.inputs[0].seeds, ['엑셀 자동화', '엑셀 기능']);
});

test('rejects phrases that can never be usable topics or related keywords', () => {
  const response = {
    items: [
      {
        title: '2026년 9월 경제뉴스 정리 자세히 보기 https://www.nbnnews.co.kr/news/articleView.html',
        description:
          '9월 14일 속도 조절해야 괜찮 걸까 상품 정리해봤어요 네오사피엔스 공모주 청약 일정입니다',
        link: 'https://example.com/1',
        bloggername: 'tester',
        postdate: '20260914',
      },
    ],
  };
  const stats = collectPhraseStats('경제 뉴스', response);
  const phrases = [...stats.values()].map((entry) => entry.phrase);
  // Pure date expressions are never topics.
  assert.ok(!phrases.includes('2026년 9월'));
  assert.ok(!phrases.includes('9월 14일'));
  // URL fragments from descriptions never leak into phrases.
  assert.ok(!phrases.some((phrase) => /https?|www|\.co\.kr|articleview/i.test(phrase)));
  // Windows ending in sentence-final endings or adverbial residue are rejected.
  for (const bad of ['속도 조절해야', '괜찮 걸까', '상품 정리해봤어요']) {
    assert.ok(!phrases.includes(bad), `expected ${bad} to be filtered`);
  }
  // Real topic phrases still survive.
  assert.ok(phrases.includes('네오사피엔스 공모주'));
});
