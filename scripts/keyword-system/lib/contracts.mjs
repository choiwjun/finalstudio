const BLOG_SORTS = Object.freeze(['sim', 'date']);
export const TREND_TIME_UNITS = Object.freeze(['date', 'week', 'month']);
export const SEARCH_INTENTS = Object.freeze(['방법', '개념', '비교', '문제 해결', '최신 이슈']);
export const FRESHNESS_VALUES = Object.freeze(['fresh', 'stale', 'unknown']);
export const STATUS_VALUES = Object.freeze(['candidate', 'researching', 'ready-to-write', 'written', 'rejected']);
/** Canonical identity for a keyword across discovery, manifests, records, and decisions. */
export const normalizeKeywordKey = (value) => String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase();

export const RISK_FLAGS = Object.freeze([
  'api_error', 'rate_limited', 'auth_missing', 'forbidden', 'malformed_response',
  'empty_evidence', 'broad_keyword', 'sensitive_topic', 'stale_evidence',
  'insufficient_related_keywords',
]);
export const API_FAILURE_KINDS = Object.freeze([
  'auth_missing', 'forbidden', 'rate_limited', 'server_error', 'gateway_error',
  'search_error', 'trend_error', 'validation_error', 'malformed_json', 'malformed_response',
  'network_error', 'api_error',
]);

const SAFE_SOURCES = new Set(['naver-api-hub-blog', 'naver-api-hub-trend']);
const SAFE_METHODS = new Set(['GET', 'POST']);
const AGE_VALUES = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);

export class ContractValidationError extends TypeError {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'ContractValidationError';
  }
}

const fail = (path, message) => { throw new ContractValidationError(path, message); };
const object = (value, path) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  return value;
};
const string = (value, path, { nonEmpty = true } = {}) => {
  if (typeof value !== 'string' || (nonEmpty && value.trim() === '')) fail(path, 'must be a string');
  return value;
};
const integer = (value, path, minimum, maximum) => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail(path, 'must be an integer in range');
  return value;
};
const normalizedText = (value, path) => string(value, path).normalize('NFC').replace(/\s+/gu, ' ').trim();
const date = (value, path) => {
  string(value, path);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) fail(path, 'must be an ISO date');
  const actual = new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10);
  if (actual !== value) fail(path, 'must be a real calendar date');
  return value;
};
const isoDateTime = (value, path) => {
  string(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) || Number.isNaN(Date.parse(value))) fail(path, 'must be an ISO UTC date-time');
  const canonical = new Date(value).toISOString();
  const expected = value.includes('.') ? canonical : canonical.replace('.000Z', 'Z');
  if (expected !== value) fail(path, 'must be a real UTC date-time');
  return value;
};
const enumValue = (value, values, path) => values.includes(value) ? value : fail(path, 'must be an allowed value');
const optionalEnum = (value, values, path) => value === undefined ? undefined : enumValue(value, values, path);
const stripBold = (value) => value.replace(/<\/?b>/giu, '');

export function normalizeBlogSearchRequest(input) {
  const value = object(input, 'request');
  return {
    query: normalizedText(value.query, 'request.query'),
    display: integer(value.display ?? 10, 'request.display', 1, 100),
    start: integer(value.start ?? 1, 'request.start', 1, 1000),
    sort: enumValue(value.sort ?? 'sim', BLOG_SORTS, 'request.sort'),
    format: enumValue(value.format ?? 'json', ['json'], 'request.format'),
  };
}

export const validateBlogSearchRequest = normalizeBlogSearchRequest;

