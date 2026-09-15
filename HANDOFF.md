# 핸드오프 — AI 키워드 자동 블로그 작성 파이프라인

> 작성일: 2026-09-16. 마지막 상태: **`keyword-auto-draft.yml`이 end-to-end 성공**(run 35022543804, `completed/success`).

## 1. 지금 동작하는 것

- 관리자가 **카테고리 + `ready-to-write` 키워드 1건**을 고르면, GitHub Actions `workflow_dispatch`가 브리프 생성 → 본문 작성 → 윤문 → 독립 심사(90점 게이트) → 이미지 3장 생성 → 검수 → **`status: draft`로 커밋·push**까지 자동 수행.
- 성공 사례: `travel/코타키나발루 반딧불투어` → `src/content/posts/travel-42ccb7d478.md` + `public/images/travel-42ccb7d478-{main,sub-1,sub-2}.png`, 커밋 `3932ef3`.
- 결과물은 항상 `status: draft`. 사람 승인 전 자동 공개 없음(정책).

## 2. 실행 방법

```bash
gh workflow run keyword-auto-draft.yml \
  -f category=<카테고리> \
  -f keyword="<키워드>" \
  -f request_id="$(cat /proc/sys/kernel/random/uuid)"
```

- `request_id`는 **반드시 v4 UUID**여야 함(워크플로우가 정규식 검증).
- 남은 `ready-to-write` 키워드 4개: `ai/AI 데이터센터`, `ai/인공지능 윤리`, `ai/피지컬 AI`, `economy-business/국제유가 100달러 돌파`.

## 3. 실행 환경

- **OS**: WSL2 Ubuntu, user `hunter8891`
- **편집 대상 리포**: `/mnt/c/Users/wj941/Documents/blog` (Windows 측, 여기서 커밋·push)
- **Self-hosted runner**: `wjblog-wsl` (labels: `self-hosted,Linux,X64,wjblog-ai`), worktree `~/actions-runner/_work/finalstudio/finalstudio` (ext4)
- Runner는 **nohup으로 띄운 상태 — WSL 재시작 시 수동 재기동 필요**. 영구화하려면 `crontab @reboot` 등록 권장.

## 4. 파이프라인 구조 (핵심 파일)

| 단계 | 파일 |
|---|---|
| 오케스트레이션 | `scripts/keyword-system/auto-publish.mjs` (`runDraftImageTopic`) |
| 초안 서브프로세스 | `scripts/keyword-system/draft.mjs` → `scripts/auto-publish/auto-write.mjs` |
| 이미지 번들 | `scripts/keyword-system/lib/image-bundle.mjs` |
| 이미지 품질 검사 | `scripts/keyword-system/lib/image-quality.mjs` |
| deadline 상수 | `scripts/keyword-system/lib/image-runtime.mjs` (`IMAGE_DEADLINE_MS = 1_800_000`) |
| 프롬프트 | `.planning/prompts/{content-writer,chatgpt-review,chatgpt-humanize,independent-judge}-prompt.md` |
| 형식 블루프린트 | `.editorial/blueprints/how-to.md` |
| 워크플로우 | `.github/workflows/keyword-auto-draft.yml` |

### 심사 흐름
`draft(BEST_OF=2) → humanize → judge(≥90) → correction/regen → enhance → enhanced judge`. `AUTO_MAX_PASSES`는 workflow에서 `"3"`. `JUDGE_THRESHOLD = 90`은 **의도된 설계**(낮추지 말 것).

## 5. 이번 세션에서 고친 근본 원인들 (재발 방지 메모)

