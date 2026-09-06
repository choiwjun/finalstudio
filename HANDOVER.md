# HANDOVER.md — WJ Blog 인수인계 문서

> 작성일: 2026-09-05 · 대상: 이 프로젝트를 이어받는 사람(또는 미래의 나)
> 이 문서가 사실과 다르면 이 문서를 고치고, `.planning/prompts/content-pipeline.md`와 함께 확인할 것.
> 운영 원칙의 단일 근거는 `BRAND.md`(주제·금지 주제·발행 리듬)와 `VOICE.md`(문체·구조 계약).
> 2026-09-06 제품 방향 업데이트: 이 프로젝트는 업무도구 전용 사이트가 아니라, 카테고리를 자유롭게 추가하는 일반적인 개인 블로그다. 아래의 기존 업무도구 예시는 첫 카테고리와 초기 대기열을 설명하는 예시다.

---

## 1. 프로젝트 한눈 요약

- **무엇**: 애드센스 수익화를 고려하는 한국어 정적 개인 블로그 「WJ Blog」 (Astro 기반)
- **누구에게**: 검색 또는 카테고리 탐색으로 정보와 경험을 읽으려는 한국어 독자
- **무엇을**: 업무도구·공부·리뷰·여행·일상 등 운영자가 선택한 여러 주제
- **해자(차별화)**: 모든 글을 **사람이 직접 테스트**하고 실패 지점("안 될 때")까지 기록 — AI 초안 + 사람 검증 구조
- **절대 금지**: YMYL 조언(보험·대출·투자·세금·건강·법률), IT 뉴스, 무검토 대량 발행 (구글 "규모화 콘텐츠 악용" 정책 → 애드센스 계정 리스크)
- **하드 제약**: 운영자는 Claude Code 구독이 아닌 **ChatGPT 구독** 사용 — 모든 자동화는 ChatGPT + 로컬 Node.js로만 동작

## 2. 기술 스택 (마지막 확인 버전)

| 구성 | 버전 | 비고 |
|---|---|---|
| Node.js | v24.19.0 | |
| Astro | 7.3.1 | 콘텐츠 레이어(glob loader), 정적 빌드 |
| Codex CLI | 0.153.4 | `npm install -g @openai/codex` — ChatGPT 구독 OAuth 엔진 |
| 실행 OS | Windows 10/11 | OneDrive 경로, Git Bash 사용 — §10 트러블슈팅 참조 |
| 리포지토리 | git (main) | **GitHub 원격 아직 없음** — §12 참조 |

## 3. 전체 아키텍처

```
┌─────────────────────── 자동화(초안 단계) ────────────────────────┐
│                                                                   │
│  calendar.md (시리즈 대기열)                                      │
│        │                                                          │
│        ▼   npm run auto:write                                    │
│  auto-write.mjs ── 엔진 선택 ──┬─ codex: Codex CLI (ChatGPT 구독   │
│        │                       │   OAuth, 과금 없음) ★기본        │
│        │                       ├─ api:   OpenAI 호환 API (키 과금)  │
│        │                       └─ 수동:  ChatGPT에 프롬프트 붙여넣기 │
│        │                                                          │
│        ├─ [1] 초안   : BRAND.md + VOICE.md + content-writer-      │
│        ├─ [2] 윤문   : im-not-ai 규칙 이식 (AI 티 제거)            │
│        ├─ [3] 검수   : claude-blog 루브릭 이식 (100점, 90점 게이트) │
│        ├─ [4] 변환   : convert-post.mjs → status: draft 강제 저장  │
│        └─ [4.5] 이미지: generate-image.mjs (썸네일만 AI 가능)      │
└───────────────────────────────────────────────────────────────────┘
        │ (draft 저장)
        ▼
┌─────────────────────── 사람 검증 (해자) ─────────────────────────┐
│  관리자 대시보드 /admin (개발서버에서만)                           │
│    실제 테스트 → 스크린샷 촬영 → [마커] 채우기                      │
│    → testedAt·toolVersions·author 기입                            │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────── 발행 게이트 (기계 강제) ──────────────────┐
│  scripts/lib/content-contract.mjs                                 │
│    · 공백 제외 본문 1,500자 이상                                   │
│    · testedAt(테스트 날짜) + 실명 author 필수                      │
│    · scheduled면 publishAt 필수                                   │
│  사람이 status: draft → scheduled/published 로 변경 = 최종 승인    │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
   Astro 정적 빌드 (npm run build + check:build)
   ※ 배포 파이프라인은 아직 미구현 — §12 남은 과제.
     GitHub Actions 두 개는 배포가 아니라: quality.yml = CI 검사,
     auto-draft.yml = 주간 초안 PR 제안 (머지 = 사람 승인)
```

