import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { ContractValidationError } from './lib/contracts.mjs';
import {
  DEFAULT_STOPWORDS,
  discoverCandidates,
  inferSearchIntent,
  normalizeKeyword,
  parseSeedInput,
} from './lib/discovery.mjs';

const SAMPLE_SEEDS_PATH = new URL('../../data/keywords/seeds.json', import.meta.url);

test('Given decomposed Unicode and stray whitespace, when normalized, then text is NFC and single-spaced', () => {
  assert.equal(normalizeKeyword('각'.normalize('NFD')), '각');
  assert.equal(normalizeKeyword('  엑셀\t 자동화\n  매크로 '), '엑셀 자동화 매크로');
  assert.equal(normalizeKeyword('엑셀\u00a0자동화'), '엑셀 자동화');
});

test('Given HTML and punctuation, when normalized, then tags are removed and punctuation separates tokens', () => {
  assert.equal(normalizeKeyword('<b>엑셀</b> 자동화'), '엑셀 자동화');
  assert.equal(normalizeKeyword('엑셀 자동화, 매크로! (초급)'), '엑셀 자동화 매크로 초급');
  assert.equal(normalizeKeyword('"엑셀" 자동화 방법'), '엑셀 자동화 방법');
});

test('Given separator dots and internal dots, when normalized, then only token-edge dots are removed', () => {
  assert.equal(normalizeKeyword('엑셀 자동화.'), '엑셀 자동화');
  assert.equal(normalizeKeyword('설명합니다. 다음은'), '설명합니다 다음은');
  assert.equal(normalizeKeyword('Node.js 자동화'), 'Node.js 자동화');
});

test('Given an explicit intent marker, when intent is inferred, then the marker maps to its intent', () => {
  assert.equal(inferSearchIntent('엑셀 자동화하는 법'), '방법');
  assert.equal(inferSearchIntent('엑셀 VLOOKUP 차이 비교'), '비교');
  assert.equal(inferSearchIntent('매크로 오류 해결'), '문제 해결');
  assert.equal(inferSearchIntent('2026년 최신 변경 사항'), '최신 이슈');
  assert.equal(inferSearchIntent('수면 건강 정보'), '개념');
  assert.equal(inferSearchIntent(''), '개념');
});

test('Given several intent markers, when inferred, then the fixed precedence wins', () => {
  assert.equal(inferSearchIntent('엑셀 설정의 최신 업데이트'), '방법');
  assert.equal(inferSearchIntent('추천하는 최신 도구'), '비교');
  assert.equal(inferSearchIntent('최신 매크로 문제 사례'), '문제 해결');
});

test('Given a valid versioned seed document, when parsed, then normalized groups are returned', () => {
  const parsed = parseSeedInput({
    version: 1,
    inputs: [
      {
        category: ' ai-it ',
        seeds: [' <b>엑셀 자동화</b> ', '업무 자동화'],
        title: '  엑셀 자동화로 반복 업무 줄이는 방법 ',
        description: '공식 문서를 기준으로 설명합니다',
        intent: ' 방법 ',
      },
    ],
  });

  assert.deepEqual(parsed, {
    version: 1,
    inputs: [
      {
        category: 'ai-it',
        seeds: ['엑셀 자동화', '업무 자동화'],
        title: '엑셀 자동화로 반복 업무 줄이는 방법',
        description: '공식 문서를 기준으로 설명합니다',
        intent: '방법',
      },
    ],
  });
});

test('Given an unknown lowercase kebab category, when parsed, then it is accepted', () => {
  const parsed = parseSeedInput({ version: 1, inputs: [{ category: 'new-tech', seeds: ['신기술'] }] });
  assert.equal(parsed.inputs[0].category, 'new-tech');
});

