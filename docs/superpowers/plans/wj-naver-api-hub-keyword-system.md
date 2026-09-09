# WJ NAVER API HUB 키워드 수집·분석 시스템 구현 계획

## TL;DR (For humans)

이 계획은 WJ Blog에만 속한 Node 모듈을 추가해 NAVER API HUB의 공식 블로그 검색과 검색어 트렌드를 수집하고, 원자료와 분석 결과를 Git에서 추적 가능한 JSON 파일로 남기며, 글감 후보의 상태를 사람 승인 가능한 `ready-to-write`까지 관리한다. 기존 Astro 글 생성기와 `scripts/auto-publish/auto-write.mjs`, `scripts/auto-publish/calendar.md`의 실행 방식은 보존하고, 완성된 후보는 명시적인 수동 handoff 파일로만 전달한다.

NCP 인증 값은 `NCP_NAVER_API_HUB_CLIENT_ID`와 `NCP_NAVER_API_HUB_CLIENT_SECRET` 환경 변수에서만 읽는다. API HUB base URL은 `https://naverapihub.apigw.ntruss.com`, 블로그 검색은 `GET /search/v1/blog`, 검색어 트렌드는 `POST /search-trend/v1/search`를 사용한다. API 응답·요청 파라미터·수집 시각은 raw evidence에 보존하되 인증 헤더와 secret은 저장·출력하지 않는다.

이 계획에 포함하지 않는 것은 AutoStudio 코드/DB/점수/대시보드/자동 발행, 비공식 자동완성 endpoint, Google adapter의 실제 구현, 기존 글 생성기 수정, API secret의 코드·문서·로그 유입이다. 구현은 7개 TDD task와 4개 최종 검증 task로 진행하며, 자격증명이 없으면 외부 호출 대신 고정 fixture로 동일 경로를 검증한다.

## Scope

### In scope

- Astro/Node 저장소에 `scripts/keyword-system/` 전용 모듈 경계를 만든다. 모듈은 API transport, raw evidence 저장, 입력 discovery, deterministic analysis, record 상태 저장으로 나눈다.
- NAVER API HUB 공식 블로그 검색과 검색어 트렌드만 provider로 구현한다.
- NCP credential 환경 변수, base URL, API path, request/response 계약, HTTP 및 API-level error 계약을 고정한다.
- seed JSON, 선택적 title/description에서 후보를 만드는 최소 deterministic discovery를 제공한다.
- WJ keyword record를 JSON canonical store로 저장한다. record는 최소 다음 필드를 갖는다.

  ```text
  category, head_keyword, related_keywords, search_intent, content_angle,
  source, collected_at, freshness, risk_flags, evidence_available, status
  ```

- candidate 상태 전이와 수동 글 작성 handoff를 파일 계약으로 남긴다.
- 실제 자격증명이 없을 때 mock fixture로 성공, 빈 결과, 잘못된 JSON, 401/403/429/5xx, 네트워크 실패를 재현한다.
- 기존 `scripts/auto-publish/` 파일은 읽기 전용 참조만 하고 수정하지 않는다.

### Must NOT have

- AutoStudio 이식, AutoStudio DB/schema, 저장형 점수 또는 총점, 대시보드/UI, cron/daemon, 자동 calendar 수정, 자동 글 생성·발행.
- Naver 웹페이지 scraping, 자동완성/비공식 endpoint, Google API 또는 Google provider 구현. 향후 provider를 추가할 수 있는 내부 interface 이름만 남긴다.
- API secret을 소스, fixture, raw file, console output, error object, test snapshot, Markdown 문서에 기록하는 동작.
- 검색량 절대값을 제공한다고 가장하는 계산. Search Trend의 `ratio`는 해당 요청 내 상대값으로만 보존·해석한다.
- API 호출 실패 또는 `items: []`/`results: []`를 성공적인 evidence로 저장하거나 후보를 `ready-to-write`로 승격하는 동작.

## 확인된 저장소 사실과 외부 계약