export function normalizeTrendRequest(input) {
  const value = object(input, 'request');
  const startDate = date(value.startDate, 'request.startDate');
  const endDate = date(value.endDate, 'request.endDate');
  if (startDate > endDate) fail('request', 'startDate must not be after endDate');
  const groups = Array.isArray(value.keywordGroups) ? value.keywordGroups : fail('request.keywordGroups', 'must be an array');
  integer(groups.length, 'request.keywordGroups.length', 1, 5);
  const keywordGroups = groups.map((group, index) => {
    const item = object(group, `request.keywordGroups[${index}]`);
    const keywords = Array.isArray(item.keywords) ? item.keywords : fail(`request.keywordGroups[${index}].keywords`, 'must be an array');
    integer(keywords.length, `request.keywordGroups[${index}].keywords.length`, 1, 20);
    return {
      groupName: normalizedText(item.groupName, `request.keywordGroups[${index}].groupName`),
      keywords: keywords.map((keyword, keywordIndex) => normalizedText(keyword, `request.keywordGroups[${index}].keywords[${keywordIndex}]`)),
    };
  });
  const result = { startDate, endDate, timeUnit: enumValue(value.timeUnit, TREND_TIME_UNITS, 'request.timeUnit'), keywordGroups };
  for (const field of ['device', 'gender']) {
    const normalized = optionalEnum(value[field], field === 'device' ? ['pc', 'mo'] : ['m', 'f'], `request.${field}`);
    if (normalized !== undefined) result[field] = normalized;
  }
  if (value.ages !== undefined) {
    if (!Array.isArray(value.ages) || value.ages.length > 11) fail('request.ages', 'must be an array of up to 11 age values');
    result.ages = value.ages.map((age, index) => enumValue(String(age), [...AGE_VALUES], `request.ages[${index}]`));
  }
  return result;
}

export const validateTrendRequest = normalizeTrendRequest;

function normalizeBlogItem(item, index) {
  const value = object(item, `response.items[${index}]`);
  return {
    title: stripBold(normalizedText(value.title, `response.items[${index}].title`)),
    description: stripBold(normalizedText(value.description, `response.items[${index}].description`)),
    link: normalizedText(value.link, `response.items[${index}].link`),
    postdate: string(value.postdate, `response.items[${index}].postdate`),
  };
}

export function normalizeBlogSearchResponse(input) {
  const value = object(input, 'response');
  const items = Array.isArray(value.items) ? value.items.map(normalizeBlogItem) : fail('response.items', 'must be an array');
  integer(value.total, 'response.total', 0, Number.MAX_SAFE_INTEGER);
  for (const [index, item] of items.entries()) {
    if (!/^\d{8}$/u.test(item.postdate)) fail(`response.items[${index}].postdate`, 'must be YYYYMMDD');
    const postdate = `${item.postdate.slice(0, 4)}-${item.postdate.slice(4, 6)}-${item.postdate.slice(6, 8)}`;
    date(postdate, `response.items[${index}].postdate`);
  }
  const result = { total: value.total, items };
  for (const field of ['lastBuildDate', 'start', 'display']) {
    if (value[field] !== undefined) {
      result[field] = field === 'lastBuildDate'
        ? string(value[field], `response.${field}`)
        : integer(value[field], `response.${field}`, field === 'start' ? 1 : 1, field === 'start' ? 1000 : 100);
    }
  }
  if (items.length > value.total) fail('response.items', 'must not contain more items than total');
  if (result.display !== undefined && items.length > result.display) fail('response.items', 'must not exceed response.display');
  return result;
}

export const validateBlogSearchResponse = normalizeBlogSearchResponse;
export const isValidBlogSearchResponse = (value) => { try { normalizeBlogSearchResponse(value); return true; } catch { return false; } };

function normalizeTrendData(data, resultIndex) {
  if (!Array.isArray(data)) fail(`response.results[${resultIndex}].data`, 'must be an array');
  if (data.length === 0) fail(`response.results[${resultIndex}].data`, 'must not be empty');
  return data.map((item, index) => {
    const value = object(item, `response.results[${resultIndex}].data[${index}]`);
    const period = date(value.period, `response.results[${resultIndex}].data[${index}].period`);
    if (typeof value.ratio !== 'number' || !Number.isFinite(value.ratio) || value.ratio < 0 || value.ratio > 100) fail(`response.results[${resultIndex}].data[${index}].ratio`, 'must be a number in range 0..100');
    return { period, ratio: value.ratio };
  });
}

export function normalizeTrendResponse(input) {
  const value = object(input, 'response');
  const startDate = date(value.startDate, 'response.startDate');
  const endDate = date(value.endDate, 'response.endDate');
  if (startDate > endDate) fail('response', 'startDate must not be after endDate');
  const results = Array.isArray(value.results) ? value.results.map((result, index) => {
    const item = object(result, `response.results[${index}]`);
    const keywords = Array.isArray(item.keywords) ? item.keywords.map((keyword, keywordIndex) => normalizedText(keyword, `response.results[${index}].keywords[${keywordIndex}]`)) : fail(`response.results[${index}].keywords`, 'must be an array');
    if (keywords.length === 0) fail(`response.results[${index}].keywords`, 'must not be empty');
    return { title: normalizedText(item.title, `response.results[${index}].title`), keywords, data: normalizeTrendData(item.data, index) };
  }) : fail('response.results', 'must be an array');
  return { startDate, endDate, timeUnit: enumValue(value.timeUnit, TREND_TIME_UNITS, 'response.timeUnit'), results };
}