## 4. 파일 지도 (인수인계 시 이 표부터)

### 블로그 본체

| 경로 | 역할 |
|---|---|
| `src/content.config.ts` | 글 스키마(Zod). 필드: title, description, pubDate, publishAt, status(draft/scheduled/published), topic(자유 문자열 카테고리), angle, author, sourceIds, testedAt, toolVersions, aiAssisted, canonical, **image**(2026-09 추가) |
| `src/content/posts/*.md` | 글 원본 (Markdown + frontmatter). 현재: `excel-linked-picture.md`(첫 실전 초안), `sample-draft.md`(템플릿 샘플) |
| `src/lib/posts.ts` | 공개 글 판정: `isPublicPost` — published는 publishAt≤now, scheduled는 publishAt≤now일 때 공개 |
| `src/pages/index.astro` | 홈 (공개 글 목록) |
| `src/pages/posts/[...slug].astro` | 글 페이지 — 커버 이미지, JSON-LD(BlogPosting·BreadcrumbList), OG/Twitter 메타, noindex 보호(미래 pubDate) |
| `src/pages/admin/index.astro` | **개발 전용** 관리자 대시보드 (빌드 결과에 포함되지 않음) |
| `src/layouts/BaseLayout.astro` | 공통 레이아웃 — og:image(ogImage prop), twitter:card 지원 |
| `src/styles/` | tokens.css(디자인 토큰 단일 근거) + global.css |

### 자동화·스크립트

| 경로 | 역할 |
|---|---|
| `scripts/auto-publish/auto-write.mjs` | **자동화 코어** — 1~4단계 한 줄 실행. 엔진 추상화(codex/api), 캘린더 모드, --input, --from-final. 재검수 후 수정본을 유지하고 `pubDate`를 변환한다. |
| `scripts/auto-publish/convert-post.mjs` | ChatGPT 출력 → 우리 스키마 변환. `status: draft`·`aiAssisted: true` 강제, 스키마 밖 필드(coverImage/tags) 제거, 마커·FAQ·"안 될 때" 존재 경고 |
| `scripts/auto-publish/generate-image.mjs` | 썸네일 생성 (API 자동 / ChatGPT 수동 프롬프트 출력 / --attach 등록) |
| `scripts/auto-publish/calendar.md` | 발행 대기열 — **시리즈 클러스터** 구조(§7). 형식: `- [ ] 주제 \| 독자수준 \| 사다리단계 \| 주제태그` |
| `scripts/auto-publish/README.md` | 파이프라인 사용 설명서 (설정 A~D, 명령 레퍼런스, 이미지 규칙, 하드 룰) |
| `scripts/auto-publish/persona/upmu-lab.json` | 문체 페르소나 스펙(JSON) — 톤 차원·가독성 수치 |
| `scripts/lib/content-contract.mjs` | **콘텐츠 계약 라이브러리** — parseFrontmatter(파싱+수정), bodyCharCount(공백 제외), validatePost, MIN_BODY_CHARS=1500. 관리 서버·체커가 공유 |
| `scripts/check-content.mjs` | 콘텐츠 계약 검사기 (npm run check:content) |
| `scripts/check-build.mjs` | 빌드 경계 검사 — dist에 `.planning/`·`sourceIds`·`TBD` 토큰 누출 금지 |
| `scripts/admin-server.mjs` | 관리자 API 서버 (§5d) + 개발 서버 감독자 |

### 프롬프트·브랜드 (ChatGPT에 붙여넣는 것들)

| 경로 | 역할 |
|---|---|
| `BRAND.md` (루트) | 브랜드 컨텍스트: 주제 범위, YMYL 하드 블록, 발행 리듬, 탭 프레이즈 금지 목록 |
| `VOICE.md` (루트) | 문체 계약: 해요체, 소제목 첫 문장=답(AEO), GEO 계약, **마커 절대 보존**, 제목 프레임 3종, 스캔 밀도 |
| `.planning/prompts/content-writer-prompt.md` | 1단계 초안 페르소나 (v3 — 11개 섹션, 윤문·검수 필수 지정) |
| `.planning/prompts/chatgpt-humanize-prompt.md` | 2단계 윤문 프롬프트 (im-not-ai 규칙 이식) |
| `.planning/prompts/chatgpt-review-prompt.md` | 3단계 검수 프롬프트 (claude-blog 100점 루브릭 이식, 90점 게이트) |
| `.planning/prompts/content-pipeline.md` | 파이프라인 원문(단일 근거) — 이 파일과 충돌하면 이것이 우선 |
| `.planning/research/benchmark-2026-09.md` | 최상위 블로그 벤치마크 실측 기록 (§7) |