- 프로젝트는 `package.json`의 ESM Node scripts와 Astro strict TypeScript를 함께 사용한다. 현재 npm test script는 없고 CI는 Node 24에서 `npm ci`, `npm run check:prompts`, `npm run check:content`, `npm run build`, `npm run check:build`를 실행한다. 따라서 새 순수 Node 모듈 테스트에는 Node 24 내장 `node:test`와 `node:assert/strict`를 사용한다.
- 콘텐츠 원본은 Git/Markdown이며 `.env`와 `.env.*`는 무시되고 `.env.example`만 추적된다. raw evidence와 keyword records는 `data/keywords/` 아래에 둔다. `data/`를 Astro content나 `public/`으로 연결하지 않아 공개 build 산출물에 들어가지 않게 한다.
- 공식 [NAVER API HUB 개요](https://api.ncloud-docs.com/docs/naver-api-hub-overview)는 base URL, NCP header, API Gateway/Search/Trend error body 차이를 정의한다.
- 공식 [블로그 검색 결과 조회](https://api.ncloud-docs.com/docs/naver-api-hub-search-blog)는 `GET /search/v1/blog`, `query`, `display(1..100)`, `start(1..1000)`, `sort(sim|date)`, `format(json|xml)` 및 `items` 필드를 정의한다. 구현은 JSON만 요청한다.
- 공식 [검색어 트렌드 조회](https://api.ncloud-docs.com/docs/naver-api-hub-search-trend)는 `POST /search-trend/v1/search`, 날짜/단위/최대 5개 keyword group/그룹당 최대 20 keywords와 `results[].data[].ratio`를 정의한다.
- API HUB 공통 문서 기준 401은 인증 실패, 403은 허용되지 않은 호출, 429는 일일 호출 한도 초과, 500은 서버 오류다. API Gateway 오류는 `{error:{errorCode,message,details}}`, Search 오류는 `{errorCode,errorMessage}`, Trend 오류는 `{errMsg,errId,body}`일 수 있으므로 파서는 세 shape을 구분한다.
- 기존 `HANDOFF.md`의 키워드 계약과 상태(`candidate`, `researching`, `ready-to-write`, `written`, `rejected`)는 요구사항의 출발점으로 사용하되, 이번 구현은 API HUB 계약과 이 문서의 JSON schema를 우선한다.

## 결정된 계약

### 실행 위치와 npm scripts

- Node 실행 위치는 저장소 root다. 모든 명령은 root에서 `node ...` 또는 `npm run ...`으로 실행한다.
- 추가할 scripts는 다음과 같다.

  ```json
  "test:keywords": "node --test scripts/keyword-system/**/*.test.mjs",
  "keywords:discover": "node scripts/keyword-system/discover.mjs",
  "keywords:collect": "node scripts/keyword-system/collect.mjs",
  "keywords:analyze": "node scripts/keyword-system/analyze.mjs"
  ```

- CLI는 실패 시 non-zero exit code를 반환하고, 성공 시에도 secret·전체 response header를 출력하지 않는다. 기본 출력은 기록한 파일 path, 상태, 집계뿐이며 raw body는 파일에만 쓴다.

### 인증과 endpoint

```text
NCP_NAVER_API_HUB_CLIENT_ID      -> X-NCP-APIGW-API-KEY-ID
NCP_NAVER_API_HUB_CLIENT_SECRET  -> X-NCP-APIGW-API-KEY
NAVER_API_HUB_BASE_URL           -> optional override for tests only; production default is
                                    https://naverapihub.apigw.ntruss.com
```

운영 CLI는 base URL override를 허용하지 않거나 명시적으로 fixture transport 모드로만 허용한다. 실제 API adapter는 위 base URL에 다음 path를 조합한다.

```text
blog search:  GET  /search/v1/blog?query=<UTF-8>&display=<1..100>&start=<1..1000>&sort=<sim|date>&format=json
trend:        POST /search-trend/v1/search
```

두 호출 모두 `fetch`를 통해 timeout `10_000ms`를 적용한다. 무제한 retry는 하지 않는다. 429는 `retryable: true`와 `rate_limited` risk flag를 남기고 현재 실행을 실패시킨다. 재시도는 다음 명시적 CLI 실행에서만 한다.

### Raw evidence 형식과 경로

- canonical path: `data/keywords/raw/<YYYY>/<MM>/<DD>/<run-id>/<source>-<safe-key>.json`
- `<run-id>`는 UTC `YYYYMMDDTHHMMSSZ-<8-char-random>` 형식이다. 테스트에서는 clock/id provider를 주입해 고정한다.
- `source`는 `naver-api-hub-blog` 또는 `naver-api-hub-trend`다. `safe-key`는 normalized head keyword의 UTF-8 slug이며 path traversal 문자를 제거한다.
- JSON envelope는 다음 shape을 고정한다. `request.headers`는 절대 저장하지 않는다.

  ```json
  {
    "schema_version": 1,
    "provider": "naver-api-hub",
    "source": "naver-api-hub-blog",
    "endpoint": "/search/v1/blog",
    "method": "GET",
    "request": { "query": "...", "display": 10, "start": 1, "sort": "date", "format": "json" },
    "collected_at": "2026-09-09T00:00:00.000Z",
    "http": { "status": 200, "ok": true },
    "response": { "lastBuildDate": "...", "total": 0, "start": 1, "display": 10, "items": [] }
  }
  ```

- 실패 envelope도 같은 path/shape로 저장할 수 있지만 `http.ok: false`, `error.kind`, `error.code`, `error.message`만 남기고 secret·authorization header·raw request body의 credential을 절대 남기지 않는다. malformed JSON은 `response`를 만들지 않고 `error.kind: "malformed_json"`로 저장한다.
- trend 요청의 `keywordGroups`, 날짜, `device`, `gender`, `ages`는 보존하되 응답은 공식 JSON의 `startDate`, `endDate`, `timeUnit`, `results`를 그대로 보존한다. `ratio`를 반올림하거나 합산하지 않는다.

### WJ keyword record와 상태

canonical record path는 `data/keywords/records.json`이며 JSON array를 `category`, `head_keyword`, `status` 순으로 stable sort하고 2-space pretty print한다. 각 record는 아래 필드를 모두 가진다.

```json
{
  "category": "ai-it",
  "head_keyword": "...",
  "related_keywords": ["...", "..."],
  "search_intent": "방법|개념|비교|문제 해결|최신 이슈",
  "content_angle": "독자가 해결할 문제와 WJ가 검증할 관점",
  "source": ["naver-api-hub-blog", "naver-api-hub-trend"],
  "collected_at": "2026-09-09T00:00:00.000Z",
  "freshness": "fresh|stale|unknown",
  "risk_flags": [],
  "evidence_available": true,
  "status": "candidate|researching|ready-to-write|written|rejected"
}
```

- `related_keywords`는 중복 제거 후 2~5개여야 `ready-to-write`가 될 수 있다. 수집 전에는 빈 배열을 허용하되 ready 승격은 금지한다.
- `source`는 URL이 아니라 provider/source ID이며 raw evidence path는 별도 `evidence` index에 연결한다. `content_angle`은 API가 생성하는 값이 아니라 seed/title/description 입력과 deterministic intent 규칙으로 만든다.
- `freshness`: 마지막 수집이 7일 이내면 `fresh`, 8~30일이면 `stale`, 그 외 또는 수집일 없음이면 `unknown`. 날짜 비교는 주입한 clock의 UTC date로만 한다.
- `risk_flags`는 stable lexical sort한 enum/문자열 배열이다. 최소 `api_error`, `rate_limited`, `auth_missing`, `forbidden`, `malformed_response`, `empty_evidence`, `broad_keyword`, `sensitive_topic`, `stale_evidence`, `insufficient_related_keywords`를 정의한다.
- `evidence_available`는 성공 HTTP 200이고 JSON shape 검증을 통과했으며 raw file이 존재할 때만 true다. `items: []` 또는 `results: []`는 `empty_evidence`를 붙이고 false로 둔다.

허용 상태 전이는 다음과 같다.

```text
candidate --collection started--> researching
researching --valid evidence + deterministic analysis--> ready-to-write
researching --failure/empty/malformed--> candidate (risk flag retained)
ready-to-write --human selects and writer handoff recorded--> written
candidate|researching|ready-to-write --human rejects with reason--> rejected
rejected --new explicit seed/run--> candidate
```

수집기나 분석기는 `written`을 자동으로 만들지 않는다. `written`은 기존 writer가 실제 초안을 저장하고 사람이 handoff manifest를 갱신하는 별도 작업에서만 허용한다. `rejected`에는 reason을 record 외부 `data/keywords/decisions.jsonl`에 기록하고, record 필드 계약을 임의로 확장하지 않는다.

### Deterministic discovery와 analysis 규칙

- 입력 path 기본값은 `data/keywords/seeds.json`이다. shape은 `{ "version": 1, "inputs": [{ "category": "ai-it", "seeds": ["..."], "title": "...", "description": "..." }] }`이다. `seeds`는 필수 non-empty string array, category는 기존 WJ slug(`ai-it`, `economy`, `health`) 또는 명시된 소문자 kebab-case다.
- discovery는 Unicode NFC → trim → 연속 whitespace 하나 → HTML tag 제거 → punctuation 경계 분리 순으로 정규화한다. 명시 seed는 그대로 head candidate가 되고, title/description에서는 2~4 token contiguous phrase를 순서대로 생성한다. 길이 2 미만 token, stopword, 숫자만인 phrase는 제거한다. 입력 순서와 첫 등장 순서를 보존한 뒤 normalized keyword로 dedupe한다.
- `head_keyword`는 명시 seed 우선, seed가 없으면 title/description phrase 중 가장 긴 첫 후보다. 관련어는 같은 category/input에서 head와 다른 후보를 첫 등장 순서로 채우고 최대 5개로 자른다. 결과가 2개 미만이면 `insufficient_related_keywords`를 붙인다.
- search intent는 명시 `intent`가 있으면 허용 enum인지 검증하고, 없으면 deterministic marker 우선순위를 적용한다: `방법|하는 법|설정`→`방법`, `비교|차이|추천`→`비교`, `문제|오류|안 될`→`문제 해결`, `최신|변경|업데이트`→`최신 이슈`, 그 외→`개념`.
- content angle은 입력 description이 있으면 normalized description을 사용하고, 없으면 `head_keyword + "를 WJ가 공식 근거와 실제 확인 항목 중심으로 설명"` 템플릿을 사용한다. 모델 호출·랜덤 선택·검색량 score는 없다.
- blog response에서는 `total`, `items[].title`, `description`, `link`, `postdate`를 검증하고 `<b>` tag를 제거한 text만 derived evidence에 넣는다. trend response에서는 `results[].title`, `keywords`, `data[].period`, `data[].ratio`의 타입과 날짜 형식을 검증한다. trend ratio는 각 group의 latest/max/average를 deterministic metadata로 계산할 수 있지만 score나 순위로 저장하지 않는다.
- `freshness`·risk·상태는 동일 입력 + 동일 fixture + 동일 UTC clock이면 byte-stable 결과여야 한다. API response ordering은 provider가 준 순서를 보존하되 record array는 stable sort한다.

### Google future boundary

`KeywordProvider` interface는 `providerId`, `searchBlogs(request)`, `searchTrends(request)`와 normalized result/error 반환 계약을 정의한다. 이번 task에서는 `NaverApiHubProvider` 하나만 등록한다. `google` 이름, endpoint, credential, implementation, fixture는 만들지 않으며, 향후 adapter를 추가할 위치와 provider registry의 unknown-provider error만 테스트한다.

## Verification strategy

- 테스트는 구현보다 먼저 추가한다. 각 task는 `node:test` unit test → fixture contract test → provider/store integration test 순으로 작성한다.
- 네트워크는 기본적으로 주입한 `fetchImpl` mock으로 차단한다. 자격증명이 없으면 실제 endpoint를 호출하지 않고 `scripts/keyword-system/fixtures/naver-api-hub/` fixture를 사용한다. 자격증명이 있어도 테스트 명령은 외부 호출을 자동으로 하지 않는다.
- API fixture에는 성공 blog/trend, empty, malformed JSON, gateway 401, forbidden 403, rate limited 429, server 500, trend validation error를 각각 둔다. 테스트는 status와 body shape, risk flag, status transition, raw path를 함께 단언한다.
- secret sentinel을 환경 변수로 넣은 test request를 실행해 raw files, stdout/stderr, thrown error에 sentinel이 없음을 검사한다.
- 최종 명령은 `npm run test:keywords`, `npm run check:prompts`, `npm run check:content`, `npm run build`, `npm run check:build`이며, 변경 파일에서 `rg -n "X-Naver-Client|openapi\\.naver\\.com|AutoStudio|google" scripts/keyword-system data/keywords .env.example`로 금지 boundary를 확인한다. 공식 API HUB endpoint와 future adapter 문구의 의도된 문서/상수는 예외 목록으로 검사한다.

## Execution strategy

모든 구현은 저장소 root에서 실행한다. Task 1의 schema/fixture와 실패 테스트가 기준을 만들고, Task 2~5가 provider와 analysis를 순차 구현하며, Task 6이 CLI/record handoff를 묶고, Task 7이 환경·script·CI 경계를 고정한다. Task 2와 Task 4는 Task 1 계약 이후 병렬화할 수 있지만, Task 6은 2~5 완료 후에 시작한다.

의존성 매트릭스:

| Task | 산출물 | 선행 | 후속 |
| --- | --- | --- | --- |
| 1 | schema, fixtures, test harness | 없음 | 2, 3, 4, 5 |
| 2 | API HUB client/provider | 1 | 5, 6 |
| 3 | raw evidence store/parser | 1 | 5, 6 |
| 4 | discovery/seed parser | 1 | 5, 6 |
| 5 | deterministic analysis/state rules | 1, 2, 3, 4 | 6, 7 |
| 6 | CLI orchestration/record handoff | 2, 3, 4, 5 | 7, final wave |
| 7 | npm/env/docs/build boundary | 5, 6 | final wave |

## Todos

- [ ] 1. 키워드 계약·fixture·Node test harness를 `scripts/keyword-system/lib/contracts.mjs`, `scripts/keyword-system/fixtures/`, `scripts/keyword-system/*.test.mjs`에 고정한다.

  **Files:** 새 `contracts.mjs`, `fixtures/naver-api-hub/{blog-success.json,trend-success.json,empty.json,malformed.json,error-401.json,error-403.json,error-429.json,error-500.json,trend-validation.json}`, `test-helpers.mjs`, 계약 테스트 파일을 만든다. `data/keywords/seeds.json`와 `data/keywords/README.md`의 예시 입력·경계를 추가한다.

  **Interfaces:** `BlogSearchRequest`, `TrendSearchRequest`, `BlogSearchResponse`, `TrendResponse`, `ApiFailure`, `RawEvidenceEnvelope`, `WjKeywordRecord`, `KeywordProvider`의 runtime validation/normalization 계약을 export한다. 모든 enum과 required field를 한 곳에서 정의한다.

  **TDD:** 먼저 valid/invalid request, response shape, record field 누락, status enum, fixture body shape가 실패하는 테스트를 작성하고, 그 뒤 순수 validator/normalizer를 구현한다. fixture는 실제 secret 없이 공식 문서의 필드와 샘플 구조만 사용한다.

  **Acceptance:** 잘못된 query/display/date/group 수가 deterministic error를 내고, 401/403/429/500 및 세 종류 error body가 `ApiFailure`로 정규화되며, record가 요구된 11개 필드를 빠짐없이 갖는다. `node --test scripts/keyword-system/contracts.test.mjs`가 통과한다.

  **QA:** happy: 성공 fixture를 validate해 typed normalized object를 얻는다. failure: malformed/empty/error fixture가 성공 object나 evidence_available=true로 변환되지 않는 것을 테스트 output `test-results/contracts.tap`에서 확인한다.

  **Dependencies:** Node 24 내장 modules만 사용한다. 외부 npm dependency를 추가하지 않는다.

  **References:** `package.json`, `tsconfig.json`, `.gitignore`, `README.md`의 Node/Astro 실행 및 build 관례.

  **Commit:** `feat: define WJ keyword system contracts and fixtures`

- [ ] 2. NAVER API HUB provider를 `scripts/keyword-system/lib/naver-api-hub-provider.mjs`와 provider 테스트로 구현한다.

  **Files:** `naver-api-hub-provider.mjs`, `transport.mjs` 또는 동일 모듈의 injected fetch helper, `naver-api-hub-provider.test.mjs`를 만든다. 기존 `scripts/auto-publish/`는 수정하지 않는다.

  **Interfaces:** `createNaverApiHubProvider({ fetchImpl, env, clock })`는 `searchBlogs(request)`와 `searchTrends(request)`를 제공한다. production credential은 `NCP_NAVER_API_HUB_CLIENT_ID`/`NCP_NAVER_API_HUB_CLIENT_SECRET`에서만 읽고, headers는 정확히 API HUB 이름으로 만든다. blog GET query와 trend POST JSON body를 계약대로 직렬화한다.

  **TDD:** 먼저 injected fetch가 기대 URL/method/query/body/header를 받는 테스트, missing credential, timeout/network error, 401/403/429/500, gateway/search/trend body parser 테스트를 작성한다. 이후 provider를 구현한다. fetch mock은 response body를 한 번만 읽도록 구성한다.

  **Acceptance:** base URL default와 두 endpoint가 정확하며, blog는 `format=json`, trend는 `Content-Type: application/json`을 사용한다. secret은 error/message/console에 나타나지 않고, 429는 retryable/rate_limited, 401은 auth_missing, 403은 forbidden으로 분류된다. 실제 네트워크가 없는 환경에서도 fixture transport로 같은 normalized result를 만든다.

  **QA:** happy: fixture fetch로 blog items와 trend results가 반환된다. failure: credential 없음, 401, 403, 429, malformed JSON, AbortError가 각각 non-success `ApiFailure`와 명시 risk flag를 내고 `node --test scripts/keyword-system/naver-api-hub-provider.test.mjs` 결과로 남는다.

  **Dependencies:** Task 1 계약/fixture. 공식 [API HUB 개요](https://api.ncloud-docs.com/docs/naver-api-hub-overview), [블로그 API](https://api.ncloud-docs.com/docs/naver-api-hub-search-blog), [트렌드 API](https://api.ncloud-docs.com/docs/naver-api-hub-search-trend).

  **References:** `HANDOFF.md` 키워드 시스템 handoff; 공식 [NAVER API HUB 개요](https://api.ncloud-docs.com/docs/naver-api-hub-overview), [블로그 검색](https://api.ncloud-docs.com/docs/naver-api-hub-search-blog), [검색어 트렌드](https://api.ncloud-docs.com/docs/naver-api-hub-search-trend).

  **Commit:** `feat: add Naver API HUB keyword provider`

- [ ] 3. raw evidence 저장소와 응답 sanitizer를 `scripts/keyword-system/lib/evidence-store.mjs`에 구현한다.

  **Files:** `evidence-store.mjs`, `evidence-store.test.mjs`, 필요 시 `data/keywords/raw/.gitkeep`를 추가한다. 저장 root는 `data/keywords/raw`로 고정하며 `public/`, `src/content/`, `out/`에는 쓰지 않는다.

  **Interfaces:** `writeEvidence({ source, endpoint, method, request, response, http, collectedAt, runId, rootDir })`와 `writeFailureEvidence(...)`를 제공한다. path sanitizer, stable JSON writer, redacted error envelope, evidence index entry를 export한다.

  **TDD:** 먼저 날짜/run-id/path-safe key, stable JSON, success envelope, failure envelope, secret redaction, atomic write 테스트를 작성하고 구현한다. 테스트 clock/id/root을 주입해 byte output을 고정한다.

  **Acceptance:** canonical path가 `data/keywords/raw/YYYY/MM/DD/run-id/source-safe-key.json`이고 JSON 2-space output이 재실행에도 stable하다. headers/secret/sentinel이 저장되지 않으며, malformed/empty/error는 evidence_available=false로 연결된다. parent directory 생성과 partial file 정리가 검증된다.

  **QA:** happy: success blog/trend fixture를 저장하고 JSON을 다시 읽어 schema와 path를 검사한다. failure: path traversal keyword, write failure, secret-bearing error, empty response를 실행해 secret 부재와 실패 상태를 `test-results/evidence.tap`에서 확인한다.

  **Dependencies:** Task 1 계약; Task 2 normalized provider result. Node `node:fs/promises`, `node:path`, `node:crypto`만 사용한다.

  **References:** `.gitignore`의 local output 경계; `scripts/check-build.mjs`의 dist leakage 검사 관례.

  **Commit:** `feat: persist redacted keyword evidence`

- [ ] 4. seed/title/description 기반 최소 discovery를 `scripts/keyword-system/lib/discovery.mjs`에 구현한다.

  **Files:** `discovery.mjs`, `discovery.test.mjs`, `data/keywords/seeds.json` sample을 만든다. CLI wiring은 Task 6에서 하고 이 task는 pure function으로 유지한다.

  **Interfaces:** `parseSeedInput(input)`, `discoverCandidates(input, { stopwords })`, `normalizeKeyword(text)`, `inferSearchIntent(text)`를 export한다. 입력 shape은 `version:1`과 category별 `seeds`, optional `title`, `description`, optional explicit intent다.

  **TDD:** 먼저 NFC/whitespace/HTML/punctuation normalization, explicit seed precedence, title/description 2~4-token phrase, duplicate/stopword/numeric-only filtering, category grouping, intent priority 테스트를 작성한다. 그 뒤 deterministic candidate generator를 구현한다.

  **Acceptance:** 동일 input이 호출 순서·locale·randomness와 무관하게 동일 후보 배열을 만들고, head keyword 1개와 related 0~5개를 생성한다. unsupported category/empty seed/invalid intent는 입력 오류이며, 후보가 너무 넓거나 related 2개 미만이면 risk flag를 추가한다. 외부 API 또는 LLM을 호출하지 않는다.

  **QA:** happy: WJ의 `ai-it`, `economy`, `health` sample seed와 제목/설명에서 후보·intent·content angle을 생성한다. failure: HTML, blank, duplicate, 숫자-only, malformed input을 넣어 deterministic rejection과 `test-results/discovery.tap`을 남긴다.

  **Dependencies:** Task 1 계약. Node built-ins only.

  **References:** `HANDOFF.md`의 seed/category/search-intent/record 운영 기준; `scripts/auto-publish/calendar.md`는 수동 handoff의 downstream reference로만 읽는다.

  **Commit:** `feat: add deterministic keyword discovery`

- [ ] 5. deterministic analysis와 candidate 상태 전이를 `scripts/keyword-system/lib/analysis.mjs`에 구현한다.

  **Files:** `analysis.mjs`, `analysis.test.mjs`, `records-schema.test.mjs`를 만든다. 필요 시 response-specific parsers는 `analysis.mjs` 옆 순수 helper로 둔다.

  **Interfaces:** `analyzeCandidate(candidate, evidence, { now })`, `deriveBlogSignals(blogResponse)`, `deriveTrendSignals(trendResponse)`, `transitionStatus(record, event)`를 export한다. score/rank field는 export하지 않는다.

  **TDD:** 먼저 success evidence, empty, malformed, API failure, stale date, sensitive-topic marker, insufficient related keywords 및 각 상태 전이 테스트를 작성한다. 이후 freshness/risk derivation과 stable sorting을 구현한다.

  **Acceptance:** valid non-empty evidence만 `evidence_available:true`가 되고, evidence + required metadata + related 2~5 + no blocking risk일 때만 `ready-to-write`가 된다. API failure/empty/malformed는 `candidate` 또는 기존 `researching`으로 되돌리고 risk를 보존한다. `written`은 explicit handoff event 없이는 거절하고, rejected는 reason 없는 전이를 거절한다. trend ratio는 상대값 metadata로만 유지하고 score를 만들지 않는다.

  **QA:** happy: 두 API 성공 fixture로 record를 ready-to-write까지 만든다. failure: 401/403/429/500/empty/malformed/stale/sensitive fixture를 넣어 상태가 잘못 승격되지 않는 것을 `test-results/analysis.tap`에서 검증한다.

  **Dependencies:** Task 1~4. 공식 trend 응답의 `ratio`가 요청 내 최대값 100인 상대값이라는 [문서 계약](https://api.ncloud-docs.com/docs/naver-api-hub-search-trend)을 따른다.

  **References:** `HANDOFF.md`의 상태 전이와 WJ keyword record 초안; 공식 [검색어 트렌드 응답 계약](https://api.ncloud-docs.com/docs/naver-api-hub-search-trend).

  **Commit:** `feat: analyze keyword evidence and transitions`

- [ ] 6. 수집·분석 CLI와 record/handoff 저장을 `scripts/keyword-system/{discover,collect,analyze}.mjs` 및 `scripts/keyword-system/lib/records-store.mjs`에 연결한다.

  **Files:** `discover.mjs`, `collect.mjs`, `analyze.mjs`, `records-store.mjs`, `records-store.test.mjs`, `cli.integration.test.mjs`, `data/keywords/records.json`, `data/keywords/evidence-index.jsonl`, `data/keywords/decisions.jsonl`, `data/keywords/ready-to-write.json`를 만든다. `ready-to-write.json`은 사람이 writer에 전달하는 export이지 auto-write 입력을 자동 변경하지 않는다.

  **Interfaces:** `records-store`는 `readRecords`, `upsertRecords`, `writeReadyToWriteExport`, `appendDecision`을 제공한다. collect는 `--seed-file`, `--out-dir`, `--fixture`, `--dry-run`을 받고 analyze는 raw evidence path와 records path를 명시적으로 받는다. CLI는 exit code와 redacted summary만 출력한다.

  **TDD:** 먼저 temp directory에서 discover→collect(mock fixture)→analyze→export의 integration test를 작성하고, duplicate run, partial failure, interrupted write, invalid transition, missing raw evidence, no credentials를 실패 시나리오로 고정한 뒤 구현한다.

  **Acceptance:** 명시 seed 1건이 raw evidence, record, evidence index, ready export까지 추적되고, 실패한 API call은 record를 ready/written으로 만들지 않는다. records.json은 stable sort/pretty JSON이고 evidence-index/decisions는 append-only JSONL이다. `written`은 외부 writer 결과를 명시한 decision 없이 생기지 않으며 auto calendar 파일은 바뀌지 않는다. 모든 output은 `data/keywords/` 아래에만 생성된다.

  **QA:** happy: `node scripts/keyword-system/collect.mjs --fixture ...`와 `node scripts/keyword-system/analyze.mjs --records ...`를 temp workspace에서 실행해 traceable artifact를 확인한다. failure: no credential, 429, malformed, rerun, SIGINT-style partial state를 실행해 non-zero exit와 미승격 상태를 `test-results/cli-integration.tap`에서 확인한다.

  **Dependencies:** Task 2~5. 기존 `scripts/auto-publish/calendar.md`와 `auto-write.mjs`는 handoff reference only다.

  **References:** `scripts/auto-publish/calendar.md`, `scripts/auto-publish/auto-write.mjs`, `HANDOFF.md`의 기존 writer 경계.

  **Commit:** `feat: wire keyword collection and manual writer handoff`

- [ ] 7. 환경 변수·npm scripts·문서·build boundary를 고정하고 전체 회귀 검증을 추가한다.

  **Files:** `.env.example`에 secret 값이 아닌 변수명과 NCP console 발급 안내만 추가하고, `package.json`에 `test:keywords`, `keywords:discover`, `keywords:collect`, `keywords:analyze`를 추가한다. `scripts/keyword-system/README.md`에는 실행 순서·fixture 사용법·상태 전이·secret redaction·Google future boundary를 기록한다. `scripts/keyword-system/build-boundary.test.mjs`와 필요 시 `.gitignore` 예외를 추가한다.

  **Interfaces:** root command와 env 이름은 결정된 계약을 그대로 사용한다. production default base URL은 문서와 코드에서 동일해야 하며, fixture mode는 credential 없이 동작한다.

  **TDD:** 먼저 package script smoke, `.env.example` variable-name, output path, dist leakage, forbidden legacy endpoint/header, Google unimplemented boundary 테스트를 작성한 뒤 scripts/docs를 wiring한다.

  **Acceptance:** `npm run test:keywords`가 전체 keyword test를 실행하고, `npm run keywords:collect -- --fixture ...`가 secret 없이 성공한다. `npm run build`와 `npm run check:build`가 data/keywords와 keyword source를 dist에 포함하지 않는다. `openapi.naver.com`, `X-Naver-Client-*`, AutoStudio DB/score/dashboard/auto-publish 수정이 없다.

  **QA:** happy: clean checkout에서 `npm ci && npm run test:keywords && npm run check:prompts && npm run check:content && npm run build && npm run check:build`를 실행한다. failure: unset env real mode, invalid fixture, forbidden legacy endpoint grep, secret sentinel grep를 실행하고 실패 이유와 non-zero code를 artifact에 기록한다.

  **Dependencies:** Task 6. Node 24 CI contract; 기존 Astro build scripts.

  **References:** `package.json`, `.env.example`, `.gitignore`, `.github/workflows/quality.yml`, `scripts/check-build.mjs`, 공식 [API HUB migration guide](https://guide.ncloud-docs.com/docs/apihub-migration).

  **Commit:** `chore: document and gate keyword system execution`

## Final verification wave

- [ ] F1. 계획 준수 audit: 모든 구현 파일이 `scripts/keyword-system/`·`data/keywords/` 경계 안에 있고 기존 `src/content/posts/`, `scripts/auto-publish/`, AutoStudio 산출물을 수정하지 않았는지 `git diff --stat`와 path allowlist로 확인한다.

- [ ] F2. 계약·품질 audit: `npm run test:keywords`와 `npm run check:prompts`를 실행하고, API HUB endpoint/header, raw schema, record fields, status transitions, malformed/401/403/429/empty 처리의 테스트 결과를 확인한다.

- [ ] F3. 실제 사용자 경로 QA: credential이 없다는 전제에서 fixture mode로 seed 입력→blog/trend raw evidence→analysis→`ready-to-write.json` handoff를 실행하고, records/raw/index/decision 파일을 직접 읽어 상태와 source trace를 확인한다. credential이 제공된 경우에만 별도 opt-in으로 API HUB smoke call을 실행하며 secret은 출력·저장하지 않는다.

- [ ] F4. 범위·보안 audit: `.env.example` 외 secret 없음, raw/output/log에 sentinel 없음, build/dist에 keyword data·secret 없음, Google/AutoStudio/비공식 endpoint 없음, calendar 자동 수정 없음, `npm run build`/`npm run check:build` exit 0을 확인한다.

## Commit strategy

각 task를 위 순서대로 atomic commit한다. fixture/계약→provider→evidence→discovery→analysis→CLI→wiring 순서를 유지하고, 기존 작업 트리의 사용자 변경을 덮어쓰지 않는다. API credential은 commit 대상이 아니며, raw evidence는 실제 운영 수집분을 commit할지 운영자가 별도로 결정하되 secret이 없는 응답 envelope만 허용한다.

## Success criteria

- root에서 문서화된 npm scripts와 fixture mode가 자격증명 없이 재현된다.
- NAVER API HUB 공식 endpoint와 NCP header를 사용하고, Google/비공식 endpoint/기존 Developer Center endpoint를 호출하지 않는다.
- 성공 raw evidence와 WJ record가 `data/keywords/` 아래에서 서로 추적되며, 실패·빈 응답·잘못된 JSON은 성공/ready로 위장되지 않는다.
- 후보 discovery와 analysis 결과가 같은 입력·clock·fixture에서 deterministic하고, record 상태 전이가 문서 계약과 일치한다.
- `ready-to-write`는 수동 handoff 파일일 뿐 기존 글 생성기·calendar·발행을 자동 실행하지 않는다.
- API secret은 환경 변수에서만 읽고 코드·문서·raw evidence·로그·dist에 나타나지 않는다.
- `npm run test:keywords`, `npm run check:prompts`, `npm run check:content`, `npm run build`, `npm run check:build`가 모두 통과하고 최종 검증 F1~F4의 증거가 남는다.
