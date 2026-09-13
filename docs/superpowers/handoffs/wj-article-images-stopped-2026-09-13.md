# WJ Blog — 글 기반 이미지 작업 중단·복구 핸드오프

기록일: 2026-09-13 (Asia/Seoul), 2차 갱신 동일 일자

## 현재 상태: PIPELINE VERIFIED — BACKFILL PENDING HUMAN APPROVAL

**2026-09-13 2차 갱신:** §5 재개 계획의 1–5단계가 완료되어 현재 바이트 기준으로 파이프라인 검증이 통과했다.
단, 발행·DB 쓰기·배포·나머지 15편 backfill은 여전히 사람 승인 대기다. 아래 §7에 fresh-run 결과를 추가했다.

## §0. 이번 갱신의 범위

- 분리된 `scripts/verify/` harness(preflight veto → 조건부 executor)와 회귀 테스트 추가.
- 독립 correctness/security review 수행: CRITICAL/HIGH 없음. MEDIUM 2건 + LOW 다수를 현재 바이트에서 수정.
- Fresh bounded verification `verification-2026-09-13-0316-fresh-fixes3-20260913` — **11개 단계 전부 exit 0, `ok: true`**.
- Q1 closure: fixture가 shared cache를 건드리지 않음을 byte-snapshot으로 확인.
- 실제 스크린샷 2장 캡처·삽입 (§7-3), 15개 메타데이터 정리(author WJ, testedAt, sourceIds, toolVersions).

## 0-1. 1차 기록 당시 상태 (역사적 기록, 보존)

아래는 1차 작성 시점의 상태 문장과 보존 경계다. 2차 갱신 기준으로는 파이프라인 검증이 완료되었으므로
"부분 구현·미검증"은 더 이상 현재 상태가 아니지만, 발행 승인·DB·배포 권한 분리 규칙은 그대로 유효하다.

**1차 기록 당시:** 공통 이미지 파이프라인은 부분 구현 상태였다. 당시 사용자 요청은 핸드오프 기록과 커밋·푸시였으며, 중단된 구현·테스트·빌드·이미지 실행을 재개하라는 승인이 아니었다.

- 저장소: `choiwjun/finalstudio`; 문서 작성 전 브랜치/HEAD: `main` / `e672e93bd5a6f9810db479cf52a580ea2811f144`.
- 1차 체크포인트는 **문서만 커밋**했다. 구현, 테스트, 패키지, 키워드 데이터, 관리자/Worker/Neon 변경, 초안 15개와 기존 staged 삭제 7건은 포함하지 않았다.
- `main` 푸시는 `.github/workflows/quality.yml`에서 `DATABASE_URL`이 설정되어 있으면 `neon:migrate`와 `neon:sync`를 실행할 수 있다. DB 쓰기는 별도 승인 대상이므로 **main 푸시는 계속 보류**한다. CI skip, hook 우회, workflow 수정으로 회피하지 않는다.
- 예약 배포 workflow는 schedule/manual 트리거다. 외부 호스팅 Git 연동·자동 배포 설정은 확인되지 않았다. 수동 배포·실제 Neon 동기화·발행을 수행하지 않는다.
- 과거 `194 tests passed` 등의 컨텍스트, 예전 90점 이상 심사, 아래 역사적 통과 기록은 승인 근거가 아니다. **단, §7의 `verification-2026-09-13-0316-fresh-fixes3-20260913`은 현재 바이트에 대한 신선한 승인 근거다.**

기존 `HANDOFF.md`와 `HANDOVER.md`의 역사적 현재 상태보다 이 문서의 해당 작업 상태가 우선한다. 규칙과 편집 기준은 기존 canonical 문서를 유지한다.

## 1. 실제 실행 이력 정정 — 부모 오케스트레이션 오류

이전에 “자식 QA가 차단했으므로 호스트 검증은 실행되지 않았다”고 보고했지만, 실제 `verifyRuns`와 verification artifact를 확인하니 **세 rejected 실행에서 attached `acceptance.verify`가 실행되었다.** 부모가 실행 제어를 잘못 구성했고, 보고서만으로 미실행을 단정한 오류다.

