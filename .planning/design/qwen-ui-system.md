# UI·디자인 시스템 독립 분석 — 업무도구 실험실

- 작성: Qwen (UI·디자인 시스템 담당)
- 기준일: 2026-09-04
- 입력: `README.md`, `.planning/CEO_PLAN.md`, `.planning/decisions/week0.md`, `src/layouts/BaseLayout.astro`, `src/pages/` 전체(index, posts/[...slug], about, author, contact, privacy, editorial-policy), `src/content.config.ts`, `src/lib/posts.ts`
- 상태: 제안 v1. 이 문서는 분석·규격만 담으며 **source 파일은 수정하지 않았다.**
- 제품 맥락: 한국어 우선 정보성 블로그. 독자약속은 "직접 테스트한 업무 생산성 가이드". AdSense는 준비 단계이며 디자인 원칙은 **읽기와 신뢰(E-E-A-T) 우선, 광고 중심 패턴 배제**.

---

## 1. 현재 CSS 진단

모든 스타일은 `BaseLayout.astro` 하단 `<style>` 블록의 `:global()` 규칙 한곳에 있고, 7개 페이지는 자체 스타일 없이 클래스(`.container`, `.article`, `.eyebrow`, `.lede`, `.post-list`, `.post-card`, `.notice`, `.post-meta`)만 참조한다. 골격 단계로서 나쁘지 않으나 아래 문제가 있다.

### 1.1 구조

| # | 문제 | 근거 | 영향 |
|---|---|---|---|
| D1 | 디자인 토큰( custom property)이 전혀 없고 hex·rem 값이 규칙마다 하드코딩 | `#172033`, `#526078`, `#e5e9f0`, `1.25rem` 등이 반복 | 색상·간격 변경 시 전수 수정 필요. 값漂移(drift) 발생 |
| D2 | 사이트 전체 스타일이 레이아웃 1개 파일에 결합 | `:global(*)` ~ `:global(.notice)` | 페이지 추가마다 같은 파일에 쌓임. 컴포넌트 단위로 스타일 찾을 수 없음 |
| D3 | 미디어 쿼리가 **0개** | `<style>` 전체 | 반응형이 유동 컨테이너에만 의존. 360px에서 헤더·본문 여백 붕괴 |
| D4 | 빌드 산출물에 글 상세가 실제로 렌더링되지 않음 | `sample-draft.md`가 `status: draft` → `getPublicPosts()` 통과 0건 | `.article` 계열 스타일이 검증되지 않은 dead code. 콘텐츠 스타일 작업 시 목업 글 필요 |

### 1.2 한국어 타이포그래피