### CI·환경

| 경로 | 역할 |
|---|---|
| `.github/workflows/quality.yml` | PR/push → check:content + build + check:build |
| `.github/workflows/auto-draft.yml` | **월·목 10:00 KST** 캘린더 다음 주제 자동 초안 → PR 제안 (머지 = 사람 승인). `secrets.OPENAI_API_KEY` 필요(api 엔진 — CI는 토큰 입력 불가) |
| `.github/workflows/scheduled-publish.yml` | 15분마다 콘텐츠 계약·빌드 검증 후 `DEPLOY_HOOK_URL`이 있으면 정적 호스팅 재빌드 요청. 예약 공개에는 호스팅 Deploy Hook 설정 필요 |
| `.env.example` | 환경변수 문서 (§9) |
| `.gitignore` | node_modules/dist/.astro/.env·tools/·out/·.trash/ — `tools/`는 오픈소스 참고 클론(커밋 안 함) |

## 5. 핵심 기능 상세

### a. 3단계 ChatGPT 프롬프트 파이프라인 (품질 엔진의 심장)

1. **초안** — `content-writer-prompt.md`: 페르소나 + 독자 정의 + 글 구조 계약(H2 여정 순서, 1,000자당 시각 요소 1개, "한눈에 보기" 표) + SEO/AEO/GEO 규칙 + `[직접 확인 필요]`/`[테스트 필요]`/`[스크린샷: ...]` 마커 규칙. **"제가 테스트해봤다"식 경험 지어내기가 최대 금기**.
2. **윤문(필수)** — `chatgpt-humanize-prompt.md`: 한국어 AI 티 제거. im-not-ai 스킬의 규칙을 프롬프트로 이식 — 번역투(A), 영어과다(B), 구조(C), AI 관용구(D), 리듬(E), 수식(F), 완곡(G), 접속사(H), 형식명사(I), 장식(J) 패턴 + 과윤문 가드(변경률 30%/50% 상한) + 자체검증 6항. 마커·번호 리스트·표·FAQ 구조는 절대 훼손 금지.
3. **검수(필수)** — `chatgpt-review-prompt.md`: 100점 채점 — 콘텐츠 30 / SEO 25 / E-E-A-T 15 / AEO 15 / GEO 15. **90점 미만이면 스스로 수정 후 재채점**. 치명적 결함(지어낸 수치, 테스트한 척, YMYL, 구조 파괴, AI 관용구 잔존, 분량 미달)은 즉시 90점 이상 불가.

왜 이 구조인가: "그럴듯함"을 점수로 강제로 끌어올리기 위해서. 자동 저장은 90점 통과분만 허용되고, 그 후에도 사람 테스트가 남는다(§11 의사결정 3번).

### b. 자동화 엔진 (auto-write.mjs)

```
npm run auto:write "주제" --topic 카테고리 --level 완전초보 --stage 정보 [--slug x] [--angle "..."]
npm run auto:write --calendar scripts/auto-publish/calendar.md   # 다음 미완료 주제 자동, 성공 시 [x] 표시
npm run auto:write --input 초안.md --topic 카테고리           # 초안에 윤문+검수만 적용
npm run auto:write --from-final 검수통과본.md --topic t --angle "..."  # 엔진 없이 변환·저장만
```

- **엔진 결정**: `--engine codex|api` 플래그 > `.env`의 `AUTO_ENGINE` > 자동(API 키 있으면 api, 없으면 codex) > 둘 다 없으면 수동 모드 안내 후 종료.
- **codex 엔진** (기본, 과금 없음): Codex CLI를 `node <전역>/@openai/codex/bin/codex.js exec --sandbox read-only --ephemeral [유저지시]`로 호출. **stdin = 규칙·컨텍스트, 인자 = 지시문** (Codex 공식 문서의 파이프 패턴 — Windows 32k 인자 길이 문제 회피). Windows에서 `codex`는 .cmd 셔미라 직접 호출 불가 → JS 진입점 경로로 해결(§10). 로그인 상태는 `codex login status` 종료코드로 판정.
- **api 엔진**: OpenAI 호환 `/chat/completions` (키·BASE_URL·AUTO_MODEL). GitHub Actions에서는 이것만 가능(CI는 브라우저 OAuth 불가).
- **게이트**: 자동작성 파이프라인의 검수 90점 미만이면 draft 저장을 거부하고 `out/auto-publish/<실행시각>/`에 중간 산출물 보존. 콘텐츠 계약은 별도로 공개 글의 분량·testedAt·author·마커를 검사한다.

