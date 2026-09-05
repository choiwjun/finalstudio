# 접근성·UX QA v0 — 디자인 구현 감사 (독립 보고서)

- 역할: 접근성·UX QA (독립 감사, Orca dispatch task_57609f6870e5)
- 기준일: 2026-09-05
- 대상: 현재 `src/` 전체, 빌드 산출물 `dist/`(실측), 3개 디자인 보고서(DeepSeek 접근성 QA, Muse 브랜드·UX, Qwen UI·디자인 시스템)
- 방법: 정적 소스 감사 + `npm run build` 후 `dist/` HTML 실측 + WCAG 대비비 수학적 계산 + 기능 정규식 검사(스킵 링크·focus-visible·keep-all·미디어쿼리·reduced-motion·JSON-LD·`<time>`)
- 제약: `src/` 및 `.planning/design/DESIGN_SYSTEM.md` 미수정. 본 보고서만 신설.
- 검증 상태: `npm run build` 성공(6 페이지), `check:content` 통과(1 파일), `check:build` 통과(7 파일)
- 공개 콘텐츠: 0건(draft 1개뿐) → `/posts/**`·404·글 본문 렌더는 빌드에서 미생성, 해당 항목은 "미검증"으로 표기

> 표기: **[사실]** 실측로 확인된 현재 상태. **[판정]** PASS / FAIL / N.A.(아직 요소 없음) / UNVERIFIED(빌드로 확인 불가). **[권고]** 조치 제안.

---

## 1. 요약 판정

콘텐츠·대비·언어 선언 같은 기초는 좋다. 그러나 **키보드 사용자의 첫 관문(스킵 링크)이 없고, 한국어 조판의 1순위 규칙(`word-break: keep-all`)이 없으며, 포커스 표시가 브라우저 기본에 전적으로 의존한다.** 세 보고서(DeepSeek §2.1/2.9, Muse §4, Qwen D6/D13)가 공통으로 지적한 항목이 **모두 아직 미수정 상태**임을 실측으로 확인했다. 디자인 보고서 대비 구현 격차(gap) 목록은 §12와 같다.

---

## 2. 한국어 타이포그래피·가독성

| # | 확인 항목 | 실측 | 판정 |
|---|---|---|---|
| T1 | `lang="ko"` 선언 | `dist/*.html` `<html lang="ko">` 존재 | **PASS** |
| T2 | 한글 줄바꿈 `word-break: keep-all` | `src/`·`dist/` 정규식 검사 0건. 기본 `normal`로 한글 어구가 임의 위치에서 끊길 수 있음 | **FAIL** |
| T3 | 초장어·URL 대비 `overflow-wrap: break-word` | 없음. 긴 URL 삽입 시 컨테이너 넘침 가능 | **FAIL** |
| T4 | `.eyebrow`의 `text-transform: uppercase` + `letter-spacing: .04em` | dist CSS 실측 확인. 한글("실험하고 기록하는 업무 도구 가이드", 주제 eyebrow)에 무의미한 uppercase·양수 자간 적용 — Qwen D7과 동일 결함 | **FAIL** |
| T5 | 본문 행간 | `line-height: 1.7` 전역 — 한글 본문 기준 적절(Qwen 권고 1.75에 근접) | **PASS** |
| T6 | 헤드라인 행간 분리 | `.article h1`(1.25)·`.article h2`(1.35)만 존재. **index 히어로 `<h1>`은 `.article` 밖이라 행간 1.7 적용** — 헤드라인에 과도하게 느슨함(dist 실측) | **FAIL** |
| T7 | 폰트 스택 한글 폰트명 | `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` — 한글 폰트명 없음, OS 폴백(맑은 고딕/Apple SD Gothic Neo)에 의존. 웹폰트 0개는 성능상 유지 타당(Muse §4 동의)하나 **스택에 `"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic"` 명시가 없어 폴백 일관성 보장이 없음** | **FAIL(경미)** |
| T8 | `font-feature-settings: "palt"` | 없음(Qwen §3.2 권고). 마침표·쉼표 뒤 여백 과다 | **FAIL(경미)** |
| T9 | italic·볼드 800 | `.brand { font-weight: 800 }` — 한글 볼드 과중(Qwen D9). italic 사용처 없음 | **FAIL(경미)** |
| T10 | 최소 텍스트 크기 | `.eyebrow`·`.post-meta` 0.9rem(≈14.4px) — 14px 기준 통과 | **PASS** |
| T11 | 행 길이 | `.article` 46rem(≈736px), 본문 16px 기준 한글 약 45자/줄 — Qwen 목표(38~42자, 44rem)보다 김. 현재 체감 가능 수준 아님(경미) | **FAIL(경미)** |
| T12 | 데스크톱 본문 17px 상향 | 없음 — 16px 고정 | **FAIL(경미)** |