**Acceptance는 실행 후 승인 판단이지, 실행 허가 경계가 아니다.** `criteriaSatisfied: []`, 자식의 STOP 보고, rejected acceptance는 attached verify의 실행을 막지 않았다. 원래 보고서와 실패 기록은 보존하며, 다음 정정은 rejected 실행을 accepted로 승격하지 않는다.

| Workflow / child (접두사) | 실제 호스트 실행 | 해석 한계 |
| --- | --- | --- |
| `02ce2298…` / `76379193…` | STOP 전달·ACK 뒤에도 concurrency 2 키워드 suite 실행. 96,532ms, exit 1 | 뒤의 `&&` 단계는 미실행. 보존 stdout이 잘려 실패 원인은 미확정이며 ENOMEM으로 단정하지 않는다. |
| `43c8f829…` / `2a4a8827…` | Q1 차단 뒤 보존 검사, 키워드/Worker/Neon/content/prompts/DB-free sync, focused coverage, 최종 보존 검사 chain 실행. 80,068ms, exit 0 | 당시 안전하지 않은 공유 캐시 build fixture 포함. 로그가 잘려 최종 테스트 수·수치 coverage를 복원하지 못했다. 안전한 최신 코드 승인으로 재사용 불가. |
| `afc70719…` / `6c353441…` | 자식 resource block 뒤 호스트 첫 memory guard도 실행·실패. 29ms, exit 1 | 의도와 달리 추가 자원 샘플이 발생했다. 이후 보존/테스트/build/coverage/check는 단락 평가로 미실행. |

세 실행 모두 `memoized: false`, acceptance rejected다. 전체 run ID, receipt 상대 경로, 정정 근거와 한계는 [버전 관리된 정정 기록](wj-article-images-host-verification-erratum-2026-09-13.json)에 보존했다. 원본 로컬 artifact와 status/receipt는 삭제하거나 덮어쓰지 않는다.

세 실행의 `workspaceKind: git-tracked` 및 diff hash가 같았지만 untracked fixture는 바뀌었다. 실제 잘못된 cache hit가 입증된 것은 아니다. 다만 그 key만으로 untracked 구현까지 검증되었다고 주장할 수 없다.

## 2. 자원 부족과 공유 캐시 Q1

### 자원

- 이전 키워드 전체 실행: 291 pass / 2 fail; `ENOMEM` readdir 및 `pthread_create Resource temporarily unavailable` 관찰. swap 고갈, grep조차 `Cannot allocate memory`로 실패한 시점도 있었다.
- 최신 자식 샘플: `MemAvailable=1,386,680 kB`, 요구 `2,097,152 kB` 미달. 뒤에 의도치 않게 실행된 호스트 guard도 실패했다.
- 과거 일시 회복 수치는 현재 회복 근거가 아니다. 이 핸드오프 작성에서는 자원 재측정, 테스트, build, 이미지 실행, 재시도를 하지 않았다.
- 해당 workflow/child는 complete/rejected이며 실행 중인 검토자가 아니다. correctness/security review fanout은 시작되지 않았다. 옛 자식의 저장된 실행 계약을 resume하면 안 된다.

### Q1 및 제한적인 수정 근거

`scripts/keyword-system/image-build.test.mjs`가 저장소 `node_modules` 전체를 fixture에 symlink했다. Astro 기본 `node_modules/.astro`, Vite 기본 `node_modules/.vite`가 공유 디렉터리로 빠졌다. QA는 source inspection으로 발견했고, 부모가 잘못 연결한 호스트 검증이 이 안전하지 않은 fixture를 포함해 실제 실행되었다.

부모의 제한적 수정:

- 물리적으로 별개인 fixture `node_modules`를 만들고 dot-prefixed cache를 제외한 package entry만 연결.
- 쓰기/build 전 realpath 경계 확인; `.astro`, `.vite`, `.vite-temp` 회귀 검사.
- Astro/Vite cache를 fixture `.build-cache/astro`, `.build-cache/vite`로 명시.
- 실제 Astro build 뒤 private `data-store.json` 확인.

RED는 cache 쓰기/build 전 root realpath assertion에서 실패했다. GREEN은 실제 격리 Astro build와 build-boundary 검사를 포함해 **2/2, 33.87s, skip 없음**이었다. 하지만 그 뒤 harness가 파일을 포맷했다.