### c. 이미지 생성 (generate-image.mjs)

- `npm run image -- --slug <슬러그>`: API 키 있으면 gpt-image-1(1536×1024, quality medium) 자동 생성 → `public/images/<슬러그>.png` 저장.
- 키 없으면: ChatGPT(구독)에 붙여넣을 **이미지 프롬프트를 출력** → 받은 파일을 `npm run image -- --slug <슬러그> --attach "파일.png"`로 등록.
- 등록되면 글 frontmatter에 `image: /images/<슬러그>.png` 기록 + astro sync → 글 상단 커버, og:image, twitter:card, JSON-LD image까지 자동 반영.
- **경계선**: 썸네일·커버 일러스트만 AI. **본문 UI 스크린샷은 사람 직접 촬영** — 가짜 스크린샷은 E-E-A-T와 애드센스 신뢰를 무너뜀(README 하드 룰로 기재).

### d. 관리자 대시보드 + API 서버 + 개발 서버 감독

- 대시보드: `/admin` (개발 환경에서만 렌더). 콘텐츠 요약 통계, 글 현황 표, 행동 버튼(편집/상태/삭제), 자동 글발행 안내, 편집·상태 모달. 클라이언트 로직: `src/scripts/admin-dashboard.ts` (10초 ping으로 서버 살아있으면 버튼 활성화; 저장·상태 변경·삭제 후 `reloadAfterSync`가 개발 서버 복귀를 기다렸다가 **한 번만** 새로고침 — 초판에는 `location.reload()` 없이 자기 자신을 무한 재귀하는 버그가 있었고 2026-09-05 2차 리뷰에서 수정됨).
- API 서버: `scripts/admin-server.mjs` — `http://127.0.0.1:4322`, 실행 `npm run admin`.
  - `GET /api/ping` · `GET /api/posts` · `GET /api/post?file=` · `PUT /api/posts`(계약 검증 후 저장) · `POST /api/status`(상태 전환 + 게이트) · `DELETE /api/post`(→ `.trash/`로 이동, 실삭제 아님) · `POST /api/check`(check:content 실행)
  - CORS는 localhost(4321/4322)만 허용. **빌드 결과물에 노출되지 않음**(개발 전용).
- **감독 모델(중요)**: 이 환경의 Astro 개발 서버는 콘텐츠 디렉터리 변경을 감시하지 않고, `astro sync`는 삭제를 반영하지 못한다(초기 발견 경위: 관리자에서 글을 만들어도 홈에 안 뜨고, 지워도 남는 버그). 해결로 관리 서버가 **개발 서버(4321)를 자식 프로세스로 띄우고, 콘텐츠 변경마다 kill→재시작**한다. 관리 서버 없이 개발 서버만 띄울 때는 `npm run dev`를 쓰고 콘텐츠를 직접 고치면 반영이 안 될 수 있음 → `node node_modules/astro/bin/astro.mjs sync` 후 개발 서버 재시작.

### e. 발행 게이트 (기계 강제 — 사람 편의가 아닌 정책)

`scripts/lib/content-contract.mjs`가 관리 서버·체커가 공유하는 단일 구현:
- 공개(status != draft) 글: **공백 제외 본문 1,500자 이상** + `testedAt`(실제 테스트 날짜) + 실명 `author`(정확히 `TBD`만 차단 — "테스터" 같은 임시명은 기계가 못 잡으므로 **사람 체크리스트**로 관리) + **검증 마커 잔존 0건**(`[직접 확인 필요]`·`[출처 URL 확인 필요]`·`[테스트 필요 ...]`·`[스크린샷 ...]`이 하나라도 남으면 발행 차단 — draft는 자유). 마커 게이트는 2026-09-05 2차 리뷰에서 추가, 같은 리뷰에서 출처 URL 마커 누락을 보강했다.
- `toolVersions`·`sourceIds`는 게이트가 검사하지 않는다 — **사람 체크리스트**에서 필수 요구.
- `scheduled`는 `publishAt` 필수. `pubDate`가 미래면 글 페이지는 noindex로 보호.
- 이 게이트의 근거: 무검토 대량 발행은 구글 "규모화 콘텐츠 악용" 정책 위반 소지가 있어 계정 단위 리스크가 된다. AI 대량 생성 자체보다 **사람 검증 없는 발행**이 문제다(구글 "사람 우선 콘텐츠"·생성형 AI 안내 취지).

