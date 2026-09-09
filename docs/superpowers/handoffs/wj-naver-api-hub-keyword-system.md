# WJ NAVER API HUB Keyword System Handoff

**Updated:** 2026-09-09
**Canonical branch:** `main`
**Current local commit:** `38cc379 fix: dedupe related keywords before promotion gate`
**Remote state before final push:** `main` is 10 commits ahead of `origin/main`.

## Goal

Build a WJ Blog-only keyword collection and analysis system using the official NAVER API HUB blog search and search-trend APIs. The system must collect evidence and produce human-reviewable `ready-to-write` handoffs. It must never create drafts, schedule posts, or publish automatically.

## Completed and reviewed

| Task | Result | Integrated commit(s) | Independent review |
| --- | --- | --- | --- |
| 1. Contracts, fixtures, harness | Complete | `0e41a2b` | `PASS_WITH_MINOR_ISSUES` |
| 2. NAVER API HUB provider | Complete | `75f15b0` (source `e8cb0d6`) | `PASS` |
| 3. Redacted raw evidence store | Complete | `dd2f629` (source `deeeac6`) | `PASS_WITH_MINOR_ISSUES` |
| 4. Deterministic discovery | Complete | `17f7873` (source `60b513f`) | `PASS_WITH_MINOR_ISSUES` |
| 5. Deterministic analysis and transitions | Complete | `2c9d382` (source `d0d033e`) | `PASS_WITH_MINOR_ISSUES`, then focused repair `38cc379` (`c15e8aa`) reviewed `PASS` |

Implemented modules include:

- `scripts/keyword-system/lib/contracts.mjs`
- `scripts/keyword-system/lib/naver-api-hub-provider.mjs`
- `scripts/keyword-system/lib/evidence-store.mjs`
- `scripts/keyword-system/lib/discovery.mjs`
- `scripts/keyword-system/lib/analysis.mjs`
- Their focused Node tests and Task 1 fixtures.

## Fresh verification before handoff

- `node --test scripts/keyword-system/*.test.mjs` → **139/139 pass**
- `node --check` on all keyword modules/tests → pass
- `git diff --check` → clean
- `npm run check:prompts` → pass
- `npm run check:content` → pass
- Protected untracked research files remain untouched:
  - `.planning/research/affiliate-category-research-2026-09-07.md`
  - `.planning/research/autostudio-keyword-research-2026-09-08.md`
  - `.planning/research/category-demand-evidence-2026-09-07.md`

## Task 6 is not implemented

Task 6 was attempted in an isolated worktree but made no changes. Prime Agent `opencode-go` returned the provider-wide 5-hour usage limit (HTTP 429) for `deepseek-v4-flash`, `deepseek-v4-pro`, and the temporary `kimi-k2.7-code` fallback. The quota was reported to reset in about 12 minutes at the time of the attempt.

Next implementation scope:

- `scripts/keyword-system/{discover,collect,analyze}.mjs`
- `scripts/keyword-system/lib/records-store.mjs`
- Focused records-store and CLI integration tests
- `data/keywords/records.json`
- `data/keywords/evidence-index.jsonl`
- `data/keywords/decisions.jsonl`
- `data/keywords/ready-to-write.json`

Required behavior:

1. Wire seeds → deterministic discovery → fixture provider/raw evidence → analysis → records and explicit human handoff.
2. Support explicit seed/out/fixture/dry-run arguments.
3. Keep all generated output under `data/keywords`.
4. No automatic writer, draft, calendar, or publish path.
5. Return nonzero and redact output for missing credentials, partial failure, invalid transitions, and missing evidence.
6. Make evidence index paths repository-relative, not machine-specific absolute paths.
7. Prevent same-run/source/key evidence overwrite by using a unique run scope or rejecting an existing target deterministically.
8. Require explicit writer handoff reference/reason before a record can become `written`.

## Known non-blocking findings to carry forward

- Task 1: generic `KEY=value` text is not redacted by the current credential-assignment heuristic; stronger generic assignment handling is recommended.
- Task 1: API failure kind/status cross-check and raw request normalization are minor contract follow-ups.
- Task 1: `empty.json` remains a hybrid fixture; fixture helper path escape and some provider failure paths need later coverage.
- Task 3: same-run/source/key writes can overwrite; Task 6 must prevent or scope this.
- Task 3: index entries currently use absolute paths; Task 6 should emit root-relative paths.
- Task 4: generated `test-results/` is not yet ignored; add the pattern in the environment/build task. Add an explicit empty-group rejection test if desired.
- Task 5: analysis accepts some envelopes more leniently than the strict raw-evidence validator; future-dated evidence is `unknown` without a stale risk by design.

These findings are not release blockers for the completed Tasks 1–5, but they must not be silently lost.

## Constraints

- Do not modify existing AutoStudio code or `scripts/auto-publish/`.
- Do not modify the three protected untracked research files listed above.
- Use official NAVER API HUB endpoints only for this system.
- Never commit credentials, headers, raw auth-bearing bodies, or secret-bearing logs.
- Keep provider, evidence, discovery, analysis, CLI, and human handoff boundaries explicit.

## Model and orchestration routing

- Prime Agent orchestration uses explicit `opencode-go/<model>` selectors.
- Implementation normally uses `opencode-go/deepseek-v4-flash`.
- Independent review uses `opencode-go/glm-5.3-flash`.
- The Prime Agent `models.json` provider override must retain a generated `x-opencode-session` header; without it OpenCode Go returns `MissingSessionID`.
- The last Task 6 attempt was blocked by the OpenCode Go usage limit. Do not repeat the same prompt until the provider reset is confirmed.

## Resume procedure

1. Confirm `main` is clean except the three protected untracked research files.
2. Confirm the OpenCode Go quota has reset before dispatching a new implementation worker.
3. Create a fresh Task 6 worktree from current `main`.
4. Implement Task 6 with focused tests and the overwrite/path requirements above.
5. Run an independent GLM review before integrating.
6. Then implement/review Task 7 environment, npm script, documentation, and build-boundary work.
7. Final gates: `test:keywords`, `check:prompts`, `check:content`, `build`, and `check:build`.

## Cleanup performed for this handoff

Only the canonical `main` worktree should remain for this repository. The temporary `keyword-task2` through `keyword-task6` worktrees and branches are disposable because their reviewed commits are already integrated into `main`; Task 6 contains no unique changes.