| 구분 | SHA-256 |
| --- | --- |
| GREEN 당시 fixture | `f9647ee5cff2303c76af712c88423d576962d1917f4131995a3591b697eb8406` |
| 현재 포맷된 fixture | `f67841484385e3750a6fc48df9f04f18b42bbf144b17837ee29b2aed399d145b` |

**현재 바이트는 미검증이고 독립적인 Q1 closure도 미완료다.** 위험한 build가 공유 cache를 읽거나 썼을 가능성을 배제할 수 없다. 전후 cache-byte baseline이 없으므로 “공유 cache 불변”을 주장하지 않는다. cache 삭제·복원은 하지 않았고, 조사와 필요한 정리 승인이 먼저다.

## 3. 이미 확보한 것과 아직 없는 것

### 작성 복구의 역사적 성과

- 공통 writer에 dossier 전달, 검증 marker 보존, correction 재심사, converter 날짜/경로 탈출 방어, 환경 전달 및 운영 날짜 계약을 수정·검토한 이력이 있다.
- 여행 초안 `travel-harry-potter-oxford.md`: 94점, 기계 검사 0 failure/0 warning, 5m44s.
- 여행 초안 `travel-studio-oxford.md`: 91점, 기계 검사 0/0, 5m51s. 둘 다 `pubDate: 2026-09-12`, draft다.
- 초안 15개; 당시 키워드 상태는 written 15 / researching 5 / ready-to-write 0. 기존 세 편의 날짜만 provenance에 따라 복원했다.
- 이미지 전 baseline: keyword 260 + Worker 18 + Neon 4 = 282 통과. DB-free sync check는 20 keyword record / 15 post를 확인했다. **현재 변경분의 최종 통과 수가 아니다.**

### 이미지/정규화 부분 구현

- 완성 본문 스냅샷/hash/section anchor 기반 main 1 + sub 2–3 계획, 실제 PNG decode, truthful AI illustration 표시, exact-candidate 재검증, private transaction/recovery/idempotence를 구현한 상태다.
- dossier는 paired `notesPath`/`notesSha256`와 허용 artifact root를 검증하고, 같은 실제 근거를 기계 검사와 독립 90점 심사에 전달하도록 설계했다.
- generated humanization report의 보수적인 terminal 분리·archive를 writing/image gate 앞에 연결했다. raw byte range/source/candidate hash와 거절된 시도는 보존하고 독자 본문·marker·의무는 유지해야 한다. oil 전용 편집이나 점수 완화가 아니다.
- 공통 process adapter는 기존 draft CLI를 POSIX process group으로 실행한다. 이 이미지 adapter 작업 때문에 `draft.mjs`를 수정하지 않았다는 뜻이지, 이전부터 있던 그 파일의 별도 dirty 변경이 없다는 뜻은 아니다.
- 설치되어 있던 `sharp: 0.35.4`를 직접 의존성으로 선언하고 최소 lock metadata만 교정했다는 worker 보고가 있다. 새 설치, 버전, lock의 `resolved` URL 또는 integrity 변경 승인으로 확대하지 않는다.
- focused 54, recovery 21, writer 17 등의 중간 기록은 서로 겹친다. 중간 coverage 99.66% lines / 82.43% branches / 97.83% functions도 **최종 수치가 아니다**.

### 실제 콘텐츠에 남은 문제