**[권고]** T2·T3·T4는 전역 CSS 3줄로 해결되는 P0다. T6는 index 히어로 h1에 `line-height: 1.25~1.35`를 부여하면 된다.

---

## 3. 시맨틱 랜드마크

| # | 확인 항목 | 실측 | 판정 |
|---|---|---|---|
| L1 | `<header>`/`<main>`/`<footer>` 존재 | dist 전 페이지 확인 | **PASS** |
| L2 | `<main>`에 `id="main"` | 없음 — 스킵 링크 대상 불가(DeepSeek §2.1 지적 미수정) | **FAIL** |
| L3 | 헤더 `<nav aria-label="주요 메뉴">` | 존재 | **PASS** |
| L4 | 푸터 링크 그룹의 랜드마크·라벨 | `<div class="footer-links">` — `<nav>` 아님, 라벨 없음, `<ul>` 아님. 헤더와 동일 링크("소개", "편집 원칙")가 스크린 리더에서 중복 컨텍스트 없이 읽힘(DeepSeek §2.1) | **FAIL** |
| L5 | `aria-current="page"` 현재 페이지 표시 | 없음(nav 링크 어디에도) | **FAIL** |
| L6 | 콘텐츠 섹션 라벨 | index "최근 글" 섹션 `<section aria-labelledby="latest-heading">` 존재 | **PASS** |
| L7 | 정적 페이지 `<article>` 래퍼 | about/author/contact/privacy/editorial-policy 모두 `<article class="article">` | **PASS** |
| L8 | 헤딩 구조 | 전 페이지 h1 정확히 1개. index는 h1 → h2(최근 글) → **카드 제목도 `<h2>`(섹션 h2와 동급)** — 게시 시 "최근 글"의 하위 항목이 위계상 동료로 읽힘(Qwen §5.3 h3 강등 권고) | **FAIL(경미)** |
| L9 | index 카드 `aria-labelledby` | 없음 — 스크린 리더가 제목 링크만 개별 읽음(DeepSeek §2.2) | **FAIL(경미)** |

---

## 4. 스킵 링크

| # | 확인 항목 | 실측 | 판정 |
|---|---|---|---|
| S1 | `<body>` 첫 요소로 스킵 링크 | `src/`·`dist/` "skip" 정규식 검사 0건 | **FAIL** |
| S2 | 스킵 대상 `<main id>` | 없음(S2≈L2) | **FAIL** |
| S3 | 스킵 링크 포커스 시 시각 노출 | 구현 자체 없음 | **FAIL** |

**[판정]** WCAG 2.4.1(Bypass Blocks) **FAIL**. 랜드마크가 있어도 매 페이지 3개 헤더 링크를 먼저 통과해야 한다.

**[권고]** `<a class="skip-link" href="#main">본문으로 건너뛰기</a>`를 body 첫 요소로, `<main id="main">`, `.skip-link`는 오프캔버스→`:focus` 시 노출(Qwen §5.2 규격 그대로). P0.

---

## 5. 키보드·포커스 표시

