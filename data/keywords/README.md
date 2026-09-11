# WJ keyword data

This directory contains the keyword-system boundary data used by the WJ blog.

`seeds.json` is the legacy/test input file with schema version `1`:

- `version` is `1`.
- `inputs` contains one or more objects with a lowercase kebab-case `category` and a non-empty `seeds` array.
- Canonical live categories are `economy-business`, `ai`, and `travel`.
- Live topic selection does not require manually maintained detailed keywords. `npm run keywords:auto` queries official NAVER blog search by those category queries and writes `automatic-seeds.json` plus `automatic-discovery.json`.
- `title`, `description`, and explicit `intent` are optional. Intent must be one of `방법`, `개념`, `비교`, `문제 해결`, or `최신 이슈`.

Keyword candidates and records are evidence-led. A successful API response with a non-empty, shape-valid body is required before a record can become `ready-to-write`; empty, malformed, and failed responses remain unavailable evidence. Trend `ratio` values are relative values within one request and must not be stored as absolute search volume or converted into a score.

Raw evidence belongs under `data/keywords/raw/` and must not contain request headers, credentials, or secrets. Records use the eleven-field WJ contract:

```text
category, head_keyword, related_keywords, search_intent, content_angle,
source, collected_at, freshness, risk_flags, evidence_available, status
```

The status values are `candidate`, `researching`, `ready-to-write`, `written`, and `rejected`. `written` is a human handoff state; this directory does not trigger or modify the existing auto-publish pipeline.

## 실행 경계

- `npm run test:keywords`는 네트워크 없이 keyword-system의 단위·통합 회귀 테스트를 실행한다.
- `node scripts/keyword-system/discover.mjs --dry-run`은 legacy seed 입력만 검증하고 파일을 쓰지 않는다.
- `npm run keywords:auto -- --dry-run`은 고정 카테고리 조사 계획만 보여주고 network/file write를 수행하지 않는다.
- fixture 검증은 `npm run keywords:auto -- --fixture scripts/keyword-system/fixtures/naver-api-hub --out-dir <workspace>/data/keywords`를 사용한다. fixture와 `--dry-run` 경로는 실제 credentials를 사용하지 않는다.
- 실제 수집은 공식 NAVER API HUB만 사용하며, `NCP_NAVER_API_HUB_CLIENT_ID`와 `NCP_NAVER_API_HUB_CLIENT_SECRET`를 로컬 환경에만 설정한다. 값은 로그·fixture·커밋에 남기지 않는다.
- 수집 후 `node scripts/keyword-system/analyze.mjs`가 evidence와 record를 검증한다. `npm run keywords:brief`는 `ready-to-write`와 같은 키워드의 NAVER 근거를 결합해 사람이 검토할 Markdown과 writer 입력용 JSON 브리프를 만든다. 검토가 끝난 뒤에만 `npm run keywords:draft -- --brief out/keyword-briefs/<category>-<keyword>.json --approve --reviewer "이름" --reason "검토 내용"`을 실행한다. 이 명령은 기존 auto-write를 호출해 `status: draft` 글을 저장하고 writer handoff를 기록하지만, 예약·발행은 수행하지 않는다.
- `raw/`는 로컬 evidence 출력 경계다. 정적 사이트 빌드에는 `data/keywords`와 내부 keyword-system 산출물이 포함되지 않으며, 빌드 경계 검사는 `npm run check:build`에서 확인한다.