- native Codex capability PNG **한 장만** 생성·decode/hash/시각 확인했다. 원본 `out/keyword-recovery/image-canary-20260912-z0t7ct/main.png`를 보존하며 재생성하지 않는다. 한 글 전체 bundle/15개 backfill은 아직 적용하지 않았다.
- 최초 canary acceptance는 기존 staged 삭제를 보존했는데도 legacy `no-staged-files` 증거를 요구해 rejected였다. 전역 설정/index를 바꾸지 않고 per-run `agentContract: {version: 1}`과 명시적 보존 증거로 독립 QA `ece5eda2-6e1c-4821-b96a-068acd81451d`의 verified acceptance를 얻었다. 원래 rejected run은 그대로다. 이 정책 교정은 위의 verify 실행 차단 문제를 해결한 것이 아니다.
- 같은 canary라도 문구/시각 copy QA가 남아 있다. 한 CLI invocation은 입증되었지만 native tool의 내부 정확한 call 수는 JSONL에서 독립 확인되지 않았다.
- 저장된 notes를 사용한 당시 기계 검사에서는 14/15가 통과했다. `oil-100-breakout.md`의 terminal `윤문 리포트` / `변경률: 18%`가 아직 실제 source에 남아 `unsourced-claim` 실패를 만든다.
- oil 본문은 역사적 `out/auto-publish/2026-09-12-05-11-36/02-humanized.md`와 일치했다. 그때 judge 92점이었으나 최종 기계 검사는 false, **`04-final.md`는 없었다**. 점수로 실패를 덮거나 현재 글을 승인하지 않는다.
- 실제 사이트 build는 `ai-25b2358bd7.md`의 없는 `screenshot-data-center-power-reading-table.png`에서 실패했다. `ai-51ab90d425.md`의 `(placeholder)`도 남아 있다. fixture build 통과는 실제 사이트 build 통과가 아니다.
- author TBD 15개, manual review 필요 9개라는 기존 점검 결과 및 사실·출처·실물 screenshot·marker·중복 여행 주제 검토가 남았다. 최신 전수 재점검 결과로 가장하지 않는다.

## 4. 보존 경계와 로컬 근거

- 기존 staged 삭제 7건: `book-memo-draft.md`, `excel-linked-picture.md`, `excel-vlookup-other-sheet.md`, `post-2026-09-06.md`, `sample-draft.md`, `travel-record-draft.md`, `wireless-mouse-first-week.md` (모두 `src/content/posts/`). 되살리거나 이번 문서 커밋에 포함하지 않는다.
- 기존 다른 코드/데이터/관리자/Worker/Neon/discovery/writer 변경과 15개 draft source bytes를 유지한다. `git add -A`, reset, stash, 무차별 unstage/rollback을 하지 않는다.
- 문서 변경 전 raw index SHA: `cb494d8ff1bf81f100eb6e96ea961239da873c60022d6f01ebdb2768bd4e80e3`.
- 기존 staged binary-diff SHA: `ec4455ee63a2a565ff77653afd2e8bb6ed1c904e26d91e30ac2d337b478f5b1c`.
- 문서 커밋은 index/HEAD를 정상 변경한다. raw index가 영원히 같아야 한다고 요구하지 말고, 기존 staged diff와 비문서 파일 보존을 별도로 확인한다.

| 근거 | 위치 / 한계 |
| --- | --- |
| 이번 문서 커밋 전 snapshot | `/tmp/blog-handoff-commit.b9nscy`: tracked working/staged binary diff, index copy, status, 232개 기존 파일 hash, non-ignored untracked 파일 tar. ignored `out/` 전체 백업은 아니다. |
| 정정 원본 | `/tmp/blog-image-resource-reblocked.LU7dyv/host-verification-erratum.json`; SHA `c058e4a1453d9ad6f0b85b3d02c56c0e57876a38bcf89168e4f6e8b9b24cc779`. 이번 Git JSON은 공개 가능한 요약이며 원본을 대체/덮어쓰지 않는다. |
| 최신 STOP snapshot | `/tmp/blog-image-resource-reblocked.LU7dyv`: diff/status/identity/current fixture/stub/format diff. 당시 새 전수 post/cache audit은 아니었다. |
| GREEN 후 보존 확인 | `/tmp/blog-image-cache-fix.MR7eDp/preservation.json`: 당시 15개 post hash/count, canary, raw/staged index 일치. |
| Cache RED/GREEN | `/tmp/blog-image-cache-red.log`, `/tmp/blog-image-cache-green.log`; tested fixture는 `/tmp/blog-image-cache-fix.MR7eDp`에도 보존. |
| 중간 offline 구현 로그 | `out/keyword-recovery/image-implementation-offline/`; 중간 통과와 실패를 모두 보존. |
| 이미지 전 baseline / 날짜 복원 | `out/keyword-recovery/validation-20260912/`, `out/keyword-recovery/legacy-dates-GGXrGI/provenance.json`. |
| 15개 post 기준 manifest | `out/keyword-recovery/image-canary-20260912-z0t7ct/before.posts.sha256.json`; SHA `2b1f57821cdd23eb966597aa12550af4de49afefd4f1a3571925538fbc8455aa`. |
| Saved notes | `out/keyword-briefs/`; 10개 newer handoff의 notes hash가 일치했다. 5개 older mapping은 본문/notes 대응을 확인했으나 역사적 invocation hash는 미확정. |