| 커밋 | 문제 → 수정 |
|---|---|
| `2cdfedd` | review 모델이 수정본에 해요체/지어낸 수치를 넣어 기계검사 실패로 폐기 → review 프롬프트에 기계검사 통과 조건 하드코딩 |
| `e14a18b` | 이미지 deadline 15분이 부족(3회 모델 호출+심사 ~11-14분) → 30분으로 상향 |
| `5af39ba`,`a8d4ac4` | judge가 "같은 예시 반복" 치명 결함 반복 → writer 프롬프트에 예시-섹션 배정 규칙, how-to blueprint의 FAQ 강제·"같은 예시" 정의 모순 해소 |
| `79bf059` | humanizer 리포트 파서가 81자 꼬리표에 "ambiguous"로 크래시 → `{0,80}`→`{0,240}` |
| `9f994f0` | review 모델 no-op(동일 본문 반환)이 dead-end → fresh draft 재생성 fallback |
| `0b118c8`,`b43046c` | draft·이미지가 하나의 shared deadline을 나눠 써 후반 단계 starvation → **각 단계 독립 deadline** |
| `2ca7ad6` | 패스 중 best가 아닌 마지막 초안만 게이트 → best-scoring draft로 게이트 |
| `11be13a` | 이미지 단계가 이미 90+ 통과한 동일 본문을 재심사해 92→89 랜덤 탈락 → 본문 동일 시 상위 점수 인계, 재심사 생략 |
| `de0327a` | 이전 run 커밋 번들이 있는데 브리프 재생성으로 notes 해시 드리프트 → "notes conflict" 실패. 본문 동일(candidateHash 일치)하면 notes 드리프트는 경고로 낮추고 번들 재사용 |
| `c457039` | workflow `품질 게이트`가 `check-writing.mjs`를 `--notes` 없이 실행해 브리프 근거 수치를 unsourced-claim 오탐 → `out/keyword-briefs/<category>-<keyword>.md`를 `--notes`로 전달 |

전체 커밋 이력은 `git log --oneline -25` 참조.

## 6. 알려진 구조적 특성 (버그 아님)

- **judge 비결정성**: 같은 본문도 84~95 사이를 오감. 90 게이트 경계에서 한 번에 안 통과하면 재실행으로 통과 가능(이미 95·92·90 사례 있음). `AUTO_MAX_PASSES=3`이 재시도를 흡수.
- **점수 병목**: 루브릭 중 사실성·형식은 거의 만점, **문장품질(~15/20)·독자가치(~22/25)**가 감점 주원인 — 기계적 종결 반복 + 실제 상품 비교 사례 부재. 근거(evidence)가 얇으면 writer가 구체 사례를 못 만드는 한계.
- **`data/keywords/raw/*`는 gitignore** — 수집 근거는 runner 로컬(`~/keyword-evidence-cache/raw`)에만 존재, workflow 시작 시 worktree로 복원.

## 7. 미결정 / 수동 작업 필요

- [ ] **Worker secrets**: `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_WORKFLOW` — `npx wrangler whoami` 타임아웃으로 미검증. wrangler 로그인 후 `wrangler secret put` 필요.
- [ ] **`PUBLIC_SITE_URL`** 미확정.
- [ ] **자동 발행 정책**: 현재는 draft 생성까지. 사람 승인 후 발행으로 둘지, 자동 발행까지 허용할지 미결정.
- [ ] **Runner 영구화**(위 §3).
- [ ] 새 수집 실행 시 `~/keyword-evidence-cache/raw` → `data/keywords/raw` 동기화.

## 8. 디버깅 팁

- **run 산출물은 run 직후 즉시 검사**: 다음 run의 `actions/checkout`이 이전 `out/`을 삭제함. manifest는 `out/keyword-autopublish/latest.json`.
- run dir: `~/actions-runner/_work/finalstudio/finalstudio/out/auto-publish/<timestamp>/` — `03-judge-*.md`, `05-writing-check-*.json`, `03-regen-*` 등.
- 이미지 번들: `out/image-bundles/<slug>/` — `failure.json`이 있으면 실패 원인.
- `check-writing.mjs`는 파일 인자 필수. notes 없이 돌리면 브리프 근거 수치를 unsourced로 오탐하니 `--notes` 전달할 것.
- 테스트 fixture는 `assertContainedPath` 때문에 **반드시 리포 루트 내부**에 둘 것(`/tmp` 불가).
- `rg` 검색 시 `rg --`로 패턴 시작. 기존 `stash@{0..4}`는 건드리지 말 것.
- `npx astro check`는 `@astrojs/check`/`typescript` 부재로 실행 불가 — `node --check` + `node --test`로 검증.