## 6. 오픈소스 활용 내역 (무엇을 어디서 가져와 어떻게 커스텀했나)

> 두 클론 모두 `tools/` 아래 **참고 자료**로만 보관(gitignore — 커밋 안 됨). 런타임 의존성이 아니다.

| 출처 | 가져온 것 | 커스텀 방식 |
|---|---|---|
| **epoko77-ai/im-not-ai** (GitHub) | 한국어 AI 티 제거 규칙 — `skills/humanize-korean/references/quick-rules.md`, `agents/humanize-monolith.md` | 카테고리 A~J 패턴 + 과윤문 가드 + Do-NOT 목록을 `.planning/prompts/chatgpt-humanize-prompt.md`로 재편해 2단계 필수 게이트에 이식 |
| **AgriciDaniel/claude-blog** (GitHub) | 품질 스코어링 — `skills/blog/references/quality-scoring.md`(100점 루브릭), `skills/blog-write/SKILL.md`(frontmatter 스펙), `skills/blog-brand/SKILL.md`, 자동발행 아이디어 | 루브릭을 우리 브랜드 기준으로 재조정(콘텐츠30/SEO25/E-E-A-T15/AEO15/GEO15, 치명적 결함 목록에 YMYL·마커·분량 추가). 관리자 페이지 "자동 글발행" 메뉴 + draft 강제 변환기로 재구현. 대용 CLI가 아닌 "필요한 로직만 이식" 전략 — Claude Code 구독 없이 ChatGPT로 동작하도록 |

원칙: 오픈소스 코드를 그대로 돌리지 않고 **규칙/기준을 추출해 우리 파이프라인 프롬프트·게이트에 이식**했다. 실행 환경은 100% ChatGPT + 로컬 Node.js.

## 7. 벤치마크 조사 (2026-09-05 실측 → 시스템 반영)

상세 데이터: `.planning/research/benchmark-2026-09.md`. 요약:

- **발행 빈도 실측** (RSS/원문 날짜 직접 파싱): 개인 애드센스 티스토리 최상위(digimoa) **매일 1편·고정 시간(12~13시)**, 하루 3편 시리즈 몰아찍기 패턴. 다작가 플랫폼(요즘IT) 1.5편/일. 주 2~3에 머문 블로그는 갱신 정체 관찰(level-001).
- **구조 실측**: 오빠두엑셀·요즘IT 대표 글 = 한글 6,000자 이상, 이미지 10~54장, 내부링크 19~38개. digimoa는 2,200자짜리 가벼운 글도 리스트 12개+표 1개로 스캔 밀도 유지.
- **반영** (`BRAND.md`·`VOICE.md`·작성·검수 프롬프트·캘린더):
  - 발행 리듬: 주 2 상한 → **주 3~5 + 고정 발행 시간 + 시리즈(3~5편) 클러스터 기획** (품질 게이트 유지)
  - 제목 프레임 3종: 문제 해결형 / 비교형(표 필수) / 경험담형(사람 검증 후에만 — 초안 단계 금지)
  - 스캔 밀도: 1,000자당 시각 요소 1개 이상 + 정리 섹션 "한눈에 보기" 표
  - 분량 목표 상향: 건강한 목표 2,500~4,000자(공백 제외) — 게이트 최소선 1,500은 유지
  - 캘린더를 시리즈 A(엑셀 데이터)/B(AI 회의·문서) + 단발 주제로 재구성
- 조사 방법 참고: 웹 검색 도구 장애 시 **`curl`로 원문 HTML·RSS를 직접 받아 파싱**하면 된다(이 방법으로 실측 성공).

## 8. 일상 운영 매뉴얼 (주간 리듬)

**첫 설정 (한 번)**:
```bash
npm install
npm install -g @openai/codex
codex login        # 브라우저에서 ChatGPT 계정 로그인 — 구독 사용량으로 자동화
npm run admin      # 관리 서버(4322) + 개발 서버(4321) 기동 → http://localhost:4321/admin
```