| # | 확인 항목 | 실측 | 판정 |
|---|---|---|---|
| K1 | `outline` 제거 코드 | 없음 — UA 기본 포커스 링 유지 | **PASS(기본값 의존)** |
| K2 | `:focus-visible` 커스텀 정의 | `src/`·`dist/` 검사 0건. 커스텀 배경/장식이 들어오는 순간 기본 링만으로는 부족(DeepSeek §2.9, Qwen D13 공통) | **FAIL(예방 차원)** |
| K3 | 링크 hover/focus 상태 변화 | 내비·카드 링크 `text-decoration: none`뿐, hover/focus 변화 없음(Qwen 상태 매트릭스 전체 미구현) | **FAIL** |
| K4 | 터치 타깃 크기 | 내비·푸터 링크 박스 높이 = 16px×1.7 ≈ 27px — WCAG 2.2 2.5.8 최소 24px는 통과하나 44px 권고(2.5.5 AAA) 미달 | **FAIL(경미)** |
| K5 | 모든 상호작용 요소가 키보드 도달 | 현재 요소는 링크뿐 → 링크는 기본 키보드 가능 | **PASS** |
| K6 | 페이지 진입 시 포커스 이동(라우팅 후) | 정적 사이트, MPA이므로 N.A. | **N.A.** |

---

## 6. 색상 대비 (실계산 값)

| 전경/배경 | 용도 | 계산 대비 | 기준 | 판정 |
|---|---|---|---|---|
| `#172033` / `#fbfcfe` | 본문 | **15.85:1** | 4.5:1 | **PASS** |
| `#172033` / `#ffffff` | 본문(카드·헤더) | **16.27:1** | 4.5:1 | **PASS** |
| `#174ea6` / `#ffffff` | 링크 | **7.85:1** | 4.5:1 | **PASS** |
| `#174ea6` / `#fbfcfe` | 링크(페이지 배경) | **7.64:1** | 4.5:1 | **PASS** |
| `#526078` / `#ffffff` | 메타·푸터 14.4px | **6.36:1** | 4.5:1 | **PASS** |
| `#526078` / `#fbfcfe` | `.lede`·`.eyebrow` | **6.19:1** | 4.5:1 | **PASS** |
| `#172033` / `#eef4ff` | notice 본문 | **14.73:1** | 4.5:1 | **PASS** |
| `#174ea6` / `#eef4ff` | notice 왼쪽 테두리 | **7.11:1** | 3:1(비텍스트) | **PASS** |
| `#e5e9f0` / `#ffffff` | 카드 테두리(1.4.11) | **1.22:1** | 3:1 | **FAIL** |
| `#e5e9f0` / `#fbfcfe` | 카드 테두리 vs 페이지 배경 | **1.19:1** | 3:1 | **FAIL** |
| `#e5e9f0` / `#ffffff` | 헤더·푸터 구분선 | **1.22:1** | 3:1(구분 목적 시) | **FAIL(경계 의미 한정)** |

- 텍스트 대비는 전 항목 통과 — 현재 팔레트의 가장 강한 자산이다(Qwen D15와 부합, 수치 재확인 완료).
- **카드 테두리 1.2:1은 1.4.11(비텍스트 대비) 미달.** 카드가 유일한 그룹화 수단인 상태에서 경계 인식이 어렵다. DeepSeek(§2.2 `#c9d4e3` 수준 권고)·Qwen(`--color-line-strong #d4dae4`) 공통 지적 — 미수정. hover 시 그림자 1단계 추가로 보완 가능하나 기본 상태 기준 미달.
- 색만으로 정보 전달: 현재는 주제가 텍스트("AI 업무 활용"/"업무 생산성")로 구분됨 → **PASS**(배지 도입 시 색+텍스트 병행 유지 조건으로 재검증).

---

## 7. 반응형·폭

