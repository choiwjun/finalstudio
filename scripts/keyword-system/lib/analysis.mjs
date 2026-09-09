// WJ keyword system deterministic analysis (Task 5).
//
// Pure, deterministic analysis of collected keyword evidence plus the
// documented candidate status machine. No network, no LLM, no randomness,
// and no clock reads other than the injected `now` function.
//
// Exported interfaces:
//   deriveBlogSignals(blogResponse)      -> deterministic blog result metadata
//   deriveTrendSignals(trendResponse)    -> per-group latest/max/average ratio
//                                           metadata (relative, never a score)
//   analyzeCandidate(candidate, evidence, { now }) -> eleven-field WJ record
//                                           with freshness, risk flags,
//                                           evidence availability, and the
//                                           evidence-driven status result
//   transitionStatus(record, event)      -> documented explicit state machine
//   stableSortRecords(records)           -> deterministic stable record order
//
// A "blocking risk" is any derived risk flag: promotion to ready-to-write is
// refused unless evidence_available is true, related keywords number 2..5,
// and risk_flags is empty. Evidence risk flags (api_error, rate_limited,
// auth_missing, forbidden, malformed_response, empty_evidence, stale_evidence)
// and text risk flags (broad_keyword, sensitive_topic,
// insufficient_related_keywords) are re-derived on every analysis, so a later
// clean run can clear transient failure flags.

import {
  normalizeApiFailure,
  normalizeBlogSearchResponse,
  normalizeTrendResponse,
  normalizeWjKeywordRecord,
  SEARCH_INTENTS,
  STATUS_VALUES,
} from './contracts.mjs';

export class AnalysisError extends TypeError {
  constructor(message) {
    super(message);
    this.name = 'AnalysisError';
    this.code = 'ANALYSIS';
  }
}

// ---------------------------------------------------------------------------
// Deterministic constants
// ---------------------------------------------------------------------------

const SOURCES = Object.freeze(['naver-api-hub-blog', 'naver-api-hub-trend']);

const SOURCE_CONTRACTS = Object.freeze({
  'naver-api-hub-blog': Object.freeze({
    normalize: normalizeBlogSearchResponse,
    isEmpty: (response) => response.items.length === 0,
  }),
  'naver-api-hub-trend': Object.freeze({
    normalize: normalizeTrendResponse,
    isEmpty: (response) => response.results.length === 0,
  }),
});

// Freshness uses whole UTC calendar days between the newest usable evidence
// and the injected clock: 0..7 fresh, 8..30 stale, more than 30 unknown.
export const FRESH_MAX_DAYS = 7;
export const STALE_MAX_DAYS = 30;

// Keyword-level sensitive-topic markers. These mirror the WJ content risk
// vocabulary (finance / medical / legal / harm claims) and only route a
// candidate to human review; they never block anything but auto-promotion.
// Matching is exact substring matching over NFC text, so the list is the
// contract and stays stable.
export const SENSITIVE_TOPIC_MARKERS = Object.freeze([
  // finance / investment
  '투자', '주식', '코인', '비트코인', '가상화폐', '암호화폐', '대출', '재테크', '세금', '수익 보장',
  // medical / health claims
  '의료', '질병', '진단', '치료', '처방', '복용', '약물', '부작용', '건강기능식품',
  // legal / disputes
  '법률', '소송', '고소', '처벌', '벌금',
  // harm / dispute claims
  '사기', '피해', '내부고발',
]);

const CATEGORY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

const fail = (message) => { throw new AnalysisError(message); };
const wrap = (context, error) => { throw new AnalysisError(`${context}: ${error instanceof Error ? error.message : String(error)}`); };

function assertRecordSource(source, path) {
  if (typeof source !== 'string' || !SOURCES.includes(source)) {
    fail(`${path} must be one of ${SOURCES.join(', ')}; received ${JSON.stringify(source)}`);
  }
  return source;
}

function assertUtcDateTime(value, path) {
  if (typeof value !== 'string' || !ISO_UTC_PATTERN.test(value)) {
    fail(`${path} must be an ISO UTC date-time; received ${JSON.stringify(value)}`);
  }
  const canonical = new Date(value).toISOString();
  const expected = value.includes('.') ? canonical : canonical.replace('.000Z', 'Z');
  if (expected !== value) fail(`${path} must be a real UTC date-time; received ${JSON.stringify(value)}`);
  return value;
}