test('Given malformed seed documents, when parsed, then deterministic contract errors are thrown', () => {
  const base = { version: 1, inputs: [{ category: 'ai-it', seeds: ['엑셀 자동화'] }] };
  const cases = [
    { name: 'non-object', input: null, path: 'seed' },
    { name: 'string input', input: 'x', path: 'seed' },
    { name: 'missing version', input: { inputs: [] }, path: 'seed.version' },
    { name: 'unsupported version', input: { ...base, version: 2 }, path: 'seed.version' },
    { name: 'missing inputs', input: { version: 1 }, path: 'seed.inputs' },
    { name: 'empty inputs', input: { ...base, inputs: [] }, path: 'seed.inputs' },
    { name: 'non-object input', input: { version: 1, inputs: ['x'] }, path: 'seed.inputs[0]' },
    { name: 'missing category', input: { version: 1, inputs: [{ seeds: ['x'] }] }, path: 'seed.inputs[0].category' },
    { name: 'uppercase category', input: { version: 1, inputs: [{ category: 'AI IT', seeds: ['x'] }] }, path: 'seed.inputs[0].category' },
    { name: 'missing seeds', input: { version: 1, inputs: [{ category: 'ai-it' }] }, path: 'seed.inputs[0].seeds' },
    { name: 'empty seeds', input: { version: 1, inputs: [{ category: 'ai-it', seeds: [] }] }, path: 'seed.inputs[0].seeds' },
    { name: 'blank seed', input: { version: 1, inputs: [{ category: 'ai-it', seeds: ['   '] }] }, path: 'seed.inputs[0].seeds[0]' },
    { name: 'html-only seed', input: { version: 1, inputs: [{ category: 'ai-it', seeds: ['<b></b>'] }] }, path: 'seed.inputs[0].seeds[0]' },
    { name: 'numeric-only seed', input: { version: 1, inputs: [{ category: 'ai-it', seeds: ['2026'] }] }, path: 'seed.inputs[0].seeds[0]' },
    { name: 'non-string title', input: { version: 1, inputs: [{ category: 'ai-it', seeds: ['x'], title: 5 }] }, path: 'seed.inputs[0].title' },
    { name: 'invalid intent', input: { version: 1, inputs: [{ category: 'ai-it', seeds: ['x'], intent: '정보' }] }, path: 'seed.inputs[0].intent' },
  ];
  for (const entry of cases) {
    assert.throws(
      () => parseSeedInput(entry.input),
      (error) => error instanceof ContractValidationError && error.message.startsWith(`${entry.path}: `),
      `expected ${entry.name} to fail at ${entry.path}`,
    );
  }
});

test('Given an explicit seed and a longer title phrase, when discovered, then the explicit seed is the head', () => {
  const result = discoverCandidates({
    category: 'ai-it',
    seeds: ['업무 자동화', '엑셀 자동화'],
    title: '엑셀 자동화 매크로',
  });

  assert.equal(result.head_keyword, '업무 자동화');
  assert.equal(result.related_keywords[0], '엑셀 자동화');
  assert.ok(result.candidates.length >= 3);
  assert.deepEqual(result.risk_flags, []);
});

test('Given a group without seeds, when discovered, then the longest first title phrase becomes the head', () => {
  const result = discoverCandidates({ category: 'economy', title: '생활 물가 변화를 읽는 방법' });

  assert.equal(result.head_keyword, '생활 물가 변화를 읽는');
  assert.ok(result.candidates.includes('물가 변화를 읽는 방법'));
  assert.ok(!result.candidates.includes('생활 물가 변화를 읽는 방법'));
});

test('Given a seed-less group, when discovered, then the longest head is excluded from related keywords', () => {
  const result = discoverCandidates({ category: 'economy', title: '생활 물가 변화를 읽는 방법' });
  assert.equal(result.head_keyword, '생활 물가 변화를 읽는');
  assert.ok(!result.related_keywords.includes(result.head_keyword));
  assert.ok(result.related_keywords.length <= 5);
  assert.equal(result.search_intent, '방법');
});

test('Given title and description text, when discovered, then only contiguous 2-4 token phrases are derived in order', () => {
  const result = discoverCandidates({ category: 'ai-it', seeds: ['업무 자동화'], title: '오전 근무 시간 줄이기 자동화 도구 추천 방법' });

  assert.equal(result.related_keywords[0], '오전 근무');
  assert.ok(result.candidates.every((candidate) => candidate.split(' ').length <= 4));
  assert.ok(result.candidates.some((candidate) => candidate.split(' ').length === 4));
});

test('Given a stopword option, when discovered, then phrases containing stopword tokens are dropped', () => {
  const base = { category: 'ai-it', seeds: ['엑셀 자동화'], title: '업무 자동화 방법' };
  const withDefault = discoverCandidates(base);
  assert.ok(withDefault.candidates.includes('업무 자동화'));
  assert.ok(withDefault.candidates.includes('업무 자동화 방법'));

  const withoutMethod = discoverCandidates(base, { stopwords: ['방법'] });
  assert.ok(!withoutMethod.candidates.some((candidate) => candidate.includes('방법')));
});

test('Given default stopwords and short tokens, when discovered, then windows containing them are dropped', () => {
  assert.ok(Array.isArray(DEFAULT_STOPWORDS) && DEFAULT_STOPWORDS.length > 0);
  const short = discoverCandidates({ category: 'ai-it', seeds: ['엑셀'], title: '엑셀 I 자동화' });
  assert.deepEqual(short.candidates, ['엑셀']);
  const stopword = discoverCandidates({ category: 'ai-it', seeds: ['엑셀'], title: '엑셀 그리고 자동화' });
  assert.deepEqual(stopword.candidates, ['엑셀']);
});

test('Given numeric-only text, when discovered, then numeric-only windows are removed', () => {
  const result = discoverCandidates({ category: 'ai-it', seeds: ['엑셀'], title: '자동화 2024 2025 도구' });
  assert.ok(!result.candidates.includes('2024 2025'));
  assert.ok(result.candidates.includes('자동화 2024'));
});