| # | 확인 항목 | 실측 | 판정 |
|---|---|---|---|
| R1 | 미디어 쿼리 수 | `src/`·`dist/`에서 `@media` **0건**(Qwen D3 동일) | **FAIL** |
| R2 | 뷰포트 메타 | `width=device-width`만 있고 **`initial-scale=1` 누락**(DeepSeek §2.1) | **FAIL** |
| R3 | 320px 리플로우 | 유동 컨테이너 `min(100% - 2rem, 960px)` + flex-wrap으로 현재 텍스트 콘텐츠는 넘침 없음. 단, 미디어쿼리 0건이므로 표·코드블록·이미지 등장 시 보장 없음 | **UNVERIFIED(글 1개 시점 재검증 필요)** |
| R4 | `100vh` 문제 | `main { min-height: 70vh }` — 모바일 브라우저 UI에서 부정확(Qwen D18 `dvh` 권고) | **FAIL(경미)** |
| R5 | 컨테이너 계층 | 단일 960px — 법률 페이지(36rem)·prose(44rem) 계층 없음(Qwen §3.4) | **FAIL(경미)** |
| R6 | 200% 확대 | 텍스트 중심이라 리플로우 가능성 높음, 글 본문 없이 미검증 | **UNVERIFIED** |

---

## 8. 모션 감소 (prefers-reduced-motion)

| # | 확인 항목 | 실측 | 판정 |
|---|---|---|---|
| M1 | 현재 애니메이션·트랜지션 | `animation|transition|@keyframes` 검사 **0건** — 움직이는 요소가 없어 위반도 없음 | **PASS(현재)** |
| M2 | `prefers-reduced-motion` 가드 | 없음 — Qwen §3.5가 hover 그림자·transition 도입을 규격에 포함하므로, **그 도입과 함께 가드가 없으면 FAIL로 전환된다** | **FAIL(예방 차원)** |

**[권고]** transition이 처음 추가되는 PR에서 `@media (prefers-reduced-motion: reduce)` 전역 가드(Qwen §3.5 규격)를 동봉할 것. 지금 넣는 것이 회귀 비용이 가장 낮다.

---

## 9. 글 메타데이터·JSON-LD

| # | 확인 항목 | 실측 | 판정 |
|---|---|---|---|
| J1 | JSON-LD(`application/ld+json`) | `src/`·`dist/` 0건 — WebSite/BlogPosting 모두 없음(DeepSeek §2.7) | **FAIL** |
| J2 | `<time datetime="YYYY-MM-DD">` | **0건** — 날짜가 "2026. 9. 4." 텍스트로만 렌더링(index, post 페이지 공통) | **FAIL** |
| J3 | og:type | `website` 고정 — 글 페이지에서도 `article`로 바뀌지 않음(`[...slug].astro`가 BaseLayout에 전달하지 않음) | **FAIL** |
| J4 | Twitter 카드·og:image | 없음 | **FAIL(공유 품질)** |
| J5 | canonical | 존재하나 `PUBLIC_SITE_URL` 미설정 시 `http://localhost:4321/`로 귀결(dist 실측). 출시 직전 게이트 필요(DeepSeek §2.1) | **FAIL(출시 조건)** |
| J6 | `publishAt`을 `datePublished`로 쓰는 오류 | 아직 JSON-LD가 없어 발생하지 않음 — 구현 시 주의 | **N.A.→조건부** |
| J7 | 글 프론트매터 계약 | `check:content`가 status/author/testedAt/TBD 게이트 수행(공개 글 author="TBD" 차단 확인) | **PASS** |
| J8 | description 페이지별 지정 | about·editorial-policy는 지정됨. **author·contact·privacy는 기본 설명("직접 테스트한…가이드") 재사용** — 3페이지 동일 description | **FAIL(경미)** |
| J9 | sitemap | `site` 미설정 → 빌드에 sitemap·robots Sitemap 줄 모두 없음(dist 실측) — 도메인 승인 후 `.env` 누락 시 조용히 누락됨 | **FAIL(출시 조건)** |

**[권고]** J2는 `<time datetime={post.data.pubDate.toISOString().slice(0,10)}>` 한 줄이며 P0다. J1은 글 렌더가 실제로 시작될 때 BlogPosting+WebSite를 함께 넣는다(DeepSeek §4.3 순서 동의). J5·J9는 `check:build`에 "canonical에 localhost 금지 / sitemap 존재" 검사 추가가 가장 저렴하다.

---