export const validateTrendResponse = normalizeTrendResponse;
export const isValidTrendResponse = (value) => { try { normalizeTrendResponse(value); return true; } catch { return false; } };

const normalizeRedactionValues = (values) => [...new Set((Array.isArray(values) ? values : [values])
  .filter((value) => typeof value === 'string' && value.length > 0))]
  .sort((a, b) => b.length - a.length);

const redactText = (value, redactionValues = []) => {
  let text = String(value);
  for (const secret of normalizeRedactionValues(redactionValues)) text = text.split(secret).join('[redacted]');
  return text
    .replace(/((?:authorization|proxy-authorization|x-ncp-[^\s:=]+|api[-_ ]?key|client[-_ ]?(?:id|secret)|access[-_]?token|refresh[-_]?token|password|credential|secret|token)\s*[:=]\s*)(?:(?:bearer|basic)\s+[^\s,;&]+|"[^"]*"|'[^']*'|[^\s,;&]+)/giu, '$1[redacted]')
    .replace(/\b(?:bearer|basic)\s+[^\s,;&]+/giu, '[redacted]')
    .replace(/[A-Za-z0-9_-]*SECRET[A-Za-z0-9_-]*/giu, '[redacted]');
};

/** Redact configured opaque credentials from JSON-safe upstream values. */
export function redactCredentialValues(value, redactionValues = []) {
  if (typeof value === 'string') return redactText(value, redactionValues);
  if (Array.isArray(value)) return value.map((item) => redactCredentialValues(item, redactionValues));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactCredentialValues(item, redactionValues)]));
  }
  return value;
}

const redact = (value, redactionValues = []) => redactText(value, redactionValues);

export function normalizeApiFailure(input, options = {}) {
  const value = object(input, 'failure');
  const body = value.body && typeof value.body === 'object' ? value.body : {};
  const gateway = body.error && typeof body.error === 'object' ? body.error : {};
  const status = value.status ?? value.statusCode ?? 0;
  if (!Number.isInteger(status) || status < 0 || status > 599) fail('failure.status', 'must be an HTTP status');
  let kind = value.kind;
  if (kind === undefined) {
    kind = status === 401 ? 'auth_missing' : status === 403 ? 'forbidden' : status === 429 ? 'rate_limited' : status >= 500 ? 'server_error' : status === 400 && body.errMsg ? 'validation_error' : status >= 400 ? 'api_error' : 'network_error';
  }
  enumValue(kind, API_FAILURE_KINDS, 'failure.kind');
  const code = value.code ?? gateway.errorCode ?? body.errorCode ?? body.errId ?? 'unknown';
  const redactionValues = options?.redactValues ?? [];
  const message = redact(value.message ?? gateway.message ?? body.errorMessage ?? body.errMsg ?? 'Keyword API request failed', redactionValues);
  if (value.retryable !== undefined && typeof value.retryable !== 'boolean') fail('failure.retryable', 'must be boolean');
  const risk = new Set(Array.isArray(value.risk_flags) ? value.risk_flags.map((item, index) => enumValue(item, RISK_FLAGS, `failure.risk_flags[${index}]`)) : []);
  if (status >= 400) risk.add('api_error');
  if (kind === 'auth_missing') risk.add('auth_missing');
  if (kind === 'forbidden') risk.add('forbidden');
  if (kind === 'rate_limited') risk.add('rate_limited');
  return {
    kind,
    code: redact(code, redactionValues),
    message,
    status,
    retryable: value.retryable ?? (kind === 'rate_limited' || kind === 'server_error' || kind === 'network_error'),
    risk_flags: [...risk].sort(),
  };
}

export const validateApiFailure = normalizeApiFailure;