/** Whole UTC calendar day number for an ISO date-time or Date. */
function utcDayNumber(value) {
  const text = value instanceof Date ? value.toISOString() : String(value);
  const [year, month, day] = text.slice(0, 10).split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/** Whole UTC days from `collectedAt` (earlier) to `now` (later). */
function daysBetween(collectedAt, now) {
  return utcDayNumber(now) - utcDayNumber(collectedAt);
}

function freshnessForDays(days) {
  if (days >= 0 && days <= FRESH_MAX_DAYS) return 'fresh';
  if (days > FRESH_MAX_DAYS && days <= STALE_MAX_DAYS) return 'stale';
  return 'unknown';
}

function tokenCount(text) {
  return String(text).normalize('NFC').trim().split(/\s+/u).filter((token) => token !== '').length;
}

export function isSensitiveTopic(text) {
  const haystack = String(text ?? '').normalize('NFC').toLowerCase();
  const matched = [];
  for (const marker of SENSITIVE_TOPIC_MARKERS) {
    if (haystack.includes(marker)) matched.push(marker);
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Signals: deterministic metadata only. No score or rank is ever produced.
// ---------------------------------------------------------------------------

/** Deterministic metadata from a validated blog response. */
export function deriveBlogSignals(blogResponse) {
  let response;
  try {
    response = normalizeBlogSearchResponse(blogResponse);
  } catch (error) {
    wrap('deriveBlogSignals', error);
  }
  const postdates = response.items.map((item) => item.postdate);
  return {
    source: 'naver-api-hub-blog',
    total: response.total,
    item_count: response.items.length,
    earliest_postdate: postdates.length > 0 ? postdates.reduce((a, b) => (a < b ? a : b)) : null,
    latest_postdate: postdates.length > 0 ? postdates.reduce((a, b) => (a > b ? a : b)) : null,
  };
}

/**
 * Deterministic per-group trend metadata. `ratio` is a relative value inside
 * one request (the request maximum is 100); latest/max/average are computed
 * and returned as metadata only and never become a score or a rank.
 */
export function deriveTrendSignals(trendResponse) {
  let response;
  try {
    response = normalizeTrendResponse(trendResponse);
  } catch (error) {
    wrap('deriveTrendSignals', error);
  }
  const groups = response.results.map((result) => {
    const ratios = result.data.map((entry) => entry.ratio);
    const maxRatio = Math.max(...ratios);
    const maxEntry = result.data.find((entry) => entry.ratio === maxRatio);
    const latestEntry = result.data.reduce((best, entry) => (entry.period >= best.period ? entry : best));
    return {
      title: result.title,
      keywords: result.keywords,
      data_count: result.data.length,
      latest_period: latestEntry.period,
      latest_ratio: latestEntry.ratio,
      max_period: maxEntry.period,
      max_ratio: maxRatio,
      average_ratio: ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length,
    };
  });
  return {
    source: 'naver-api-hub-trend',
    start_date: response.startDate,
    end_date: response.endDate,
    time_unit: response.timeUnit,
    group_count: response.results.length,
    groups,
  };
}

// ---------------------------------------------------------------------------
// Evidence classification
// ---------------------------------------------------------------------------

const classifiedItem = (item) => {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    fail('evidence items must be objects; received ' + (item === null ? 'null' : typeof item));
  }

  // A provider ApiFailure object ({ kind, status, message, risk_flags, ... })
  // is accepted directly; it carries no source or collection timestamp.
  if (item.http === undefined && typeof item.kind === 'string') {
    let failure;
    try {
      failure = normalizeApiFailure(item);
    } catch (error) {
      wrap('evidence ApiFailure', error);
    }
    return { kind: 'failure', source: undefined, collectedAt: undefined, riskFlags: failure.risk_flags };
  }

  if (item.http === null || typeof item.http !== 'object' || typeof item.http.ok !== 'boolean') {
    fail('evidence item must carry http.ok as a boolean (or be an ApiFailure object)');
  }
  const source = assertRecordSource(item.source, 'evidence.source');
  const collectedAt = item.collected_at === undefined ? undefined : assertUtcDateTime(item.collected_at, 'evidence.collected_at');

  if (item.http.ok) {
    if (item.http.status !== 200) fail('successful evidence must use HTTP 200');
    if (item.response === undefined || item.response === null || typeof item.response !== 'object' || Array.isArray(item.response)) {
      fail('successful evidence requires a response object');
    }
    const contract = SOURCE_CONTRACTS[source];
    let response;
    try {
      response = contract.normalize(item.response);
    } catch (error) {
      // Shape-invalid bodies on a 200 are malformed responses, deterministically.
      return { kind: 'malformed', source, collectedAt };
    }
    if (contract.isEmpty(response)) return { kind: 'empty', source, collectedAt };
    return { kind: 'usable', source, collectedAt, response };
  }

  if (item.http.status !== 0 && (item.http.status < 400 || item.http.status > 599)) {
    fail('failed evidence must use HTTP 0 or a 4xx/5xx status');
  }
  if (item.error === undefined || item.error === null || typeof item.error !== 'object') {
    fail('failed evidence requires an error object');
  }
  let failure;
  try {
    failure = normalizeApiFailure({ ...item.error, status: item.http.status });
  } catch (error) {
    wrap('evidence failure', error);
  }
  return { kind: 'failure', source, collectedAt, riskFlags: failure.risk_flags };
};

// ---------------------------------------------------------------------------
// analyzeCandidate
// ---------------------------------------------------------------------------

/**
 * Deterministically analyze one candidate against its collected evidence set.
 *
 * `candidate` is either a discovery result (category, head_keyword,
 * related_keywords, search_intent, content_angle) or an existing eleven-field
 * WJ record. `evidence` is one raw evidence envelope / ApiFailure or an array
 * of them. `options.now` is the injected UTC clock function.
 *
 * Derivation rules (fixed, deterministic):
 *  - evidence_available is true only when at least one evidence item is a
 *    usable success (HTTP 200, contract-valid, non-empty response).
 *  - freshness uses the newest usable evidence `collected_at` against `now`
 *    as whole UTC calendar days: 0..7 fresh, 8..30 stale, >30 unknown.
 *    Evidence older than 7 days also adds the stale_evidence risk.
 *  - risk_flags re-derive from the candidate text and the current evidence:
 *    broad_keyword, sensitive_topic, insufficient_related_keywords plus
 *    empty_evidence / malformed_response / api_error / rate_limited /
 *    auth_missing / forbidden / stale_evidence from the evidence set.
 *  - status: clean usable evidence + 2..5 related keywords + no risk flag
 *    promotes to ready-to-write; anything else stays/returns to candidate.
 *    Written and rejected records are terminal and refuse analysis.
 */
export function analyzeCandidate(candidate, evidence, options = {}) {
  if (options === null || typeof options !== 'object') fail('options must be an object');
  const now = options.now ?? (() => new Date());
  if (typeof now !== 'function') fail('options.now must be a function returning a Date');

  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) fail('candidate must be an object');

  // --- candidate metadata -------------------------------------------------
  const { category, head_keyword, related_keywords, search_intent, content_angle } = candidate;
  if (typeof category !== 'string' || !CATEGORY_PATTERN.test(category)) fail('candidate.category must be lowercase kebab-case');
  if (typeof head_keyword !== 'string' || head_keyword.trim() === '') fail('candidate.head_keyword must be a non-empty string');
  if (!Array.isArray(related_keywords) || related_keywords.some((value) => typeof value !== 'string' || value.trim() === '')) {
    fail('candidate.related_keywords must be an array of non-empty strings');
  }
  if (!SEARCH_INTENTS.includes(search_intent)) fail('candidate.search_intent must be an allowed search intent');
  if (typeof content_angle !== 'string' || content_angle.trim() === '') fail('candidate.content_angle must be a non-empty string');

  const priorStatus = candidate.status;
  if (priorStatus !== undefined && !STATUS_VALUES.includes(priorStatus)) fail(`candidate.status must be one of ${STATUS_VALUES.join(', ')}`);
  if (priorStatus === 'written' || priorStatus === 'rejected') {
    fail(`analysis must not change a ${priorStatus} record; written and rejected need explicit handoff/reseed events`);
  }
  const priorSource = candidate.source === undefined ? [] : Array.isArray(candidate.source) ? candidate.source.map((value) => assertRecordSource(value, 'candidate.source')) : fail('candidate.source must be an array');
  const priorCollectedAt = candidate.collected_at === undefined ? undefined : assertUtcDateTime(candidate.collected_at, 'candidate.collected_at');

  // --- evidence items -----------------------------------------------------
  const items = evidence === undefined ? [] : Array.isArray(evidence) ? evidence : [evidence];
  const classified = items.map((item) => classifiedItem(item));

  const usable = classified.filter((item) => item.kind === 'usable');
  for (const item of usable) {
    if (item.collectedAt === undefined) fail('usable evidence requires a collected_at timestamp');
  }

  const sourceSet = new Set(priorSource);
  const collectedAtValues = [];
  for (const item of classified) {
    if (item.source !== undefined) sourceSet.add(item.source);
    if (item.collectedAt !== undefined) collectedAtValues.push(item.collectedAt);
  }
  const sources = SOURCES.filter((source) => sourceSet.has(source));
  if (sources.length === 0) {
    fail('a WJ record requires at least one source; supply evidence envelopes or a prior record before analysis');
  }

  const newestSuccessAt = usable.length > 0 ? usable.reduce((best, item) => (item.collectedAt >= best ? item.collectedAt : best), usable[0].collectedAt) : undefined;
  const newestAttemptAt = collectedAtValues.length > 0 ? collectedAtValues.reduce((best, value) => (value >= best ? value : best)) : undefined;

  // --- freshness ----------------------------------------------------------
  let freshness = 'unknown';
  let evidenceDays = undefined;
  if (newestSuccessAt !== undefined) {
    evidenceDays = daysBetween(newestSuccessAt, now());
    freshness = freshnessForDays(evidenceDays);
  }

  // --- risk flags ---------------------------------------------------------
  const risks = new Set();
  const textSource = [head_keyword, ...related_keywords, content_angle].join('\n');
  if (tokenCount(head_keyword) < 2) risks.add('broad_keyword');
  if (isSensitiveTopic(textSource).length > 0) risks.add('sensitive_topic');
  if (related_keywords.length < 2) risks.add('insufficient_related_keywords');
  for (const item of classified) {
    if (item.kind === 'empty') risks.add('empty_evidence');
    if (item.kind === 'malformed') risks.add('malformed_response');
    if (item.kind === 'failure') for (const flag of item.riskFlags) risks.add(flag);
  }
  if (usable.length > 0 && evidenceDays >= FRESH_MAX_DAYS + 1) risks.add('stale_evidence');

  const riskFlags = [...risks].sort();
  const evidenceAvailable = usable.length > 0;
  const canPromote = evidenceAvailable && related_keywords.length >= 2 && related_keywords.length <= 5 && riskFlags.length === 0;

  // --- status resolution --------------------------------------------------
  const status = canPromote ? 'ready-to-write' : 'candidate';

  let collectedAt;
  if (newestSuccessAt !== undefined) {
    collectedAt = newestSuccessAt;
  } else if (priorCollectedAt !== undefined) {
    collectedAt = priorCollectedAt;
  } else if (newestAttemptAt !== undefined) {
    collectedAt = newestAttemptAt;
  } else {
    fail('cannot derive a collection timestamp: no usable evidence, no prior record, and no failed evidence attempt');
  }

  let record;
  try {
    record = normalizeWjKeywordRecord({
      category,
      head_keyword,
      related_keywords,
      search_intent,
      content_angle,
      source: sources,
      collected_at: collectedAt,
      freshness,
      risk_flags: riskFlags,
      evidence_available: evidenceAvailable,
      status,
    });
  } catch (error) {
    wrap('analyzeCandidate produced an invalid record', error);
  }
  return record;
}

// ---------------------------------------------------------------------------
// transitionStatus
// ---------------------------------------------------------------------------

const canPromoteRecord = (record) => record.evidence_available === true
  && record.related_keywords.length >= 2
  && record.related_keywords.length <= 5
  && record.risk_flags.length === 0;

const nonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * Documented explicit state machine. Events:
 *   { type: 'collection_started' }            candidate -> researching
 *   { type: 'analysis_success' }              candidate|researching|ready-to-write -> ready-to-write
 *                                             (refused unless promotion preconditions hold)
 *   { type: 'analysis_failure' }              researching|ready-to-write -> candidate
 *   { type: 'writer_handoff', reference }     ready-to-write -> written
 *   { type: 'reject', reason }                candidate|researching|ready-to-write -> rejected
 *   { type: 'reseed', reference }             rejected -> candidate
 *
 * Returns a new normalized record and never mutates the input. `written`
 * requires an explicit writer_handoff event with a reference, and `rejected`
 * requires a human `reason`.
 */
export function transitionStatus(record, event) {
  let current;
  try {
    current = normalizeWjKeywordRecord(record);
  } catch (error) {
    wrap('transitionStatus requires a valid WJ record', error);
  }
  if (event === null || typeof event !== 'object' || Array.isArray(event)) fail('transitionStatus requires an event object');
  if (typeof event.type !== 'string' || event.type.trim() === '') fail('event.type must be a non-empty string');

  const from = current.status;
  let next;

  switch (event.type) {
    case 'collection_started':
      if (from !== 'candidate') fail(`collection_started is only valid from candidate; the record is ${from}`);
      next = 'researching';
      break;
    case 'analysis_success': {
      if (!['candidate', 'researching', 'ready-to-write'].includes(from)) {
        fail(`analysis_success is only valid from candidate, researching, or ready-to-write; the record is ${from}`);
      }
      if (!canPromoteRecord(current)) {
        fail('analysis_success requires evidence_available, 2 to 5 related keywords, and no blocking risk flags');
      }
      next = 'ready-to-write';
      break;
    }
    case 'analysis_failure':
      if (!['researching', 'ready-to-write'].includes(from)) {
        fail(`analysis_failure is only valid from researching or ready-to-write; the record is ${from}`);
      }
      next = 'candidate';
      break;
    case 'writer_handoff':
      if (from !== 'ready-to-write') fail(`writer_handoff is only valid from ready-to-write; the record is ${from}`);
      if (!nonEmptyString(event.reference)) fail('writer_handoff requires a non-empty reference to the writer result');
      next = 'written';
      break;
    case 'reject':
      if (!['candidate', 'researching', 'ready-to-write'].includes(from)) {
        fail(`reject is only valid from candidate, researching, or ready-to-write; the record is ${from}`);
      }
      if (!nonEmptyString(event.reason)) fail('reject requires a non-empty human reason');
      next = 'rejected';
      break;
    case 'reseed':
      if (from !== 'rejected') fail(`reseed is only valid from rejected; the record is ${from}`);
      if (!nonEmptyString(event.reference)) fail('reseed requires a non-empty reference to the new explicit seed run');
      next = 'candidate';
      break;
    default:
      fail(`unknown transition event type ${JSON.stringify(event.type)}`);
  }

  try {
    return normalizeWjKeywordRecord({ ...current, status: next });
  } catch (error) {
    wrap('transitionStatus produced an invalid record', error);
  }
}

// ---------------------------------------------------------------------------
// stableSortRecords
// ---------------------------------------------------------------------------

/**
 * Deterministic, stable sort over WJ records by category, head_keyword, then
 * status. Records with identical sort keys keep their input relative order
 * (the array is copied, never mutated). Returns the sorted copy.
 */
export function stableSortRecords(records) {
  if (!Array.isArray(records)) fail('records must be an array');
  for (const record of records) {
    try {
      normalizeWjKeywordRecord(record);
    } catch (error) {
      wrap('stableSortRecords requires valid WJ records', error);
    }
  }
  const copy = [...records];
  copy.sort((a, b) => {
    for (const key of ['category', 'head_keyword', 'status']) {
      if (a[key] < b[key]) return -1;
      if (a[key] > b[key]) return 1;
    }
    return 0;
  });
  return copy;
}