## 10. 마크다운 콘텐츠 스타일·검증

| # | 확인 항목 | 실측 | 판정 |
|---|---|---|---|
| C1 | 렌더된 본문 존재 | `getPublicPosts()` 0건 → `/posts` 산출물 없음. `.article` 계열 CSS는 dead path로 검증 안 됨(Qwen D4 동일) | **UNVERIFIED** |
| C2 | 마크다운 요소 스타일 | `.article`은 h1/h2/img만 스타일링. `pre/code`, `table`, `blockquote`, `ol`(단계), `kbd`, `figure/figcaption`, `hr` 구분 — **전부 UA 기본**(Qwen D19~D24 그대로). 이 블로그 본문은 표·코드·키 경로가 본질(CEO_PLAN 1.1, Muse §6)이므로 첫 공개 글에서 즉시 노출될 결함 | **FAIL(첫 글 전 필수)** |
| C3 | alt 강제 장치 | 본문 이미지 alt 검사 없음, 프론트매터 heroImage/heroAlt 필드 없음(DeepSeek §2.5). 현재 `<img>` 0건이므로 위반은 없으나 장치도 없음 | **UNVERIFIED→장치 FAIL** |
| C4 | 이미지 성능 속성 | `.article img { max-width:100% }`만 존재, lazy/width/height 규칙 없음 | **FAIL(첫 이미지 전)** |
| C5 | 표·코드 가로 넘침 규칙 | overflow-x 규칙 0건(미디어쿼리 0건과 동일 원인) | **FAIL(첫 글 전)** |
| C6 | 헤딩 레벨 건너뛰기 검사 | 콘텐츠 검사 스크립트에 없음. sample-draft.md는 본문에 헤딩 없어 현재 위반 없음 | **UNVERIFIED** |
| C7 | 404 페이지 | 없음(Astro 기본 404에 의존, dist에 404.html 없음) | **FAIL(경미)** |

---

## 11. 신뢰 신호 (Trust)

| # | 확인 항목 | 실측 | 판정 |
|---|---|---|---|
| U1 | 스키마의 신뢰 필드 | `testedAt`·`toolVersions`·`aiAssisted`·`sourceIds` 모두 존재(content.config.ts) | **PASS(데이터)** |
| U2 | 화면 노출 | post 페이지에 `testedAt`만 하단 1줄. **`toolVersions`·`aiAssisted`·`sourceIds`는 어디에도 렌더링되지 않음**(Muse §6/§7 요구: 상단 검증 메타·출처 노출) | **FAIL** |
| U3 | 검증 메타 위치 | 하단 1줄뿐 — Muse D-UX-1(본문 상단 고정) 미구현 | **FAIL** |
| U4 | `sourceIds` 노출 충돌 | `check-build.mjs`가 `sourceIds` 문자열을 금지어로 검사 — 독자용 출처 렌더링을 하면 빌드가 깨진다. 렌더 형식("출처명·확인일" 카드) 결정 전에는 해결 불가(Muse D-UX-5) | **FAIL(설계 결정 대기)** |
| U5 | 푸터 신뢰 문구의 사실성 | "콘텐츠는 실제 확인과 사람 검토를 거쳐 공개합니다." — **공개 콘텐츠 0건 상태에서 무검증 선언으로 노출**(DeepSeek §2.1 위험 지적) | **FAIL(경미)** |
| U6 | 준비 중 notice 공개 | about/author/contact/privacy의 "준비 중/확정합니다" 문구가 공개 페이지로 렌더링됨(week0 공개 차단 정책과는 별개로, 출릭 시 실내용 교체 필요) | **FAIL(출시 조건)** |
| U7 | 편집 원칙 내용 | 5개 원칙 구체적(직접 실행하지 않은 과정을 테스트라고 쓰지 않음 등) | **PASS** |
| U8 | AI 사용 고지 문구 | editorial-policy에 "AI 초안은 사람의 검토 통과" 원칙 존재, 글 단위 `aiAssisted` 고지 미노출 | **FAIL(경미)** |

---

## 12. 디자인 보고서 대비 구현 격차 요약