**주간 흐름 (권장: 주 3~5편, 고정 시간 발행)**:
1. 대기열 확인: `scripts/auto-publish/calendar.md` (시리즈 단위로 채워둔다)
2. 초안 생성: `npm run auto:write --calendar scripts/auto-publish/calendar.md`
3. (선택) 썸네일: `npm run image -- --slug <슬러그>` — 키 없으면 출력된 프롬프트로 ChatGPT에서 생성 후 `--attach`
4. **사람 테스트**: 글 따라 해보기 → 스크린샷 촬영 → `[마커]` 전부 채우기 → testedAt·toolVersions·author 기입 (관리자 편집 모달로 가능)
5. `npm run check:content` 통과 확인
6. 관리자 대시보드에서 status 변경 (draft → scheduled/published) — 이것이 최종 승인
7. 빌드·배포 (§12의 배포 파이프라인은 미구현 — 아래 남은 과제)

**명령 치트시트**: `npm run dev` / `npm run admin` / `npm run build && npm run check:build` / `npm run check:content` / `npm run auto:write ...` / `npm run image -- ...` (상세: `scripts/auto-publish/README.md`)

## 9. 환경변수 & 비용 구조

| 변수 | 기본 | 설명 |
|---|---|---|
| `OPENAI_API_KEY` | (없음) | api 엔진·이미지 자동 생성용. 없으면 codex 엔진(구독) 또는 수동 모드 |
| `OPENAI_BASE_URL` | https://api.openai.com/v1 | 호환 API 교체용 |
| `AUTO_MODEL` | gpt-4o-mini | api 엔진 텍스트 모델 (글 1장당 약 $0.01~0.05) |
| `AUTO_ENGINE` | 자동 | codex \| api 강제 (--engine 플래그가 더 우선) |
| `CODEX_MODEL` | (플랜 기본) | codex 엔진 모델 지정 |
| `AUTO_MAX_PASSES` | 2 | 검수 최대 라운드 |
| `IMAGES_MODEL` / `IMAGES_QUALITY` | gpt-image-1 / medium | 이미지 (장당 약 $0.02~0.07) |
| `PUBLIC_SITE_URL` | — | 실제 도메인 승인 시 설정 |

비용 전략: **텍스트는 ChatGPT 구독(OAuth)으로 무료화**했고, 이미지만 API 과금(또는 ChatGPT 웹 수동 생성). GitHub Actions 예약 초안 실행만 API 키 필요.

## 10. 알려진 이슈·트러블슈팅 (Windows 특이점 포함)

| 증상 | 원인 | 해결 |
|---|---|---|
| 관리자에서 글 수정했는데 블로그에 반영 안 됨 | 개발 서버가 콘텐츠를 감시하지 않음 | `npm run admin`으로 감독 모드 사용. 이미 떠 있으면 정상(변경마다 자동 재시작) |
| `EADDRINUSE 4322` | npm 래퍼 종료 후 node 고아 프로세스 잔존 | `netstat -ano \| grep LISTENING`으로 PID 찾고 `taskkill //PID <pid> //T //F` |
| codex 엔진이 codex를 못 찾음 | Windows .cmd 셔미는 spawn으로 직접 실행 불가 | 스크립트가 `%APPDATA%\npm\node_modules\@openai\codex\bin\codex.js`를 node로 직접 실행함 — 코드 수정 시 이 경로 로직 유지할 것 |
| check:build 실패 — dist에 금지 토큰 | `.planning/`·`sourceIds`·`TBD`가 빌드 결과로 누출 | admin 대시보드 스크립트는 `is:inline` 동적 import로 유지(번들 포함 금지). 초안의 TBD는 발행 게이트가 잡음 |
| Git Bash에서 백틱이 명령 치환됨 | 셸 특성 | 긴 텍스트/마크다운 생성은 Bash 명령 대신 파일 쓰기 도구 사용 |
| astro sync 후에도 삭제된 글이 남음 | sync는 삭제를 반영 못 함 | 관리 서버 재시작 모델이 처리. 수동이면 개발 서버 재시작 |
| **WSL(`/mnt/c`)에서 `npm run build` 실패 — "Cannot find native binding (rolldown)"** | `node_modules`는 설치한 플랫폼용 네이티브 바인딩을 담는다. Windows에서 설치한 것을 WSL Linux Node로 실행하면 실패(실측 재현 확인) | Windows 또는 WSL 중 한 환경을 고정하고 그 환경에서 별도로 `npm install`한다. 두 환경이 같은 `node_modules`를 공유하지 않는다. 이 기계는 Windows(Git Bash/PowerShell) 권장 |
| dev 서버만 띄우고 콘텐츠 수정 시 미반영 | 감시 미작동 | `node node_modules/astro/bin/astro.mjs sync` 후 개발 서버 재시작 |