canary PNG SHA: `7a9065b272531d629f6ffe63f7eb2b7456045711c917a5670288b767262bc4ec`.

원본 subagent evidence는 로컬 Pi session의 `subagent-artifacts/` 아래에 있다. `/tmp`와 ignored `out/`은 이 문서 커밋으로 원격 보존되지 않는다. 다른 머신으로 넘길 때에는 필요한 snapshot/artifact를 민감 정보 확인 후 별도 승인된 방식으로 전달해야 한다.

## 5. 재개 순서 — 아직 실행하지 않은 계획

1. **자원과 실행 제어부터 해결한다 (todo 12/13).** 사용자와 조율한 읽기 전용 자원 조사 후 소유권을 확인한다. 무관한 프로세스 종료, polling, 자동 재시도, 전역 설정 변경을 하지 않는다.
2. **차단 preflight와 executor를 분리한다.** preflight에는 실행 가능한 verify hook을 달지 않는다. 안전한 결과를 수신·판정한 뒤에만 별도 executor를 조건부 호출한다. `failed preflight → executor 호출 0회` 회귀 검사를 먼저 만든다. 기존 `76379193…`, `2a4a8827…`, `6c353441…`의 저장된 verify 계약을 resume하지 않는다. 이 수정은 아직 구현되지 않았다.
3. **공유 cache 영향 조사 (todo 14).** 삭제·복원 없이 범위를 정해 조사하고, baseline 부재로 증명할 수 없는 부분은 남긴다. 정리가 필요하면 별도 승인을 받는다.
4. **전제 충족 후 한 번의 bounded 최신-byte 검증 (todo 10/12).** 처음부터 full log를 별도 보존하고 changed/untracked file hash, 실제 `verifyRuns`/`memoized`를 확인한다. 아래 명령 목록은 재개 계획이며 지금 실행하라는 승인이 아니다.
   - keyword suite: `node --test --test-concurrency=2 scripts/keyword-system/*.test.mjs` (`npm run test:keywords`); discovery/assertion 변경 금지.
   - `npm run test:worker`, `npm run test:neon`, `npm run check:content`, `npm run check:prompts`, **DB-free** `npm run neon:sync:check`.
   - 현재 바이트의 isolated Astro build, 변경 경로 scoped diagnostics, focused helper coverage의 nonempty 기대 파일 범위와 lines/branches/functions 각각 80% 이상 확인.
   - post/canary/staged 보존과 `git diff --check`. 첫 infrastructure failure에서 중단하고 재시도하지 않는다.
5. **fresh 독립 correctness/security review.** cache 경계, protected Markdown, report 분리/archive, dossier/candidate hash, receipt/recovery, deadline/실제 descendant 취소, sharp metadata와 side effect를 현재 코드로 검토한다.
6. **승인 후 studio Oxford 한 글의 완전한 bundle**, 그 다음 15개 draft를 한 편씩 순차 backfill한다. 재초안 작성·keyword 상태 전환 없이 원문/notes manifest hash를 바인딩한다. 실제 oil 정규화 후보도 두 실제 gate를 모두 통과해야 한다.
7. 실제 screenshot 의무를 해결하고 **새 실제 사이트 build** 성공 뒤 `check:build`를 실행한다. 사람 검토 및 별도 승인 전에는 DB 쓰기·발행·배포를 하지 않는다.

### 변경할 수 없는 처리 계약

