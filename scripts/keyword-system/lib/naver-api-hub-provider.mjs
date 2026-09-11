// NAVER API HUB keyword provider (WJ keyword system, Task 2).
//
// Talks to the official NAVER API HUB over the NCP API Gateway only.
//   base: https://naverapihub.apigw.ntruss.com
//   blog search:  GET  /search/v1/blog           (format=json)
//   trend search: POST /search-trend/v1/search   (application/json)
//
// Credentials are read exclusively from NCP_NAVER_API_HUB_CLIENT_ID and
// NCP_NAVER_API_HUB_CLIENT_SECRET and sent as the documented API HUB headers
// (X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY). The secret is never
// included in returned errors, messages, or any output.
//
// Every search returns either a normalized success response (matching the
// Task 1 contracts) or a normalized ApiFailure object carrying an explicit
// risk flag. Timeout and network failures resolve to kind network_error;
// malformed JSON to kind malformed_json with the malformed_response risk.

import {
  ContractValidationError,
  normalizeApiFailure,
  redactCredentialValues,
  normalizeBlogSearchRequest,
  normalizeBlogSearchResponse,
  normalizeTrendRequest,
  normalizeTrendResponse,
} from './contracts.mjs';

export const NAVER_API_HUB_BASE_URL = 'https://naverapihub.apigw.ntruss.com';
export const NAVER_API_HUB_TIMEOUT_MS = 10_000;
const NAVER_API_HUB_MAX_RESPONSE_BYTES = 1_000_000;

const PROVIDER_ID = 'naver-api-hub';
const BLOG_ENDPOINT = '/search/v1/blog';
const TREND_ENDPOINT = '/search-trend/v1/search';
const CLIENT_ID_HEADER = 'X-NCP-APIGW-API-KEY-ID';
const CLIENT_SECRET_HEADER = 'X-NCP-APIGW-API-KEY';
const CLIENT_ID_ENV = 'NCP_NAVER_API_HUB_CLIENT_ID';
const CLIENT_SECRET_ENV = 'NCP_NAVER_API_HUB_CLIENT_SECRET';
const BLOG_REQUEST_FIELDS = ['query', 'display', 'start', 'sort', 'format'];

function readCredentials(env) {
  const clientId = typeof env[CLIENT_ID_ENV] === 'string' ? env[CLIENT_ID_ENV].trim() : '';
  const clientSecret = typeof env[CLIENT_SECRET_ENV] === 'string' ? env[CLIENT_SECRET_ENV].trim() : '';
  if (clientId === '' || clientSecret === '') return null;
  return { clientId, clientSecret };
}

function missingCredentialFailure() {
  return normalizeApiFailure({
    kind: 'auth_missing',
    status: 0,
    retryable: false,
    message: 'Keyword API client credentials are not configured',
  });
}

function buildBlogUrl(request) {
  const url = new URL(BLOG_ENDPOINT, NAVER_API_HUB_BASE_URL);
  for (const key of BLOG_REQUEST_FIELDS) url.searchParams.set(key, String(request[key]));
  return url;
}

function buildTrendInit(request, headers, signal) {
  headers.set('Content-Type', 'application/json');
  return {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
    signal,
  };
}

function networkFailure(error, timeoutMs, redactionValues = []) {
  const name = String(error?.name ?? error?.reason?.name ?? '');
  let message = 'Keyword API network request failed';
  if (name === 'TimeoutError' || error?.signal?.aborted === true) {
    message = `Keyword API request timed out after ${timeoutMs} ms`;
  } else if (name === 'AbortError') {
    message = 'Keyword API request was aborted';
  }
  return normalizeApiFailure({ kind: 'network_error', status: 0, retryable: true, risk_flags: ['api_error'], message }, { redactValues: redactionValues });
}

function malformedJsonFailure(redactionValues = []) {
  return normalizeApiFailure({
    kind: 'malformed_json',
    status: 0,
    retryable: false,
    message: 'response body was not valid JSON',
    risk_flags: ['malformed_response'],
  }, { redactValues: redactionValues });
}