## 11. 의사결정 로그 (왜 이렇게 만들었나 — 되돌리기 전에 읽기)

1. **Claude Code를 쓰지 않는다**: 운영자가 ChatGPT 구독자. 오픈소스(여러 CLI 에이전트 전제)는 코드 복사가 아니라 **규칙 이식**으로 흡수했다.
2. **사람 승인 게이트를 자동화하지 않는다**: 무검토 대량 발행은 구글 규모화 콘텐츠 악용 정책 위반 → 애드센스 계정 단위 리스크. 하루 3편 자동발행 제안은 거절하고 "매일 초안 + 사람 검증 발행"으로 설계. GitHub Actions 초안도 PR 머지 = 승인 구조.
3. **경험·스크린샷은 지어내지 않는다**: 마커(`[직접 확인 필요]` 등)는 윤문·검수가 절대 지우지 못하게 하고, 발행 게이트가 testedAt을 강제. 본문 스크린샷은 AI 이미지 금지(§5c).
4. **발행 리듬 주 3~5 + 시리즈 클러스터**: 추정이 아니라 2026-09 벤치마크 실측 근거(§7). 품질 게이트 통과분만 발행하므로 검토 시간 부족 시 개수를 낮춘다(상한이지 하한이 아님).
5. **개발 서버 감독 모델**: 콘텐츠 핫리로드가 이 환경에서 작동하지 않는 것이 "버그"라기보다 제약 — 왕복 문제를 실험으로 확인하고(utimes/동기화/config 재시작 모두 실패) kill+respawn으로 해결.
6. **글 1장 = 1개의 검색 문제**: 벤치마크 이전부터 채택한 원칙. 관련 없는 팁 이어붙이기 금지 — 이탈률·완독률 방어.

## 12. 남은 과제 / 다음 단계 (우선순위 순)

- [ ] **`codex login` 실행** (사람 5분) — 구독 기반 자동화 활성화. 전제: `npm install -g @openai/codex` (이 기계엔 0.153.4 설치돼 있음 — 새 기계라면 먼저 설치)
- [ ] **첫 글 완성**: `src/content/posts/excel-linked-picture.md` — 미해결 마커: `[스크린샷]` 6건 · `[직접 확인 필요]` 8건 · `[테스트 필요]` 2건 · `[출처 URL 확인 필요]` 1건. author 실명 교체("테스터"는 기계가 못 잡음), testedAt·toolVersions·sourceIds 기입. 완료 후 **기술 검증**: `check:content` → `build` → `check:build` → `.env`에 `PUBLIC_SITE_URL` 설정(설정 전엔 canonical이 localhost로 떨어지고 sitemap이 비활성) → 실제 `/posts/excel-linked-picture/` 접속 확인 → canonical·robots.txt(Disallow /admin/ + Sitemap 라인)·sitemap-index.xml 확인 → status 변경 발행 (현재 draft, 2,401자 공백 제외)
- [ ] **GitHub 연결 + Secrets**: 원격 리포지토리가 없어 auto-draft.yml이 아직 비활성. 푸시 후 Settings→Secrets→`OPENAI_API_KEY` 등록 (api 엔진만 CI 가능). 자동 초안 검증은 새로 생성된 파일만 검사하므로 기존 published 글 때문에 실패하지 않는다. 보안 메모: 워크플로 입력의 eval 인젝션은 2026-09-05 제거됐다(입력은 env로만 전달) — 이후 워크플로 수정 시에도 `${{ }}` 셸 직접 치환·eval 금지 유지
- [ ] **배포 파이프라인**: 호스팅(예: Cloudflare Pages/Netlify/GitHub Pages) 연결 + 애드센스 도메인 승인 대기. 예약 글까지 자동 공개하려면 `scheduled-publish.yml`을 활성화하고 호스팅 Deploy Hook을 `DEPLOY_HOOK_URL` secret으로 등록한다. "사람 승인 후 예약 빌드·배포" 원칙 유지
- [ ] `.env`에 실제 키 설정 여부 결정 (이미지 자동 생성 시에만 필요)
- [ ] **실행 환경 고정**: npm 명령은 **Windows 또는 WSL 중 하나로만** — node_modules는 플랫폼별 네이티브 바인딩을 담으므로 두 환경이 같은 폴더를 공유하면 안 된다(§10). 이 기계 기준 Windows(Git Bash) 권장
- [ ] 분기 1회 벤치마크 재조사 — `.planning/research/benchmark-2026-09.md` 방법론 참고
- [ ] 애드센스 신청: 필수 페이지는 이미 구비(about·privacy·contact·editorial-policy). Google 공식 요건은 "고품질·독창적 콘텐츠 + 정책 준수"이며 **고정 글 수 기준은 없다**(15~20개는 커뮤니티 관행적 내부 목표일 뿐). 승인 후 ads.txt·광고 코드 삽입 (승인 전 코드 삽입 금지)