function safeValue(value, path = 'value', seen = new Set(), redactionValues = []) {
  if (value === null) return value;
  if (typeof value === 'string') return redactText(value, redactionValues);
  if (typeof value !== 'object') {
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    fail(path, 'must contain only JSON values');
  }
  if (seen.has(value)) fail(path, 'must not contain circular values');
  seen.add(value);
  if (Array.isArray(value)) return value.map((item, index) => safeValue(item, `${path}[${index}]`, seen, redactionValues));
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail(`${path}.${key}`, 'prototype-control keys are not allowed');
    if (/headers|authorization|secret|credential|client[_-]?id|api[-_]?key|token/iu.test(key)) fail(`${path}.${key}`, 'credential-bearing fields are not allowed');
    result[key] = safeValue(item, `${path}.${key}`, seen, redactionValues);
  }
  seen.delete(value);
  return result;
}

const EVIDENCE_CONTRACTS = Object.freeze({
  'naver-api-hub-blog': Object.freeze({
    endpoint: '/search/v1/blog',
    method: 'GET',
    requestFields: ['query', 'display', 'start', 'sort', 'format'],
    request: normalizeBlogSearchRequest,
    response: normalizeBlogSearchResponse,
    isEmpty: (value) => value.items.length === 0,
  }),
  'naver-api-hub-trend': Object.freeze({
    endpoint: '/search-trend/v1/search',
    method: 'POST',
    requestFields: ['startDate', 'endDate', 'timeUnit', 'keywordGroups', 'device', 'gender', 'ages'],
    request: normalizeTrendRequest,
    response: normalizeTrendResponse,
    isEmpty: (value) => value.results.length === 0,
  }),
});

export function normalizeRawEvidenceEnvelope(input, options = {}) {
  const value = object(input, 'evidence');
  if (value.schema_version !== 1) fail('evidence.schema_version', 'must be 1');
  const source = enumValue(value.source, [...SAFE_SOURCES], 'evidence.source');
  const contract = EVIDENCE_CONTRACTS[source];
  const method = enumValue(value.method, [...SAFE_METHODS], 'evidence.method');
  if (value.endpoint !== contract.endpoint) fail('evidence.endpoint', `must be ${contract.endpoint}`);
  if (method !== contract.method) fail('evidence.method', `must be ${contract.method} for ${source}`);
  const http = object(value.http, 'evidence.http');
  integer(http.status, 'evidence.http.status', 0, 599);
  if (typeof http.ok !== 'boolean') fail('evidence.http.ok', 'must be boolean');
  const redactionValues = options?.redactValues ?? [];
  const requestInput = safeValue(object(value.request, 'evidence.request'), 'evidence.request', new Set(), redactionValues);
  contract.request(requestInput);
  const request = Object.fromEntries(contract.requestFields.filter((field) => requestInput[field] !== undefined).map((field) => [field, requestInput[field]]));
  const result = {
    schema_version: 1,
    provider: enumValue(value.provider, ['naver-api-hub'], 'evidence.provider'),
    source,
    endpoint: contract.endpoint,
    method,
    request,
    collected_at: isoDateTime(value.collected_at, 'evidence.collected_at'),
    http: { status: http.status, ok: http.ok },
  };
  if (result.http.ok) {
    if (http.status !== 200) fail('evidence.http.status', 'successful evidence must use HTTP 200');
    if (value.error !== undefined) fail('evidence.error', 'must be absent for successful evidence');
    if (value.response === undefined) fail('evidence.response', 'is required for successful evidence');
    const response = contract.response(safeValue(value.response, 'evidence.response', new Set(), redactionValues));
    if (contract.isEmpty(response)) fail('evidence.response', 'empty response is not usable evidence');
    result.response = response;
  } else {
    if (http.status !== 0 && http.status < 400) fail('evidence.http.status', 'failed evidence must use HTTP 0 or a 4xx/5xx status');
    if (value.response !== undefined) fail('evidence.response', 'must be absent for failed evidence');
    if (value.error === undefined) fail('evidence.error', 'is required for failed evidence');
    const error = normalizeApiFailure({ ...safeValue(value.error, 'evidence.error', new Set(), redactionValues), status: http.status }, { redactValues: redactionValues });
    if (http.status === 0 && error.kind !== 'network_error') fail('evidence.error.kind', 'HTTP 0 failures must be network_error');
    result.error = error;
  }
  return result;
}