test('Given duplicate or differently-cased seeds, when discovered, then candidates dedupe by normalized keyword', () => {
  const duplicate = discoverCandidates({ category: 'ai-it', seeds: ['업무 자동화', '업무 자동화'] });
  assert.deepEqual(duplicate.candidates, ['업무 자동화']);
  assert.equal(duplicate.head_keyword, '업무 자동화');
  assert.deepEqual(duplicate.risk_flags, ['insufficient_related_keywords']);

  const casing = discoverCandidates({ category: 'ai-it', seeds: ['AI', 'ai'] });
  assert.deepEqual(casing.candidates, ['AI']);
});

test('Given too-few or too-broad candidates, when discovered, then risk flags are attached', () => {
  const broad = discoverCandidates({ category: 'health', seeds: ['수면'] });
  assert.deepEqual(broad.risk_flags, ['broad_keyword', 'insufficient_related_keywords']);

  const oneRelated = discoverCandidates({ category: 'health', seeds: ['수면 습관', '수면 시간'] });
  assert.deepEqual(oneRelated.risk_flags, ['insufficient_related_keywords']);

  const enough = discoverCandidates({ category: 'health', seeds: ['수면 습관', '수면 시간', '수면 환경'] });
  assert.deepEqual(enough.risk_flags, []);
});

test('Given an explicit intent, when discovered, then the explicit intent wins over markers', () => {
  const result = discoverCandidates({
    category: 'ai-it',
    seeds: ['엑셀 자동화'],
    title: '엑셀 자동화 기초',
    intent: '최신 이슈',
  });
  assert.equal(result.search_intent, '최신 이슈');

  const inferred = discoverCandidates({ category: 'ai-it', seeds: ['엑셀 자동화'], title: '엑셀 자동화 기초' });
  assert.equal(inferred.search_intent, '개념');
});

test('Given a description, when discovered, then content angle is the normalized description', () => {
  const result = discoverCandidates({
    category: 'ai-it',
    seeds: ['엑셀 자동화'],
    description: '<p>공식 문서와  실제 확인 항목을 기준으로 설명합니다.</p>',
  });
  assert.equal(result.content_angle, '공식 문서와 실제 확인 항목을 기준으로 설명합니다');
});

test('Given no description, when discovered, then content angle uses the head keyword template', () => {
  const result = discoverCandidates({ category: 'ai-it', seeds: ['엑셀 자동화'] });
  assert.equal(result.content_angle, '엑셀 자동화를 WJ가 공식 근거와 실제 확인 항목 중심으로 설명');
});

test('Given the same input twice, when discovered, then results are byte-stable', () => {
  const input = {
    category: 'economy',
    seeds: ['생활 물가'],
    title: '생활 물가 변화를 읽는 방법',
    description: '공공 통계의 기준과 일상에서 확인할 지점을 정리합니다.',
  };
  assert.deepEqual(discoverCandidates(input), discoverCandidates(structuredClone(input)));
});

test('Given a whole seed document, when discovered, then per-input grouped candidates are returned in order', () => {
  const doc = {
    version: 1,
    inputs: [
      { category: 'ai-it', seeds: ['엑셀 자동화', '업무 자동화'], title: '엑셀 자동화 매크로' },
      { category: 'economy', seeds: ['생활 물가'], title: '생활 물가 변화를 읽는 방법' },
    ],
  };
  const results = discoverCandidates(doc);
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((result) => result.category), ['ai-it', 'economy']);
  assert.deepEqual(results.map((result) => result.head_keyword), ['엑셀 자동화', '생활 물가']);
  assert.equal(results[1].search_intent, '방법');
});

test('Given the WJ sample seed file, when parsed and discovered, then candidates intent and angle are derived', async () => {
  const seedText = await readFile(SAMPLE_SEEDS_PATH, 'utf8');
  const doc = JSON.parse(seedText);
  const parsed = parseSeedInput(doc);
  const results = discoverCandidates(parsed);

  assert.equal(parsed.version, 1);
  assert.deepEqual(results.map((result) => result.category), ['ai-it', 'economy', 'health']);

  const aiIt = results[0];
  assert.equal(aiIt.head_keyword, '엑셀 자동화');
  assert.equal(aiIt.related_keywords[0], '업무 자동화');
  assert.ok(aiIt.related_keywords.length <= 5);
  assert.equal(aiIt.search_intent, '방법');
  assert.equal(aiIt.content_angle, '공식 문서와 실제 확인 항목을 기준으로 작은 자동화부터 설명합니다');
  assert.deepEqual(aiIt.risk_flags, []);

  const economy = results[1];
  assert.equal(economy.head_keyword, '생활 물가');
  assert.equal(economy.search_intent, '방법');
  assert.equal(economy.content_angle, '공공 통계의 기준과 일상에서 확인할 지점을 정리합니다');

  const health = results[2];
  assert.equal(health.head_keyword, '수면 습관');
  assert.equal(health.search_intent, '개념');
  assert.equal(health.content_angle, '공식 보건 자료를 바탕으로 생활에서 확인할 수 있는 범위를 설명합니다');
});