## 13. 검증 상태 (최종 확인: 2026-09-05, 2차 리뷰 재검증 포함)

**1차(초판) 주장 중 정정된 것**: 초판은 "관리자 E2E·자동 새로고침 완료"로 썼으나 재검증에서
세 가지 코드 문제가 발견돼 수정했다 — ① `reloadAfterSync`가 `location.reload()` 없이 자기 자신을
무한 재귀(페이지가 스스로 갱신되지 않음), ② 검증 마커 게이트가 계약에 없어 "마커 완결 후 발행"이
문서 약속에 그쳤던 것, ③ `calendarFile` 변수 섀도잉으로 캘린더 `[x]` 표시가 동작하지 않던 것.
동기화 자체(서버 측 콘텐츠 반영)는 실측상 정상이었고, 위 세 건은 클라이언트·계약·대기열 층의 결함이었다.

**2차 리뷰 후 실측으로 확인한 것 (2026-09-05)**:
- 위 3건 수정 완료. 마커 게이트 4시나리오 실측: 마커 없는 공개 글 통과 / 마커 남은 공개 글 차단(남은 마커 명시) / 분량 미달 차단 / 마커 있는 초안은 자유 통과
- `node --check` — auto-write.mjs·content-contract.mjs 통과
- `npm run check:content` — 통과 (2개 파일)
- `npm run build` (8페이지) + `check:build` 경계 검사 — **Windows 환경에서 통과**
- WSL(`/mnt/c`)에서의 빌드 실패 — 재현·진단 완료: Windows 설치 node_modules의 rolldown 네이티브 바인딩을 Linux Node가 못 읽음(§10 해결법)
- 서버 — 4321(개발)·4322(관리 API) 정상 응답
- 3차 리뷰(같은 날): auto-draft.yml의 eval 스크립트 인젝션 제거 — 워크플로 입력을 `${{ }}` 셸 직접 치환 없이 env 변수로만 전달하도록 재작성(YAML 로컬 파서 부재로 구문은 구조 점검으로 대체 — GitHub 첫 파싱에서 재확인할 것). 마커 게이트 정규식에 `[출처 URL 확인 필요]` 보강 — 감지 실측 완료. 첫 글 마커 실측 집계: `[스크린샷]` 6 · `[직접 확인 필요]` 8 · `[테스트 필요]` 2 · `[출처 URL 확인 필요]` 1
- 4차 리뷰(2026-09-05): auto-draft.yml이 기존 published/scheduled 글을 오탐하지 않고 새로 생성된 글만 `status: draft`로 검사하도록 수정. auto-write 재검수 수정본 보존, 검수 응답의 채점표 제거, 0~100 점수 범위 검증, `--input` 무주제 모드 지원. 변환기가 `pubDate`를 우선 읽고 구형 `date`도 호환하도록 수정. `scheduled-publish.yml` 추가 — 15분 주기 빌드 검증 및 `DEPLOY_HOOK_URL` 호스팅 재빌드 hook 호출.
- 이번 수정 후 정적 검증: 변경된 JavaScript 5개 `node --check` 통과, `npm run check:content` 통과, 변환기 smoke test에서 `pubDate: 2026-09-05` 보존 확인. 현재 WSL 셸의 `npm run build`는 기존 Windows용 Rolldown 바인딩 재사용으로 실패하므로, Windows 또는 WSL 한 환경에서 의존성을 새로 설치한 뒤 재실행해야 한다.

**아직 실측하지 못한 것 (거짓말 방지 목록)**:
- codex 로그인 후 실제 3단계 파이프라인 실행 (로그인은 사람이 해야 함)
- 캘린더 `[x]` 표시의 종단 간 동작 — 성공 경로가 API 키(또는 구독 로그인)를 필요로 해, 섀도잉 수정은 코드·정적 확인까지만 검증
- 실제 이미지 API 호출 (키 없음), 관리자 자동 새로고침의 브라우저 실측(다음 저장 시 눈으로 확인할 것), 실제 배포
- GitHub Actions (원격 리포지토리 없음 — auto-draft.yml 비활성)
- 예약 발행의 실제 호스팅 공개(호스팅 선택·Deploy Hook secret 등록 전)