export const validateRawEvidenceEnvelope = normalizeRawEvidenceEnvelope;

export function normalizeWjKeywordRecord(input) {
  const value = object(input, 'record');
  const result = {
    category: normalizedText(value.category, 'record.category'),
    head_keyword: normalizedText(value.head_keyword, 'record.head_keyword'),
    related_keywords: Array.isArray(value.related_keywords) ? value.related_keywords.map((item, index) => normalizedText(item, `record.related_keywords[${index}]`)) : fail('record.related_keywords', 'must be an array'),
    search_intent: enumValue(value.search_intent, SEARCH_INTENTS, 'record.search_intent'),
    content_angle: normalizedText(value.content_angle, 'record.content_angle'),
    source: Array.isArray(value.source) ? value.source.map((item, index) => enumValue(item, [...SAFE_SOURCES], `record.source[${index}]`)) : fail('record.source', 'must be an array'),
    collected_at: isoDateTime(value.collected_at, 'record.collected_at'),
    freshness: enumValue(value.freshness, FRESHNESS_VALUES, 'record.freshness'),
    risk_flags: Array.isArray(value.risk_flags) ? [...new Set(value.risk_flags.map((item, index) => enumValue(item, RISK_FLAGS, `record.risk_flags[${index}]`)))].sort() : fail('record.risk_flags', 'must be an array'),
    evidence_available: value.evidence_available,
    status: enumValue(value.status, STATUS_VALUES, 'record.status'),
  };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(result.category)) fail('record.category', 'must be a lowercase kebab-case category');
  if (result.source.length === 0) fail('record.source', 'must not be empty');
  if (typeof result.evidence_available !== 'boolean') fail('record.evidence_available', 'must be boolean');
  if (result.status === 'ready-to-write' && (!result.evidence_available || result.related_keywords.length < 2 || result.related_keywords.length > 5)) fail('record', 'ready-to-write requires evidence and 2 to 5 related keywords');
  if (result.status === 'written' && !result.evidence_available) fail('record', 'written requires evidence');
  return result;
}

export const validateWjKeywordRecord = normalizeWjKeywordRecord;

export function isKeywordProvider(value) {
  return value !== null && typeof value === 'object' && typeof value.providerId === 'string' && value.providerId.trim() !== '' && typeof value.searchBlogs === 'function' && typeof value.searchTrends === 'function';
}

export function normalizeKeywordProvider(provider) {
  if (!isKeywordProvider(provider)) fail('provider', 'must expose providerId, searchBlogs, and searchTrends');
  return Object.freeze({
    providerId: provider.providerId,
    async searchBlogs(request) {
      const result = await provider.searchBlogs(normalizeBlogSearchRequest(request));
      return result && typeof result === 'object' && typeof result.kind === 'string' ? normalizeApiFailure(result) : normalizeBlogSearchResponse(result);
    },
    async searchTrends(request) {
      const result = await provider.searchTrends(normalizeTrendRequest(request));
      return result && typeof result === 'object' && typeof result.kind === 'string' ? normalizeApiFailure(result) : normalizeTrendResponse(result);
    },
  });
}

export const validateKeywordProvider = normalizeKeywordProvider;

export const isValidBlogSearchRequest = (value) => { try { normalizeBlogSearchRequest(value); return true; } catch { return false; } };
export const isValidTrendRequest = (value) => { try { normalizeTrendRequest(value); return true; } catch { return false; } };
export const isValidApiFailure = (value) => { try { normalizeApiFailure(value); return true; } catch { return false; } };
export const isValidRawEvidenceEnvelope = (value) => { try { normalizeRawEvidenceEnvelope(value); return true; } catch { return false; } };
export const isValidWjKeywordRecord = (value) => { try { normalizeWjKeywordRecord(value); return true; } catch { return false; } };

export const BlogSearchRequest = normalizeBlogSearchRequest;
export const TrendSearchRequest = normalizeTrendRequest;
export const BlogSearchResponse = normalizeBlogSearchResponse;
export const TrendResponse = normalizeTrendResponse;
export const ApiFailure = normalizeApiFailure;
export const RawEvidenceEnvelope = normalizeRawEvidenceEnvelope;
export const WjKeywordRecord = normalizeWjKeywordRecord;
export const KeywordProvider = normalizeKeywordProvider;