function responseTooLargeFailure(status, redactionValues = []) {
  return normalizeApiFailure({
    kind: 'malformed_response',
    status: Number.isInteger(status) && status >= 0 && status <= 599 ? status : 0,
    retryable: false,
    message: `Keyword API response exceeded ${NAVER_API_HUB_MAX_RESPONSE_BYTES} bytes`,
    risk_flags: ['malformed_response'],
  }, { redactValues: redactionValues });
}

async function readResponseText(response) {
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const bytes = chunk.value instanceof Uint8Array ? chunk.value : new Uint8Array(chunk.value);
      totalBytes += bytes.byteLength;
      if (totalBytes > NAVER_API_HUB_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        const error = new Error('response body exceeded configured limit');
        error.code = 'NAVER_RESPONSE_TOO_LARGE';
        throw error;
      }
      chunks.push(Buffer.from(bytes));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > NAVER_API_HUB_MAX_RESPONSE_BYTES) {
    const error = new Error('response body exceeded configured limit');
    error.code = 'NAVER_RESPONSE_TOO_LARGE';
    throw error;
  }
  return text;
}

function httpFailure(status, text, redactionValues = []) {
  let body;
  try {
    body = redactCredentialValues(JSON.parse(text), redactionValues);
  } catch {
    body = undefined;
  }
  if (body !== undefined && body !== null && typeof body === 'object' && !Array.isArray(body)) {
    return normalizeApiFailure({ status, body }, { redactValues: redactionValues });
  }
  return normalizeApiFailure({
    status,
    body: {},
    message: `Keyword API returned non-JSON HTTP ${status} response`,
  }, { redactValues: redactionValues });
}

async function run(searchKind, request, state) {
  const credentials = readCredentials(state.env);
  if (credentials === null) return missingCredentialFailure();
  const redactionValues = [credentials.clientId, credentials.clientSecret];

  const signal = AbortSignal.timeout(state.timeoutMs);
  const headers = new Headers({
    [CLIENT_ID_HEADER]: credentials.clientId,
    [CLIENT_SECRET_HEADER]: credentials.clientSecret,
  });

  const url = searchKind === 'blog' ? buildBlogUrl(request) : new URL(TREND_ENDPOINT, NAVER_API_HUB_BASE_URL);
  const init = searchKind === 'blog'
    ? { method: 'GET', headers, signal }
    : buildTrendInit(request, headers, signal);

  let response;
  try {
    response = await state.fetchImpl(url.href, init);
  } catch (error) {
    return networkFailure(error, state.timeoutMs, redactionValues);
  }

  let text;
  try {
    text = await readResponseText(response);
  } catch (error) {
    if (error?.code === 'NAVER_RESPONSE_TOO_LARGE') return responseTooLargeFailure(response.status, redactionValues);
    return networkFailure(error, state.timeoutMs, redactionValues);
  }

  if (!response.ok) return httpFailure(response.status, text, redactionValues);

  let parsed;
  try {
    parsed = redactCredentialValues(JSON.parse(text), redactionValues);
  } catch {
    return malformedJsonFailure(redactionValues);
  }

  try {
    return searchKind === 'blog'
      ? normalizeBlogSearchResponse(parsed)
      : normalizeTrendResponse(parsed);
  } catch (error) {
    if (error instanceof ContractValidationError) {
      return normalizeApiFailure({
        kind: 'malformed_response',
        status: 0,
        retryable: false,
        message: error.message,
        risk_flags: ['malformed_response'],
      }, { redactValues: redactionValues });
    }
    throw error;
  }
}

// clock is accepted for interface compatibility with the keyword provider
// contract and reserved for deterministic request metadata in later tasks.
export function createNaverApiHubProvider(options = {}) {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch ? globalThis.fetch.bind(globalThis) : undefined);
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? NAVER_API_HUB_TIMEOUT_MS;
  if (typeof fetchImpl !== 'function') throw new TypeError('createNaverApiHubProvider: fetchImpl is required');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('createNaverApiHubProvider: timeoutMs must be a positive integer');

  const state = { fetchImpl, env, timeoutMs };

  return Object.freeze({
    providerId: PROVIDER_ID,
    async searchBlogs(request) {
      return run('blog', normalizeBlogSearchRequest(request), state);
    },
    async searchTrends(request) {
      return run('trend', normalizeTrendRequest(request), state);
    },
  });
}