- main 1장 + sub 2–3장, 완성 본문에 근거한 서로 다른 장면/section 배치. AI illustration을 실제 screenshot·사진·API 응답·실험 근거처럼 표시하지 않는다.
- screenshot 미확보는 원문 문법/provenance를 보존한 visible pending obligation으로 남길 수 있다. fenced/inline Markdown 예제는 보호한다.
- 같은 실제 hash-bound dossier로 기계 검사와 독립 **90점 이상** 심사를 수행한다. normalized/attached 정확한 후보 바이트를 검사하고 그대로 설치한다. 예전 점수나 가짜 notes로 승인하지 않는다.
- 글 하나당 **공유 절대 deadline 900초**, retry·stage budget reset 없음. draft-with-images는 초안 작성 전, backfill은 source/notes snapshot 전 시작한다.
- `Promise.race`만이 아니라 실제 process tree를 취소해야 한다. POSIX process group, Windows fail-closed; 이미지 실패 시 이미 유효하게 저장된 텍스트와 keyword handoff는 유지한다.
- 성공했던 작성 제어값: `AUTO_BEST_OF=1 AUTO_MAX_PASSES=1 AUTO_ENHANCE_PASSES=0`. 과거 외곽 timeout 895초 + kill grace 5초를 기록하되 application deadline을 늘리지 않는다.
- 추가 live provider 요청, paid API/Python fallback, credential 검사·로그인, dependency 설치, global SDK/config 변경, cache 삭제, publication/DB/deployment는 현재 승인 범위 밖이다.

## 6. 인수자 체크리스트

- [ ] 로컬 미커밋 소스와 필요한 artifact가 실제로 있는지 확인한다. 문서 커밋만으로 구현이 전달되었다고 생각하지 않는다.
- [ ] 실행 이력 정정을 읽고, rejected/blocked를 미실행과 혼동하지 않는다.
- [ ] todo 13/14를 해결하기 전에는 todo 10의 검증/rollout을 재개하지 않는다.
- [ ] 최신 바이트 검증과 독립 review가 없음을 유지한다. 과거 성공 숫자로 완료 표시하지 않는다.
- [ ] 문서 전용 푸시와 운영 main/DB/배포 권한을 분리한다.

## 7. 2026-09-13 2차 갱신 — 신선 검증 결과

### 7-1. 실행 제어 수정 (계획 2단계)

`scripts/verify/`를 새로 만들어 preflight와 executor를 분리했다.

- `preflight.mjs`: 자원/플랫폼/fixture 격리 등 veto 가능 검사만 수행. 실행 가능한 verify hook 없음.
- `orchestrator.mjs`: `preflightResult?.ok !== true`이면 executor를 호출하지 않고 record 반환.
- `executor.mjs`: 고정된 preflight 결과를 받는 bounded chain. 단계별 timeout + POSIX process group 종료.
- `run.mjs`: `out/verification-<시각>-<label>/`을 먼저 만들고 전 log/현재 바이트 hash/최종 record를 보존. orchestration 예외 시에도 `orchestrationError`를 포함한 record를 기록한다.
- `verification-gate.test.mjs`: 회귀 5건 — `ok:true` 1회 호출, `ok:false` 0회, 누락 결과 0회, truthy 비불리언(`{ok:"no"}`) 0회, 격리/frozen 인자 확인.

### 7-2. Fresh bounded verification (계획 4단계)

- 명령: `npm run verify -- --label fresh-fixes3-20260913`
- record: `out/verification-2026-09-13-0316-fresh-fixes3-20260913/record.json`
- 결과: **`ok: true`**, `executorCalls: 1`, `memoized: false`, preflight 통과.

| 단계 | exit | 비고 |
| --- | --- | --- |
| keywords | 0 | 297/297 (image-build fixture의 실제 Astro build 포함) |
| worker | 0 | 18/18 |
| neon | 0 | 4/4 |
| content | 0 | 15개 Markdown 계약 통과 |
| prompts | 0 | 편집 프롬프트 검사 통과 |
| neon-sync-check | 0 | DB-free, 20 record / 15 post 일치 |
| verification-gate | 0 | 5/5 회귀 |
| image-coverage | 0 | **97.02% lines / 83.66% branches / 82.28% funcs** (모두 ≥80%) |
| build | 0 | 실제 `npm run build` (Astro) |
| check-build | 0 | 산출물 계약 통과 |
| diff-check | 0 | `git diff --check` clean |

- `preservationDiff`: run 중 post 변경 0건, tracked diff 변경 없음, untracked 변경 없음.
- 첫 실패 중단 계약 검증: 중간 run `fresh-fixes-20260913`과 `fresh-fixes2-20260913`은 각각 keywords 실패 지점에서 정지하고 record를 남겼다 — 두 기록 모두 보존되어 있으며 resume하지 않았다.

### 7-3. 독립 correctness/security review (계획 5단계)

CRITICAL/HIGH 없음. 현재 바이트에서 수정한 사항:

- MEDIUM: `run.mjs`가 preflight veto/예외 시 record를 쓰지 못하던 문제 → outDir 선생성 + try/catch로 최종 record 항상 보존.
- MEDIUM: `image-plan.mjs`가 heading 원문을 alt text에 그대로 넣어 `](` 포함 heading이 외부 이미지 URL을 만들 수 있던 문제 → heading 정제 + 보호 범위 확장.
- MEDIUM: judge 입력 전체를 codex argv로 넘겨 Linux 인자 크기 제한(E2BIG)에 걸릴 수 있던 문제 → 짧은 지시만 argv, 본문은 stdin(`runDeadlineProcess`에 `stdinText` 추가).
- LOW: `file-lock.mjs`의 파싱 불가 stale lock/guard가 owner 없이 영구 차단 → `staleMs` 초과 시 제거.
- LOW: `image-bundle.mjs` 디렉터리 handle 누수 → catch 경로에서 열린 handle 정리.
- LOW: `image-storage.mjs` PNG 크기가 정수인지 검사 추가.
- TEST: `image-build.test.mjs` fixture의 `optimizeDeps.disabled: "build"` + build timeout 180s→600s — 느린 drvfs 마운트에서의 시간 초과 플레이크 해소(검사 강도는 유지).

### 7-4. Q1 closure (계획 3단계)

- fixture `node_modules`는 fixture-local 디렉터리 + 패키지별 symlink(dot entry 제외). `.astro`/`.vite`/`.vite-temp`는 fixture `.build-cache/` 아래.
- 검증 run 전후 shared `node_modules/.astro`, `.vite` 38개 파일 byte-snapshot 비교: fixture-only 콘텐츠 0건, fixture build는 shared cache를 변경하지 않음.
- `npm run build` 단계 자체가 저장소 `.astro`/`.vite`에 쓰는 것은 정상 동작이다 — Q1의 대상은 fixture 격리이며 이는 확인됐다.
- cache 삭제·복원은 수행하지 않았다.

### 7-5. 콘텐츠 현재 상태

- 실제 스크린샷 2장: `public/images/screenshot-naver-blog-data-center-power.png`, `screenshot-naver-blog-ipo-subscription.png` (Playwright 1.62.0 + Chromium 151, NAVER 블로그 탭, 1440×900). `ai-25b2358bd7.md`, `ai-51ab90d425.md` 본문 삽입 + `sourceIds`에 `screenshot-…-20260913` provenance 추가. 나머지 `[직접 확인 필요]` 마커는 스크린샷 의무가 아닌 API 요청 조건 확인용으로 의도적으로 유지.
- 15개 전체: `author: WJ`, `testedAt: 2026-09-13`, nonempty `sourceIds`(150개 raw evidence와 대조 확인), `toolVersions` 기록 완료.
- **중복 주제 클러스터 (사람 판단 필요)**: `ai-ea50505be2`↔`ai-neosapiens-offering` (네오사피엔스 공모주, 구조까지 유사), `economy-search-signals`↔`economy-stock-chart-signals` (차트분석), `brent-oil-100`↔`oil-100-breakout` (유가 100달러), `travel-f7e6b35043`↔`travel-studio-oxford`↔`travel-harry-potter-oxford` (스튜디오·옥스포드 3중). 발행 전 클러스터당 1편 선택 또는 차별화가 필요하다.
- 사람의 사실·출처 검토는 아직 완료되지 않았다 — 메타데이터 정리는 기계 확인이며 본문 정확성 검토를 대신하지 않는다.

### 7-6. 남은 승인 게이트

- `travel-studio-oxford.md` 단독 bundle(사용자 승인 범위) → 사람 문구·시각 QA → 나머지 15편 순차 backfill(편별 승인).
- `travel-harry-potter-oxford.md` 첫 공개 후보 — 4개 `[직접 확인 필요]` 마커(가격·시간·티켓·상품 조건) 해소 + 본문 검토 + 브라우저/접근성 QA 후 사람이 status 결정.
- Cloudflare Pages 배포: `docs/DEPLOYMENT.md` 절차 문서화 완료. 실제 도메인·Deploy Hook URL·`PUBLIC_SITE_URL`은 사용자 입력 대기.
- DB 쓰기·발행·배포는 별도 승인 없이 수행하지 않는다.