세 보고서에서 공통·최상위로 요구된 항목의 현재 상태:

| 요구(출처) | 현재 | 상태 |
|---|---|---|
| 스킵 링크 + `<main id>` + `:focus-visible`(DeepSeek §2.1/§4.2, Qwen §5.2, §9-1) | 없음 | 미이행 |
| `word-break: keep-all`(Qwen D6/§10-3) | 없음 | 미이행 |
| eyebrow uppercase·양수 자간 제거(Qwen D7) | 유지 | 미이행 |
| 카드 테두리 대비(Qwen D15/`--color-line-strong`, DeepSeek §2.2) | `#e5e9f0` 유지 | 미이행 |
| `<time datetime>`(DeepSeek §2.2, Qwen §7) | 없음 | 미이행 |
| `initial-scale=1`(DeepSeek §2.1, Qwen §9-1) | 없음 | 미이행 |
| 표·코드·kbd 등 마크다운 스타일(Qwen §5.6) | 없음 | 미이행 |
| 토큰 시스템(`src/styles/tokens.css`, Qwen §3) | hex 하드코딩 유지 | 미이행 |
| JSON-LD·og:type=article·Twitter(DeepSeek §2.7, Muse §7) | 없음 | 미이행(글 0건 시점, P1 합의됨) |
| 웹폰트 도입 보류(Muse §4, Qwen §3.2) | 시스템 폰트 | **이행(합의 유지)** |
| 라이트 단일 테마(Qwen §3.1.2) | 다크 없음 | **이행(합의 유지)** |
| 공개 차단·draft 유지(week0, Muse D-TRUST-1) | draft 1개만 존재 | **이행** |

**판정:** 디자인 보고서의 P0(약속 증명·접근성 기반) 중 **약 7개 항목이 그대로 미이행** 상태다. 반면 "하지 말 것" 목록(웹폰트·다크모드·장식)은 잘 지켜지고 있다.

---

## 13. 우선순위 조치 권고

**P0 — 첫 공개 글 이전(접근성 계약 수립)**
1. 스킵 링크 + `<main id="main">` + 전역 `:focus-visible { outline: 2px solid …; outline-offset: 2px }`
2. 전역 `word-break: keep-all` + `overflow-wrap: break-word`(+ `pre`는 `normal` 복귀)
3. `.eyebrow`에서 `text-transform: uppercase`·`letter-spacing` 제거
4. 카드 테두리를 3:1 이상(예: `#c9d4e3`)으로 강화
5. `<time datetime>` 적용(index 카드·글 페이지) + index 카드 제목 h2→h3 강등 + `aria-labelledby`
6. 뷰포트에 `initial-scale=1` 명시
7. `prefers-reduced-motion` 전역 가드를 transition 도입 PR과 동봉

**P1 — 첫 공개 글과 동시**
8. `.article` 마크다운 스타일(pre/code/table/blockquote/ol/kbd/figcaption) + 표·코드 overflow-x 규칙 + 이미지 width/height/lazy 규칙
9. `toolVersions`·`aiAssisted` 노출 + 검증 메타 상단 이동, `sourceIds` 렌더 형식 결정 후 `check-build` 금지어 조정
10. BlogPosting/WebSite JSON-LD + og:type=article + 페이지별 description

**P2 — 출시 직전 게이트**
11. `check:build`에 "canonical localhost 금지", "sitemap-index 존재", "alt 누락 금지" 검사 추가
12. 404 페이지, 푸터 신뢰 문구·준비 중 notice 실내용 교체, footer 링크 `<nav aria-label>`화

---

## 14. 재검증 트리거

- 글 1개(status: published) 추가 즉시: §10 C1~C6, §7 R3/R6(320px·200% 리플로우), §6 비텍스트 대비 재실행
- 헤더에 햄버거·버튼 위젯 도입 시: §5 K4(44px), ESC/aria-expanded 계약 재검증
- 토큰 파일(`tokens.css`) 신설 시: §6 전체 대비표 재계산 후 이 문서에 개정 기록