| # | 문제 | 근거 |
|---|---|---|
| D5 | 폰트 스택에 한글 폰트명이 없다 — `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. 한국어는 브라우저 기본 폴백(Windows 맑은 고딕 / macOS Apple SD Gothic Neo)에 전적으로 의존 | `:global(body)` |
| D6 | `word-break: keep-all` 없음. 한글 문장이 한자(CJK) 단위처럼 중간에 끊긴다 — 한국어 웹 가독성의 1순위 결함 | 없음 |
| D7 | `.eyebrow`가 `text-transform: uppercase` + `letter-spacing: .04em` — 라틴 문자 관습. index.astro의 한글 eyebrow("실험하고 기록하는 업무 도구 가이드")에서 자간이 어색하고 uppercase는 무의미 | `:global(.eyebrow)` |
| D8 | 타이머치 스케일 없음. `.article` 밖 h1~h6, 본문 리스트/리더블 요소가 브라우저 기본값에 의존. h3 이하 미지정 | `:global(.article h1/h2)`만 존재 |
| D9 | `brand`에 `font-weight: 800` — 한글 볼드 이상 무게는Small 사이즈에서 획이 뭉침. 700이 상한 권장 | `.brand` |
| D10 | 줄간격 1.7 단일값 — 헤드라인(1.25~1.4)과 분리되나 스케일화되지 않음. 한글 문장용 `font-feature-settings: "palt"` 없음(마침표·쉼표 뒤 빈 공간 과다) | `:global(body)` |

### 1.3 색상·상태

| # | 문제 | 근거 |
|---|---|---|
| D11 | 카드 제목이 링크라 `:global(a)`의 파란(#174ea6)을 그대로 물남 → 목록이 전부 파란 글씨. 메뉴·광고 크리에이트처럼 보이고 위계 무너짐. 카드는 ink 색상 + hover 시에만 연결색이 원칙 | `.post-card h2` |
| D12 | `#526078`이 secondary·meta·footer·eyebrow를 겸용 — 시맨틱 토큰 없음 | 복수 규칙 |
| D13 | `:focus-visible` 없음, skip link 없음, 터치 타깃 최소 44px 보장 없음(nav 링크 높이 ~20px). `outline` 제거 코드야 없지만 커스텀 포커스도 없어 OS 기본에 전량 의존 | 없음 |
| D14 | hover/active/현재 페이지(aria-current) 상태 없음. 다크모드 없음(`color-scheme` 선언조차 없음) | 없음 |
| D15 | contrast 자체는 양호(#174ea6 on #fff ≈ 7.8:1, #526078 ≈ 5.5:1). 유지할 값 | 계산 확인 |

### 1.4 간격·레이아웃

| # | 문제 | 근거 |
|---|---|---|
| D16 | 간격 값이 즉흥적: `.35rem`, `.25rem`, `1.25rem`, `2rem`, `2.5rem`, `3rem` — 4px 스케일 없음 | 전역 |
| D17 | `.container` 단일 폭(960px)만 있고 prose 폭(`.article` 46rem≈736px, `.lede` 44rem)과 법률 페이지용 폭이 계층화되지 않음. 46rem은 한글 기준 약 46자/줄로 약간 깁김(목표 38~42자) | `.container` 등 |
| D18 | `main { min-height: 70vh; padding-block: 3rem }` — 짧은 페이지(author/contact)에서 푸터가 화면 한가부에 떠 보임. 모바일 48px 여백은 과다. `vh`는 모바일 브라우저 UI에서 부정확(`dvh` 권장) | `main` |

### 1.5 콘텐츠 마크다운 스타일 부재 (가장 큰 공백)

이 블로그의 본문은 스크린샷·수식·설정 경로·버전 표로 구성된다(CEO_PLAN 1.1). 그런데 `:global()` 규칙 중 `.article` 안에서 다루는 것은 h1/h2/img뿐이다.

| # | 미スタイリング 요소 | 필요성 |
|---|---|---|
| D19 | `pre`, `code` | 수식·스크립트 예시 필수. 기본 모노 폭·배경 없음 |
| D20 | `table`, `th`, `td` | 도구 버전·설정 비교 표 필수 |
| D21 | `blockquote`, `figure`, `figcaption` | 실패 기록 인용, 스크린샷 캡션 |
| D22 | `kbd` | "Alt → H → D"류 메뉴 경로 표기 — 이 사이트의 시그니처 요소 |
| D23 | `ol`(단계 리스트) | "단계별 가이드" 형식의 핵심. 순서 강조 스타일 없음 |
| D24 | `hr` 기본값만 — 본문 헤더 구분과 "광고/본문 구분"이 같은 선 | `[...slug].astro`에서 hr 2회 사용 |
| D25 | `.notice` 단일 변형 — 작성자 미확정(warning), 테스트 완료(success), 정보(info)를 구분 못함 | about/author/contact/privacy 전부 같은 파란 notice |

---

## 2. 디자인 원칙과 배제할 패턴

**원칙**

1. 읽기가 곧 기능 — 본문 가독성(글꼴·행길이·줄간격·대조)에 가장 많이 투자한다.
2. 신뢰는 위계로 만든다 — 날짜·작성자·테스트 여부·출처를 색상 트릭이 아닌 배치와 타이포로 우선 노출한다(E-E-A-T).
3. 시스템은 토큰으로만 — 컴포넌트 규칙에 raw hex·임의 rem을 쓰지 않는다.
4. 한국어 먼저 — keep-all, 자간 0, italic 금지, 최소 14px.
5. 상태는 값싸게 — hover/focus는 색상·테두리·그림자 1단계씩만. JS 애니메이션 없음.
6. 광고는 손님이 아니라 별도 구역 — 광고 스타일을 본문 컴포넌트(`.notice`, `.badge`, 카드)와 절대 공유하지 않는다.

**배제 목록 (과도한 장식·광고 중심 패턴)**

- 글자 페이드인·스크롤 리빌·패럴랙스·커서 이펙트 — 전부 배제 (콘텐츠 팜 신호 + Lighthouse 저하)
- 대형 히어로 이미지·자동 캐러셀·팝업 뉴스레터·interstitial — 배제
- 카드 다단+썸네일 그리드(잡지형) — 배제. 텍스트 1열 리스트가 "정제된 정보" 인상을 준다
- 그라디언트 배경, 3종 이상 그림자, hover 시 카드 translateY 확대 — 배제 (1px border ↔ 그림자 1단계만 허용)
- 하단 고정 배너, 본문 중간 "더 보기" 유도 버튼 — 배제 (AdSense 정책 리스크)
- 진행률 표시줄(sticky progress bar) — 배제 아님, 그러나 현재 불필요(판단 보류)
- 전체 다크 테마 — AdSense 광고 인벤토리(라이트 고정 렌더)와 충돌하므로 **감당(토큰만 준비)**, §3.1.2 참조

---

## 3. 토큰 시스템

신규 파일 2개로 옮기는 것을 전제로 한 규격이다 (근거: D1, D2). 이 문서는 규격만 제시하고 구현은 §10 순서에 맡긴다.

### 3.1 색상 토큰

기존 값(#172033/#174ea6/#e5e9f0/#fbfcfe)은 검증되어 유지하고, 그 주위에 계층을 만든다. 무채색은 파란기 gray (신뢰감·문서 사이트 관습).

```css
/* src/styles/tokens.css — 1) 색상 */
:root {
  color-scheme: light;

  /* 중립 */
  --color-ink:          #172033; /* 본문·제목            on #fbfcfe 13.8:1 */
  --color-ink-soft:     #3d4a61; /* 보조 본문·리드문     on #fff     9.4:1 */
  --color-muted:        #5c6a80; /* 메타·캡션·푸터       on #fff     5.4:1 */
  --color-faint:        #8a94a6; /* 장식 전용, 텍스트 금지(3.2:1)         */
  --color-line:         #e5e9f0; /* 기본 테두리                            */
  --color-line-strong:  #d4dae4; /* hover·구분 테두리                      */
  --color-bg:           #fbfcfe; /* 페이지 배경                            */
  --color-surface:      #ffffff; /* 카드·헤더·푸터                          */
  --color-surface-sunken: #f3f6fa; /* 코드블록·표 헤더·빈칸               */

  /* 브랜드·링크 */
  --color-brand:        #174ea6; /* on #fff 7.8:1  AA 본문 통과           */
  --color-brand-hover:  #123f88;
  --color-brand-active: #0e3269;
  --color-brand-soft:   #eef4ff; /* info 배경                              */
  --color-link:         #174ea6;
  --color-link-hover:   #123f88;

  /* 시맨틱 (배경 위 텍스트AA 재계산 포함) */
  --color-info:     #174ea6;  --color-info-bg:     #eef4ff;
  --color-success:  #0e6f4c;  --color-success-bg:  #e7f4ee; /* on bg 5.6:1 */
  --color-warning:  #8a5a00;  --color-warning-bg:  #fdf3dd; /* on bg 5.4:1 */
  --color-danger:   #a52a1a;  --color-danger-bg:   #fbeae7; /* on bg 5.9:1 */

  /* 주제 두 개 고정 (CEO_PLAN 핵심/인접) */
  --color-topic-prod: #174ea6; --bg-topic-prod: #eef4ff;
  --color-topic-ai:   #5b3a8f; --bg-topic-ai:   #f1ecfa; /* on bg 7.3:1 */

  /* 광고 — 본문과 겹치지 않는 무중립 회색 전용 */
  --color-ad-bg:    #f4f6f9;
  --color-ad-line:  #d6dce5;
  --color-ad-label: #5c6a80;

  /* 포커스 */
  --color-focus:     #2f6fed;
  --shadow-focus:    0 0 0 3px rgba(47, 111, 237, 0.35);
  --color-selection: #d9e7fb;
}

::selection { background: var(--color-selection); color: var(--color-ink); }
```

#### 3.1.2 다크 모드 (감당 — 지금 켜지 않는다)

AdSense 연결 전까지는 라이트 단일로 배포한다. 단, 토큰 구조를 미리 분리해 두면 추후 `@media` 블록 하나로 전환 가능하다. 아래는 **비활성 보관용 값**이다.

```css
/* [보관] AdSense 승인·구현 결정 후 활성화. 광고 슬롯 배경은 다크에서도 light 유지. */
@media (prefers-color-scheme: dark) {
  :root[data-theme="dark"] {
    --color-ink: #e7ecf5;        --color-ink-soft: #c4cdda;
    --color-muted: #97a3b4;      --color-faint: #6b7688;
    --color-line: #2b3648;       --color-line-strong: #3a475c;
    --color-bg: #10151f;         --color-surface: #171e2b;
    --color-surface-sunken: #1f2837;
    --color-link: #93b8f7;       --color-link-hover: #b5cffa; /* on #10151f 8.4:1 */
    --color-success: #5ecf9f;    --color-warning: #e5b558;    --color-danger: #f08c7f;
  }
}
```

### 3.2 타이포그래피

```css
/* src/styles/tokens.css — 2) 타이포 */
:root {
  --font-sans: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont,
    "Segoe UI", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic",
    sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  --font-mono: ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono",
    "D2Coding", Menlo, Consolas, monospace;

  --text-2xs: 0.75rem;      /* 12px — 배지 라벨·광고 라벨(큰 장식만) */
  --text-xs: 0.8125rem;     /* 13px — badge 본문 허용 최소 */
  --text-sm: 0.875rem;      /* 14px — 메타·캡션·푸터: 한글 최소 */
  --text-base: 1rem;        /* 16px */
  --text-body-lg: 1.0625rem;/* 17px — ≥768px 본문 */
  --text-lede: 1.125rem;    /* 18px */
  --text-card-title: 1.25rem; /* 20px */
  --text-h3: clamp(1.125rem, 1.07rem + 0.26vw, 1.25rem);  /* 18→20 */
  --text-h2: clamp(1.375rem, 1.25rem + 0.52vw, 1.625rem); /* 22→26 */
  --text-h1: clamp(1.75rem, 1.48rem + 1.15vw, 2.375rem);  /* 28→38 */

  --leading-body: 1.75;   /* 한글 본문: 라틴 평균 1.6보다 넉넉히 */
  --leading-snug: 1.5;    /* 카드 제목·list */
  --leading-head: 1.35;   /* 헤드라인 */
  --tracking-head: -0.01em;  /* 한글 헤드라인만 미세 조임 */
  --tracking-body: 0;        /* 한글 본문 자간 절대 양수 금지 */

  --flow-space: 1.15em;      /* 연속 문단 간격 */
  --measure-prose: 44rem;    /* 704px ≈ 한글 40~42자/줄 */
}

/* 베이스 */
html { -webkit-text-size-adjust: 100%; }
body {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: var(--leading-body);
  color: var(--color-ink);
  background: var(--color-bg);
  word-break: keep-all;              /* ★ 한국어 필수: 어구 중간 끊김 방지 */
  overflow-wrap: break-word;         /* URL 등 초장어 대응 */
  font-feature-settings: "palt" 1;   /* 한글 마침표·쉼표 후 여백 압축 */
}
@media (min-width: 768px) {
  body { font-size: var(--text-body-lg); } /* 데스크톱 본문 17px */
}

h1, h2, h3, h4 {
  line-height: var(--leading-head);
  letter-spacing: var(--tracking-head);
  text-wrap: balance;   /* 헤드라인 고아줄 방지, 미지원 브라우저 무시 */
  font-weight: 700;     /* 800 사용 금지(D9) */
}
p { text-wrap: pretty; margin-block: 0; }
strong { font-weight: 700; }
em { font-style: normal; font-weight: 600; }  /* ★ 한글 italic 금지: 합성 이탤릭은 가독성 붕괴 */
```

**폰트 로드 전략**

| 단계 | 방식 | 근거 |
|---|---|---|
| 지금 (0~2주차) | 웹폰트 0개 — `--font-sans` 폴백 스택만 | LCP/CLSS 제로. AdSense 전 성능이 곧 품질 신호 |
| 이후 (선택) | Pretendard variable woff2 서브셋 자기호스트 (`unicode-range` 분할, `font-display: swap`) + `size-adjust`로 폴백 메릭 정합 | 한글 웹폰트는 300KB+급 — 서브셋·메릭보정 없으면 CLS 위반 |

**한글 타이포 규칙 (유지보수 항목과 직결)**

1. `word-break: keep-all` — 전역 필수. 코드블록(`pre`)만 `keep-all normal`로 되돌림.
2. 본문 자간 0, 헤드라인 최대 -0.01em. 자간 양수는 한국어에서 음절이 흩어져 보인다.
3. `text-transform: uppercase` 금지 — eyebrow에서 제거하고 두께·색상으로 구분.
4. 최소 크기 14px (13px는 pill 배지 한정, 12px는 라벨 전용).
5. 숫자·날짜가 있는 표·메타는 `font-variant-numeric: tabular-nums`로 폭 고정.
6. 날짜 표기는 `2026년 9월 4일` 형식 권장 (현재 `toLocaleDateString('ko-KR')`은 "2026. 9. 4." 출력 — 상세 구현 시 옵션 `{ year:'numeric', month:'long', day:'numeric' }`).

### 3.3 간격 스케일

```css
/* src/styles/tokens.css — 3) 간격 (4px 기반) */
:root {
  --space-1: 0.25rem;  /* 4  */
  --space-2: 0.5rem;   /* 8  */
  --space-3: 0.75rem;  /* 12 */
  --space-4: 1rem;     /* 16 */
  --space-5: 1.5rem;   /* 24 */
  --space-6: 2rem;     /* 32 */
  --space-7: 2.5rem;   /* 40 */
  --space-8: 3rem;     /* 48 */
  --space-9: 4rem;     /* 64 */
  --space-10: 5rem;    /* 80 */
  --space-12: 6rem;    /* 96 */

  --section-gap: clamp(var(--space-7), 6vw, var(--space-9)); /* 섹션 40→64 */
  --gutter-inline: clamp(1rem, 4vw, 1.25rem);                /* 좌우 여백 16→20 */
}
```

적용 규격: 문단 사이 `var(--flow-space)`(1.15em), 카드 안 패딩 `--space-5`, 리스트 항목 사이 `--space-1`+행간, h2 위 `--space-8` / h3 위 `--space-6`. **스케일에 없는 값(15px, 22px, 30px)을 넣지 않는다** — 가장 가까운 단계로 반올림.

### 3.4 컨테이너·폭 계층

```css
/* src/styles/tokens.css — 4) 레이아웃 */
:root {
  --container-narrow: 36rem; /* 576 — 법률·단문 페이지(privacy/contact/author) */
  --container-prose:  44rem; /* 704 — 글 상세 본문(.article 대체) */
  --container-page:   60rem; /* 960 — 헤더·목록·푸터 공통 프레임 (현 960 유지) */
  --container-wide:   72rem; /* 1152 — futura: TOC 사이드바 추가 시만 */
  --header-h: 4rem;          /* 모바일 64 — sticky 오프셋 계산용 */
}
.container {
  width: min(100% - (var(--gutter-inline) * 2), var(--container-page));
  margin-inline: auto;
}
```

### 3.5 라운드·그림자·모션·z

```css
:root {
  --radius-sm: 0.375rem;  /* 6  — kbd·인라인 코드 */
  --radius-md: 0.5rem;    /* 8  — 코드블록·이미지·버튼 */
  --radius-lg: 0.75rem;   /* 12 — 카드·notice (현행 유지) */
  --radius-pill: 999px;

  --shadow-1: 0 1px 2px rgba(23, 32, 51, 0.05);  /* 헤더 경계 대용 */
  --shadow-2: 0 4px 12px rgba(23, 32, 51, 0.08); /* 카드 hover 단일 단계 */

  --motion-fast: 120ms;
  --motion-base: 180ms;
  --ease: cubic-bezier(0.2, 0, 0, 1);

  --z-header: 10;
  --z-skip: 100;
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
```

브레이크포인트 정의표 (§4)도 tokens.css 상단 주석에 단일 출처로 둔다 — CSS 변수는 `@media`에서 쓸 수 없으므로 **주석 테이블 + 리터럴 px**가 표준이다.

---

## 4. 반응형 브레이크포인트

모바일 우선(min-width). 근거: 계획서상 트래픽은 검색 유입 모바일이 우세 assumed, 콘텐츠 1열 읽기가 핵심.

| 이름 | 값 | 이 지점 이후 변화 |
|---|---|---|
| — | 0~479px | 기본: 카드 패딩 `--space-4`, `main` 위아래 `--space-6`, 헤더 2행 허용(wrap) |
| sm | 480px | 메타 행(주제·날짜) 여유. 푸터 링크 간격 `--space-4` |
| md | 768px | 본문 17px, 헤더 단행(min-height 64→72), `main` 여백 `--space-8`, nav gap 1rem→2rem |
| lg | 1024px | 섹션 여백 `--section-gap` 최대값 고정, 목록·영토 여백 최종 |
| xl | 1280px | 컨테이너 상한 유지(추가 확장 없음). futura: `.article` 우측 TOC(`--container-wide`) |

- `100vh` 금지 — `min-height: 60dvh` (모바일 주소표시줄 변화 대응).
- 가로 스크롤 필수 요소(`pre`, 큰 `table`)는 `overflow-x: auto` + `overscroll-behavior-x: contain`.
- 360px 최단 기기에서 본문 실측 40자 줄 유지 확인(`--gutter-inline` 최소 1rem 보장).

---

## 5. 컴포넌트 규격 (구체 CSS)

아래는 `src/styles/global.css`(BaseLayout에서 import)로 이관·신설할 최종 규격 초안이다. 선택자 중 `.article` 계열은 마크다운 콘텐츠에 대한 스타일이라 Astro에서는 `:global()` 또는 global.css로 두는 것이 정확하다 — 이관 후에는 `:global()` 필요 없이 plain CSS.

### 5.1 헤더 / 내비

```css
.site-header {
  position: sticky; top: 0; z-index: var(--z-header);
  background: var(--color-surface);            /* blur·반투명 금지 */
  border-block-end: 1px solid var(--color-line);
}
.header-inner {
  display: flex; flex-wrap: wrap; align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
  min-height: var(--header-h);
}
.brand { color: var(--color-ink); font-weight: 700; font-size: 1.0625rem; text-decoration: none; }
.site-nav { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.site-nav a {
  display: inline-flex; align-items: center; min-height: 44px;   /* 터치 타깃 */
  padding-inline: var(--space-2);
  color: var(--color-ink-soft); font-size: var(--text-sm); text-decoration: none;
  border-radius: var(--radius-sm);
}
.site-nav a:hover { color: var(--color-brand-hover); text-decoration: none; }
.site-nav a[aria-current="page"] { color: var(--color-brand); box-shadow: inset 0 -2px 0 var(--color-brand); font-weight: 600; }
@media (min-width: 768px) {
  .header-inner { min-height: 4.5rem; }
  .site-nav { gap: var(--space-4); }
}
```

HTML 연계(구현 담당 지시용): `aria-current="page"` 추가, skip link(`.skip-link`, 포커스 시 노출) 신설.

### 5.2 본문 링크·포커스

```css
a {
  color: var(--color-link);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.18em;
}
a:hover { color: var(--color-link-hover); text-decoration-thickness: 2px; }
:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
.skip-link {
  position: absolute; inset-inline-start: var(--space-4); inset-block-start: -100%;
  background: var(--color-brand); color: #fff; padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md); z-index: var(--z-skip); text-decoration: none;
}
.skip-link:focus { inset-block-start: var(--space-2); }
```

본문 안 링크는 항상 밑줄(식별성), 내비·카드 제목·버튼만 밑줄 없음. 밑줄은 hover 전용 장식으로 쓰지 않는다.

### 5.3 글 목록 카드 (홈)

```css
.post-list { display: grid; gap: var(--space-4); margin-block: var(--space-5) var(--space-8); padding: 0; list-style: none; }
.post-card {
  padding: var(--space-5);
  border: 1px solid var(--color-line); border-radius: var(--radius-lg);
  background: var(--color-surface);
  transition: border-color var(--motion-base) var(--ease), box-shadow var(--motion-base) var(--ease);
}
.post-card:hover, .post-card:focus-within { border-color: var(--color-line-strong); box-shadow: var(--shadow-2); }
.post-card h3 { margin: var(--space-2) 0 var(--space-2); font-size: var(--text-card-title); line-height: var(--leading-snug); }
.post-card h3 a { color: var(--color-ink); text-decoration: none; }   /* D11 교정: 파란 제목 금지 */
.post-card h3 a:hover { color: var(--color-link); text-decoration: underline; }
.post-card p { margin: 0; color: var(--color-ink-soft); }
.post-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2) var(--space-3); font-size: var(--text-sm); color: var(--color-muted); }
@media (max-width: 479.98px) { .post-card { padding: var(--space-4); } }
```

- 목록은 **1열 유지** — 다단 썸네일 그리드는 배제 패턴(§2).
- 카드 제목은 현재 `h2` → `h3` 강등 권고("최근 글"이 h2이므로 위계 충돌).

### 5.4 배지·eyebrow

```css
.badge {
  display: inline-flex; align-items: center; gap: 0.35em;
  font-size: var(--text-xs); font-weight: 600; line-height: 1;
  padding: 0.4em 0.7em; border-radius: var(--radius-pill);
}
.badge--prod { color: var(--color-topic-prod); background: var(--bg-topic-prod); }
.badge--ai   { color: var(--color-topic-ai);   background: var(--bg-topic-ai); }
.badge--verified { color: var(--color-success); background: var(--color-success-bg); }  /* "직접 테스트" */
.badge--pending  { color: var(--color-warning); background: var(--color-warning-bg); }  /* "확인 예정" */

.eyebrow { font-size: var(--text-sm); font-weight: 600; color: var(--color-muted); letter-spacing: var(--tracking-body); text-transform: none; } /* D7 교정 */
```

### 5.5 notice / 빈 상태

```css
.notice {
  padding: var(--space-4) var(--space-5);
  border-inline-start: 4px solid var(--color-info);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  background: var(--color-info-bg); color: var(--color-ink);
}
.notice--warning { border-inline-start-color: var(--color-warning); background: var(--color-warning-bg); }
.notice--success { border-inline-start-color: var(--color-success); background: var(--color-success-bg); }
.notice--danger  { border-inline-start-color: var(--color-danger);  background: var(--color-danger-bg); }

.empty {
  border: 1px dashed var(--color-line-strong); border-radius: var(--radius-lg);
  padding: var(--space-7); text-align: center;
  background: var(--color-surface); color: var(--color-muted);
}
```

현재 about/contact/author/privacy의 "미확정" 안내는 `notice--warning`으로 분리가 맞다(준비 중 알림 = info가 아니라 caution). 작성자 확정 후 페이지 실운영 시 info/제거 판단.

### 5.6 마크다운 본문 요소 (D19~D23 해결)

```css
.article { max-width: var(--container-prose); margin-inline: auto; }
.article > * + * { margin-block-start: var(--flow-space); }
.article h2 { margin-block: var(--space-8) var(--space-3); }
.article h3 { margin-block: var(--space-6) var(--space-2); }
.article ul, .article ol { padding-inline-start: 1.5em; }
.article li + li { margin-block-start: 0.4em; }
.article li::marker { color: var(--color-brand); font-weight: 700; }  /* 단계 목록低成本 강조 */

/* 인라인 코드 */
.article code {
  font-family: var(--font-mono); font-size: 0.875em;
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-line); border-radius: 4px;
  padding: 0.12em 0.4em; word-break: keep-all;
}
/* 코드블록 */
.article pre {
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-line); border-radius: var(--radius-md);
  padding: var(--space-4); overflow-x: auto; overscroll-behavior-x: contain;
  line-height: 1.65; font-size: var(--text-sm); tab-size: 2; word-break: normal;
}
.article pre code { background: none; border: 0; padding: 0; font-size: inherit; }

/* 키 입력 */
.article kbd {
  font-family: var(--font-mono); font-size: 0.8125rem;
  padding: 0.15em 0.5em; background: var(--color-surface);
  border: 1px solid var(--color-line-strong); border-bottom-width: 2px;
  border-radius: var(--radius-sm); color: var(--color-ink-soft);
}

/* 표 */
.article table { width: 100%; border-collapse: collapse; font-size: 0.9375rem; font-variant-numeric: tabular-nums; }
.article th, .article td { padding: 0.55rem 0.75rem; border: 1px solid var(--color-line); text-align: start; vertical-align: top; }
.article th { background: var(--color-surface-sunken); font-weight: 600; }
.article tbody tr:nth-child(even) td { background: #fafbfd; }

/* 인용·그림 */
.article blockquote {
  margin-block: var(--space-5); padding-inline-start: var(--space-4);
  border-inline-start: 3px solid var(--color-line-strong);
  color: var(--color-ink-soft);
}
.article figure { margin-block: var(--space-5); }
.article figure img { display: block; border: 1px solid var(--color-line); border-radius: var(--radius-md); }
.article figcaption { margin-block-start: var(--space-2); font-size: var(--text-sm); color: var(--color-muted); }

.article hr { border: 0; border-block-start: 1px solid var(--color-line); margin-block: var(--space-7); }
```

- 표 가로 스크롤이 필요한 경우 `table`을 감싸는 래퍼가 표준 — 마크다운 플러그인(구현 담당 협의) 도입 전까지 CSS 단독으로는 `.article table { display: block; overflow-x: auto }` 대신 **본문 표를 최대 5열로 제한**하는 편집 규칙으로 우회.

### 5.7 버튼

```css
.btn {
  display: inline-flex; align-items: center; justify-content: center;
  min-height: 44px; padding-inline: var(--space-5);
  border-radius: var(--radius-md); border: 1px solid transparent;
  font: inherit; font-weight: 600; font-size: var(--text-base);
  text-decoration: none; cursor: pointer;
  transition: background-color var(--motion-fast) var(--ease), border-color var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease);
}
.btn--primary { background: var(--color-brand); color: #fff; }
.btn--primary:hover { background: var(--color-brand-hover); }
.btn--primary:active { background: var(--color-brand-active); }
.btn--ghost { background: var(--color-surface); border-color: var(--color-line-strong); color: var(--color-ink); }
.btn--ghost:hover { border-color: var(--color-muted); }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
```

문의 폼(구현 예정)에 쓸 기본. 현재 페이지에는 버튼이 필요 없다 — 만들지 않는다.

### 5.8 광고 슬롯 (준비 규격 — 현재 렌더링 없음)

```css
.ad-slot {
  margin-block: var(--space-7);
  background: var(--color-ad-bg);
  border: 1px solid var(--color-ad-line);
  border-radius: var(--radius-md);
  display: grid; place-items: center;
  min-height: 280px;              /* 300×250 medium rectangle 예약 — CLS 방지 */
}
.ad-label { font-size: var(--text-2xs); color: var(--color-ad-label); letter-spacing: 0.02em; }
```

배치 규칙 (AdSense 정책 + 신뢰):

1. 글 1개당 최대 2개: 첫 문단 이후 / 본문 4~5문단 뒤 1개 상한.
2. **h2/h3 직후 배치 금지** — 제목과 첫 문단 사이에 광고가 오면 클릭 유도로 읽힌다.
3. `.notice`·`.badge`·카드의 색·테두리를 절대 재사용하지 않는다 (본문 요소와 광고의 시각적 혼동 = 정책 위반 소지).
4. 광고 구역 위아래는 `--space-7` 이상으로 본문과 물리적으로 떼어 둔다.
5. 자체 클릭 유도 문구·"광고를 도와주세요"류 없음.

---

## 6. 상태矩阵

| 대상 | default | hover | focus-visible | active | current | 기타 |
|---|---|---|---|---|---|---|
| 본문 링크 | `--color-link` + 밑줄 1px | 진하게(#123f88) + 밑줄 2px | 링 2px offset 2px | — | — | visited는 기본색 유지(방문 색 변형 금지 — 신뢰) |
| 내비 링크 | ink-soft 밑줄 없음 | brand, 밑줄 없음 | 링, radius sm | brand | `aria-current`: brand + 하단 inset 2px | 44px 타깃 |
| 카드 제목 | ink | link + 밑줄 | 카드 `:focus-within` 테두리+그림자 | — | — | 카드 전체가 아닌 제목 링크가 포커스 |
| 버튼 primary | brand/흰글자 | brand-hover | 링(brand 대비용) | brand-active | — | disabled opacity .55 |
| notice/badge | — | none | — | — | — | 정적 상태 표시 |
| 입력 폼(미래) | surface, line 테두리 | — | border brand 1px + 링 | — | — | error: danger border + danger 텍스트 메시지 |
| 페이지 상태 | empty(`.empty` dashed) / loading(미구현 — JS 상태 없음) / error(404: `.empty` + 홈 링크) | | | | | |

추가 규칙:

- 색이 유일한 상태 신호가 되지 않게 한다(밑줄·두께·아이콘 병용). `prefers-contrast`/forced-colors 모드에서 border만 의존한 구분은 무너지므로 텍스트 라벨 유지.
- 포커스 스타일은 `outline` 기반(기본 제거 금지). `box-shadow` 링은 보조.

---

## 7. 홈 레이아웃 규격

```
[360px]                                  [≥768px]
┌ header (sticky, 64h) ┐           ┌ header (72h) ─────────┐
│ 업무도구 실험실        │           │ 업무도구 실험실   글목록 소개 편집원칙 │
│ 글목록 소개 편집원칙(2행 wrap) │  └──────────────────────────┘
└──────────────────────┘           main: padding-block 48
main: padding-block 24             ┌ container 960 ┐
┌ hero ──────────────┐             │ eyebrow 14 muted
│ eyebrow 14         │              │ h1 1.75→2.375rem
│ h1 clamp(28→38)    │              │ lede 18px ink-soft ≤42rem
│ lede 18 ≤42rem     │              │ "최근 글" h2 22→26
└────────────────────┘              │ post-list 1열 gap16
│ "최근 글" h2         │              │  ┌ card: meta / h3 20 / desc
│ card: pad20, r12    │              └──────────────────
│  meta / h3 / desc   │              footer
└ footer ────────────┘
```

- hero: padding-block `--space-7`(모바일) → `--space-9`(≥768). h1 아래 `--space-3`, lede는 `max-width: 42rem`.
- 첫 글이 없을 때: `.empty` 패널("첫 검증 글을 준비하고 있습니다") + hero 유지. 안내 문구를 `.notice`에서 `.empty`로 교체 권장.
- 목록 정렬·날짜 포맷은 현행 유지. `pubDate`를 `<time datetime="2026-09-04">`로 감싸기 권고.
- `main { min-height: 60dvh; padding-block: var(--space-6) }`, ≥768 `--space-8`.
- 섹션 사이: `--section-gap` — 카드 섹션 h2 위 여백 확보.
- 홈에 추가하지 않을 것: 히어로 사진, 검색창(글 20개 미만에서 무의미), 인기글·사이드위젯, 뉴스레터.

## 8. 글 상세 레이아웃 규격

```
┌ container 960 ── .article 704px 중앙 ─────────────────┐
│ [배지 업무생산성] [✓ 직접 테스트]                        │
│ 2026년 9월 4일 작성 · 2026년 9월 4일 확인 · 작성자(링크)  │  ← post-byline 14px muted
│ H1 clamp(28→38) line 1.35 balance                     │
│ lede 18px ink-soft (description)                      │
│ ─────────────── 1px line 구분 ──────────────────       │
│ 본문 flow (17px / 1.75 / 44rem)                        │
│   h2 22→26 (위 48)  h3 18→20 (위 32)                   │
│   figure 100% measure · pre 가로스크롤 · kbd · 표        │
│   (광고가 붙는 미래: 문단 후 ad-slot min-h 280)          │
│ ─────────────────────────────────────────────          │
│ 테스트 정보 패널 (표면+테두리 카드, 14px dl)             │  ← testedAt / toolVersions / sourceIds
│ 최종 수정 표시                                          │
└─────────────────────────────────────────────────────┘
footer
```

- 상단 trust 레이어: 주제 배지 + "직접 테스트" verified badge(testedAt 존재 시) + 날짜/작성자 한 줄. 현재 템플릿은 eyebrow+meta 2줄 — 배지 체계(§5.4)로 교체 권장.
- 하단 메타 패널:

```css
.meta-panel {
  margin-block: var(--space-8) 0;
  padding: var(--space-4) var(--space-5);
  background: var(--color-surface);
  border: 1px solid var(--color-line); border-radius: var(--radius-lg);
  font-size: var(--text-sm);
}
.meta-panel dl { display: grid; grid-template-columns: auto 1fr; gap: var(--space-1) var(--space-4); margin: 0; }
.meta-panel dt { color: var(--color-muted); font-weight: 600; }
.meta-panel dd { margin: 0; }
```

  - `hr` 2회 사용(현행) → 헤더 하단 구분선 + 메타 패널 카드가 대체.
  - 스크린샷 폭은 measure(704)를 넘기지 않는다 — 큰 이미지도 `width:100%; height:auto`.
  - TOC 사이드바: 글 8개·h2 4개 이상 시점에 `--container-wide`(1152) + `grid-template-columns: minmax(0, 44rem) 15rem`, 사이드 `position: sticky; top: calc(var(--header-h) + var(--space-5)); font-size: var(--text-sm)`, `scroll-margin-top: calc(var(--header-h) + var(--space-4))`. 지금은 도입하지 않는다.
  - 글 하단 "다음 글/이전 글": 리스트 기반 1열 텍스트 링크(카드 재사용 금지, padding 0). 지금은 생략(글 1개 이하).
  - `estimatedReadingTime` 필드·계산 추가 권고 — 콘텐츠 스키마 담당과의 연계 항목(§12).

## 9. 구현 순서

source 수정 없이 규격만 제시한 상태이므로, 실행은 아래 순서. 각 단계는 `npm run build && npm run check:build` 통과를 요구 조건으로 한다(§0주말 종료 조건과 동일 게이트).

1. **기반 파일 신설** — `src/styles/tokens.css` + `src/styles/global.css` 생성, `BaseLayout.astro` `<head>`에서 import하고 레이아웃 `<style>`의 `:global()` 규칙을 단계적으로 이관·삭제(1 PR). `html`에 `initial-scale=1`, `<body>` 최상단 skip link 추가.
2. **토큰 + 베이스** — §3.1~3.3, §5.2. 이 시점에 색상·본문 크기·keep-all·focus-visible이 사이트 전역에 적용. 비고: 이 단계에서 시각 회귀가 가장 크므로 before/after 스크린샷(로컬 dev) 기록.
3. **콘텐츠 마크다운 스타일** — §5.6. `status: published` 목업 글 1개(더미, 배포 안 함)로 렌더 검증 — D4 해소.
4. **레이아웃 골격** — §3.4 컨테이너 3계층, header/footer/main 규격(§7) + `aria-current`.
5. **홈** — §5.3 카드/배지/빈 상태, §7.
6. **글 상세** — §8: trust 헤더(배지·byline·`<time>`), 메타 패널.
7. **상태·반응형 QA** — 360/480/768/1024/1280 실측, 44px 타깃 순회 탭 테스트, `prefers-reduced-motion`, 200% 브라우저 확대. Lighthouse 성능/접근성/SEO ≥95.
8. **AdSense 준비(배포 전 별도 단계)** — §5.8 슬롯·레이블 스타일만 선행, 광고 스크립트 삽입은 Human 승인 게이트(CEO_PLAN 0주차 권한 규칙) 이후.
9. **감당 항목** — 다크 모드(§3.1.2), Pretendard 자기호스트(§3.2), TOC(§8), 관련글. 각 항목은 별도 결정 로그 필요.

## 10. 유지보수 규칙

1. **raw hex 금지** — 컴포넌트·페이지 CSS에 16진수 색을 직접 쓰지 않는다. 새 색이 필요하면 tokens.css에 추가하고 이 문서에 근거를 기록한다. 예외: `#fff` 위 brand 버튼 텍스트 등 토큰화 의미가 없는 순수 상한.
2. **간격은 스케일에서만** — `--space-*` 값 외(15/22/30px 등) 사용 금지. 본문 마진 유닛은 `--flow-space`.
3. **한글 타이포 불문율** — `word-break: keep-all`(전역), 본문 자간 0, heading 최대 -0.01em, `text-transform: uppercase` 금지, 이탤릭 금지, 텍스트 최소 14px(배지 13, 라벨 12).
4. **브레이크포인트 단일 출처** — `@media`의 px는 tokens.css 상단 주석 테이블과 정확히 일치해야 한다(480/768/1024/1280). 새 값 추가는 이 문서 개정 후.
5. **이관 규칙** — BaseLayout의 `:global()`은 단계 1~2에서 제거하는 것을 목표로 한다. 새 공유 스타일은 무조건 `src/styles/global.css`, 페이지 전용 스타일은 그 페이지 컴포넌트의 scoped `<style>`에만 둔다.
6. **대조 검증** — 텍스트·테두리·포커스 색은 추가 시 AA 재계산(본문 4.5:1, 큰 글/UI 3:1), 이 문서 표에 기록. `--color-faint`는 텍스트 용도 사용 금지.
7. **광고 분리 절대 규칙** — `.ad-*` 토큰과 `.notice/.badge/.post-card` 스타일은 서로 참조·재사용 금지. 광고 스타일 변경은 정책 재검토와 함께.
8. **링크 하이라이트 원칙** — 밑줄은 "클릭 가능"의 유일한 기본 신호. hover 전용 밑줄/색 변화는 내비·카드 등 "텍스트인 것처럼 보이는 링크"에만 허용.
9. **장식 상한** — 그림자는 2종(§3.5)만. 트랜지션 대상은 `color/background/border/box-shadow/opacity`와 transform ±2px 이하. 키프레임 애니메이션 신설은 이 문서 개정 없이는 금지.
10. **미사용 제거** — 골격 단계이므로 2주 이상 렌더 경로에 없는 클래스·변수는 삭제(prune) 우선, 유지 코멘트 금지.
11. **변경 기록** — 토큰값(색·크기·여백)을 바꾸면 이 문서 §해당 절에 "개정: 날짜·구→신·사유" 한 줄을 남긴다. 디자인 결정의 single source of truth는 이 파일.
12. **배포 게이트 유지** — `.planning/` 내부 문서이므로 산출물 제외 검사(`check:build`)를 우회하는 어떤 CSS 작업(예: `public/`에 디자인 파일 복사)도 하지 않는다.

## 11. 부록 A — 신규 파일 배치 (제안)

```
src/styles/
  tokens.css   # §3 전체 + §4 브레이크포인트 주석 테이블
  global.css   # §5 컴포넌트 + §6 상태 + §7/§8 레이아웃 규칙
BaseLayout.astro # head에서 2개 import, scoped <style>는 0줄로 수렴(단계 1~2 후)
```

## 12. 부록 B — 타 역할 연계 항목 (결정 이관)

| 항목 | 이관 대상 | 내용 |
|---|---|---|
| `estimatedReadingTime` | 콘텐츠 스키마(DeepSeek/CEO) | front matter 자동 계산 또는 lib 함수 — 상세 trust 헤더에 사용 |
| `updatedDate`(선택) | 콘텐츠 스키마 | 신뢰 신호 "마지막 업데이트" — schema에 없으면 현행 pubDate/testedAt 조합으로 대체 |
| 표 래퍼(hast/rehype) | 아키텍처(DeepSeek) | 넓은 표 가로 스크롤 자동 래핑 |
| 작성자 실명·로고 | Human | author 페이지 trust 레이어 사진 규격(원형 96px, 2x)은 확정 후 |
| 404 페이지 | 구현 담당 | `.empty` 패턴 재사용 규격 본 문서 §6 참조 |
