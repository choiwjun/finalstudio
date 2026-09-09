# manualQa — Task 1

Overall verdict: FINDINGS

Review target: commit `46e798e1bae6564bb38e277672006c9c46ad261f` against Task 1 of `docs/superpowers/plans/wj-naver-api-hub-keyword-system.md`.

No implementation files were edited. No external credentials or network were used. The worktree remains at the target commit; existing untracked `docs/` and `.omo/evidence/` files were preserved.

## surfaceEvidence

| scenario id | criterion reference | surface | exact invocation | verdict | artifactRefs |
|---|---|---|---|---|---|
| S1 | Task 1 acceptance, plan:193 | Node test runner / contract suite | `node --test scripts/keyword-system/contracts.test.mjs` | PASS — 12/12 | `art-node22`, `art-fixtures` |
| S2 | Task 1 dependencies, plan:197 | Node 24 test runner | `/home/hunter8891/.codex/plugins/cache/sisyphuslabs/omo/4.19.4/node_modules/@colbymchenry/codegraph-linux-x64/node --test scripts/keyword-system/**/*.test.mjs` | PASS — 12/12 under `v24.16.0` | `art-node24` |
| S3 | Task 1 syntax compatibility | Node parser | `node --check` on `contracts.mjs`, `contracts.test.mjs`, `test-helpers.mjs`; same three files with bundled Node 24 | PASS — all exit 0 | `art-syntax` |
| S4 | Task 1 files/fixture list, plan:187 | Filesystem + JSON parser | `readdir/readFile/JSON.parse` over `scripts/keyword-system/fixtures/naver-api-hub` | PASS — 9 fixtures; 8 valid JSON and 1 intentionally malformed | `art-fixtures` |
| S5 | Task 1 happy QA, plan:195 | Runtime normalizers | Import fixture helpers and normalize `blog-success.json` and `trend-success.json` | PASS — typed fields, HTML tags removed, ratio `61.23` preserved | `art-fixtures` |
| S6 | Task 1 invalid request acceptance, plan:193 | Runtime validators | Inline Node probe for empty query, display bounds, invalid date, and six trend groups | PASS — each rejected with `ContractValidationError` and deterministic path | `art-node22` |
| S7 | Task 1 failure body acceptance, plan:193 | Runtime failure normalizer | Import five error fixtures and call `normalizeApiFailure({status, body})` | PASS — 401/403/429/500/trend validation map to expected kind/risk | `art-fixtures` |
| S8 | Task 1 public interfaces/enums, plan:189 | ESM module exports | Import all eight named contracts and enum arrays | PASS — all eight are functions; enum arrays are present | `art-boundaries` |
| S9 | Task 1 scope boundary, plan:187/199 | Git diff/static scan | `git diff-tree ...`; `git diff --check ...`; forbidden-boundary `rg` | PASS — exact 14 allowed files; clean diff; no forbidden matches | `art-boundaries` |
| S10 | Repository regression context | npm scripts | `npm run check:prompts`; `npm run check:content` | PASS — both exit 0 | `art-repository-checks` |
| S11 | Final verification context | npm scripts | `npm run test:keywords`; `npm run build`; `npm run check:build` | FINDING context only — failures are pre-existing/environmental, not introduced by Task 1 | `art-repository-checks` |

## adversarialCases

| scenario id | criterion reference | adversarial class | expected behavior | verdict | artifactRefs |
|---|---|---|---|---|---|
| A1 | plan:195, plan:329 | empty evidence | Empty `items`/`results` must not be usable success evidence or become `evidence_available:true` | FAIL — both `isValidBlogSearchResponse(empty)` and `isValidTrendResponse(empty)` returned `true`; no unavailable-evidence seam is exercised | `art-adversarial`, `art-probes` |
| A2 | plan:191/195 | malformed JSON | Malformed fixture must become an explicit malformed failure, never a success object | FAIL — helper yields `json=undefined` and direct response normalization rejects, but no path routes it to `ApiFailure(kind: malformed_json)`; the test only checks enum membership | `art-adversarial`, `art-probes` |
| A3 | plan:97-103, plan:329 | HTTP/envelope consistency | Success must be HTTP 200 with `ok:true` and response; failure must be `ok:false` with error and no response | FAIL — `500/true`, `200/false`, and `401/false + response` were all accepted | `art-adversarial`, `art-probes` |
| A4 | plan:7, plan:87-103; README:14 | secret/redaction boundary | Credential values must not survive into normalized/persistable raw evidence or failure text | FAIL — generic response `notice` preserved `Bearer CREDVALUE`, endpoint preserved `apiKey=CREDVALUE`, and failure output was `[redacted]=CREDVALUE`; only credential-looking keys are rejected | `art-adversarial`, `art-probes` |
| A5 | plan:67-75, plan:87-103 | source/endpoint/method/body cross-wiring | Blog is `GET /search/v1/blog`; trend is `POST /search-trend/v1/search`; body must match source | FAIL — trend source with `GET /anything` and blog-shaped response was accepted | `art-adversarial`, `art-probes` |
| A6 | plan:147-149, plan:269 | numeric boundary | Trend ratio is a relative value bounded by 100 | FAIL — `ratio=100.01` normalized successfully | `art-adversarial`, `art-probes` |
| A7 | plan:147, plan:243; README:8 | category grammar | Category must be genuine lowercase kebab-case with non-empty segments | FAIL — `---`, `-ai-it`, and `ai-it-` were accepted | `art-adversarial`, `art-probes` |
| A8 | plan:108-123, record freshness timestamps | calendar validity | UTC timestamp must reject impossible calendar dates | FAIL — `2026-02-30T00:00:00.000Z` was accepted unchanged | `art-adversarial`, `art-probes` |
| A9 | raw evidence safety | prototype pollution | JSON-derived `__proto__` must not alter normalized object prototype | FAIL — output had `proto_injected=yes` and no own `__proto__` field | `art-adversarial`, `art-probes` |
| A10 | plan:42-44, plan:147-149 | response shape invariants | Response pagination/member values must obey the API contract | FAIL — trend group with empty `keywords`/`data`, blog `start=0/display=0`, and `total=0` with one item were accepted | `art-adversarial`, `art-probes` |
| A11 | plan:187, plan:195 | fixture fidelity | Empty fixture should represent a real endpoint body, not a hybrid accepted by both parsers | FAIL — `empty.json` combines blog and trend fields and is passed to both normalizers | `art-adversarial`, `art-probes` |
| A12 | plan:191, plan:195 | behavior-test completeness | Tests must exercise observable behavior, not only constants or a normalizer’s own output | FINDING — suite does not test `searchTrends`, provider failure normalization, malformed `ApiFailure`, or serialized raw evidence; it includes constant/type assertions and `normalize(output)` round trips | `art-node22`, `art-adversarial` |

## Findings

### HIGH — raw-evidence secret boundary is bypassable

File: `scripts/keyword-system/lib/contracts.mjs:155-179,188-220`.

Evidence: `safeValue()` rejects credential-looking keys but copies arbitrary scalar values; `normalizeRawEvidenceEnvelope()` applies it to request and response. The direct probe preserved `Bearer CREDVALUE` and `apiKey=CREDVALUE`; `redact()` produced `[redacted]=CREDVALUE` for a credential assignment. This conflicts with the plan’s no-secret raw evidence rule and the README guarantee.

Required repair: use source-specific allowlists for endpoint/request/response/error fields and redact/reject credential values, bearer/basic assignments, and query credentials. Add serialized-envelope tests using a sentinel in benign-looking values and failure messages.

### HIGH — raw-evidence HTTP state can misrepresent failures as success

File: `scripts/keyword-system/lib/contracts.mjs:207-224`.

Evidence: status and `ok` are validated independently; all three contradictory cases in A3 were accepted. This permits a 500 response to be represented as successful evidence and retains response data on a failed envelope.

Required repair: enforce coherent variants (for this plan, success status 200 + `ok:true` + validated response + no error; failure `ok:false` + error + no response) and add mismatch tests.

### MEDIUM — raw envelope is not source-specific

File: `scripts/keyword-system/lib/contracts.mjs:205-220`.

Evidence: source, method, and endpoint are independently accepted; any non-empty endpoint and either method pass, and response is only deep-copied. The cross-wired probe passed.

Required repair: dispatch by source and enforce exact endpoint/method plus the corresponding response/request validator.

### MEDIUM — empty/malformed evidence behavior is not locked

Files: `scripts/keyword-system/fixtures/naver-api-hub/empty.json:1-8`; `scripts/keyword-system/contracts.test.mjs:124-151`.

Evidence: the hybrid empty fixture validates through both normalizers; malformed JSON only yields `undefined` and a direct object-type rejection; `API_FAILURE_KINDS.includes('malformed_json')` does not exercise normalization. The QA acceptance calls for empty/malformed/error material not to become usable evidence.

Required repair: use endpoint-faithful empty fixtures and add an explicit unavailable-evidence/failure seam or defer success usability until a later contract. Route malformed input to `ApiFailure(kind: malformed_json)` and assert no ready/evidence-available outcome.

### MEDIUM — validators accept invalid documented values

Files: `scripts/keyword-system/lib/contracts.mjs:48-51,110-123,129-149,229-248`.

Evidence: ratios above 100, malformed kebab categories, impossible UTC dates, empty trend members, invalid pagination, and total/item inconsistency all passed the direct probes.

Required repair: enforce canonical timestamp round-trip, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, ratio `0..100`, response pagination/accounting bounds, and required non-empty trend members as applicable to the API contract.

### MEDIUM — test suite leaves critical behavior untested

Files: `scripts/keyword-system/contracts.test.mjs:120-151,198-227`.

Evidence: the suite passes 12/12, but it does not exercise `searchTrends`, provider failure return values, malformed failure normalization, serialized secret absence, HTTP/envelope contradictions, cross-wired source shapes, or ratio/category/timestamp boundaries. Several assertions only inspect hand-authored constant members or normalize an object already returned by the same normalizer.

Required repair: replace tautological checks with input-driven negative/positive behavior tests for the above cases.

### LOW — fixture helper permits path escape

File: `scripts/keyword-system/test-helpers.mjs:9-14`.

Evidence: `fixturePath('../contracts.test.mjs')` resolved outside `fixtures/naver-api-hub`.

Required repair: restrict names to fixed fixture basenames or verify the resolved path remains under the fixture root.

### LOW — prototype-controlled keys cross the evidence boundary

File: `scripts/keyword-system/lib/contracts.mjs:193-197`.

Evidence: a JSON-derived `__proto__` input changed the returned object prototype (`proto_injected=yes`, `own_proto=false`).

Required repair: reject prototype-control keys or construct null-prototype/allowlisted records.

## artifactRefs

| id | kind | description | path |
|---|---|---|---|
| `art-node22` | terminal-log | Node 22 contract test and glob test results | `.omo/evidence/task1-contracts-node22.log` |
| `art-node24` | terminal-log | Node 24.16.0 compatibility test result | `.omo/evidence/task1-contracts-node24.log` |
| `art-syntax` | terminal-log | Node 22 and Node 24 parser checks | `.omo/evidence/task1-syntax-checks.log` |
| `art-fixtures` | terminal-log | Fixture inventory, malformed parse, and happy normalization | `.omo/evidence/task1-fixtures.log` |
| `art-boundaries` | static-inspection | Allowlist, forbidden-boundary scan, diff check, exports | `.omo/evidence/task1-boundaries.log` |
| `art-repository-checks` | terminal-log | Broader npm checks and pre-existing/environment failure classification | `.omo/evidence/task1-repository-checks.log` |
| `art-adversarial` | adversarial-terminal-log | Direct negative probes for validator and evidence-boundary defects | `.omo/evidence/task1-adversarial.log` |
| `art-probes` | executable-qa-probe | Reproducible Node probe source used for adversarial cases | `.omo/evidence/task1-adversarial-probes.mjs` |
