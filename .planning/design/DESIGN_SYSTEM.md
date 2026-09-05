# DESIGN_SYSTEM — canonical 디자인 시스템 v0

- 상태: **v0 구현 완료(로컬).** 이 문서는 디자인 시스템의 single source of truth다.
- 작성: 2026-09-05 — design-v0-implementation 워커 (Orca `run_5318bed1d0a2` / `task_7d7d0e5e3973` / `ctx_4e99369367d1`)
- 입력(원본 3 보고서, 수정하지 않음): `muse-brand-ux.md`, `qwen-ui-system.md`, `deepseek-a11y-qa.md`
- 구현 파일: `src/styles/tokens.css`, `src/styles/global.css`, `src/layouts/BaseLayout.astro`, `src/pages/*`, `src/lib/format.ts`
- 배포·자격증명·외부 서비스 연결: 하지 않음 (week0 게이트 유지)

---

## 1. 통합 결정 (세 보고서 공통 합의)

1. **텍스트 우선**: 장식 대신 읽기와 신뢰(E-E-A-T)에 투자. 히어로 이미지·캐러셀·다단 썸네일 그리드·스크롤 이펙트 배제 (Muse §4, Qwen §2).
2. **신뢰 메타를 1급 정보로**: 테스트 날짜·도구 버전·AI 보조 여부와 출처·확인일을 목록 카드와 본문 상/하단에 노출 (Muse D-UX-1/3, Qwen §8).
3. **한국어 타이포 불문율**: `word-break: keep-all`, 본문 자간 0, 헤드라인 최대 `-0.01em`, `uppercase` 금지, 합성 italic 금지, 텍스트 최소 14px (Qwen §3.2).
4. **토큰 단일 출처**: 컴포넌트 CSS에 raw hex·스케일 외 간격 금지. 값은 `tokens.css`에만 (Qwen §3, §10).
5. **시스템 폰트 유지**: 웹폰트 0개로 시작. Pretendard 자기호스팅은 P2 보류 (Muse A8, Qwen 폰트 로드 표, DeepSeek 2.10).
6. **접근성 기본**: skip link, `main#main`, `:focus-visible`, 44px 터치 타깃, `aria-current`, 색상 단일 신호 금지 (DeepSeek 전편, Qwen §5.2/§6).
7. **광고 분리 준비**: `.ad-slot`/`.ad-label` 규격과 전용 토큰만 선행 준비. 렌더링·스크립트 삽입은 Human 승인 게이트 이후 (Qwen §5.8, Muse 반목표).
8. **라이트 단일 테마**: 다크 모드는 토큰만 비활성 보관 (`:root[data-theme="dark"]` 게이팅) (Qwen §3.1.2).

## 2. 충돌 판정 (상위 보고서 결정)

| # | 충돌 | 판정 | 근거 |
|---|---|---|---|
| C1 | DeepSeek 2.4 "문서 라우트가 없다" vs 실제 코드 | **사실 오류로 기각.** `src/pages/posts/[...slug].astro`는 존재했다. HANDOFF §6 지시대로 원본 코드 기준 재검증 완료 | HANDOFF 주의사항 |
| C1-b | 같은 파일의 `post.slug`는 Astro 7 콘텐츠 레이어에서 **undefined** (pubDoc 공개 글 0건이라 은폐됨 — Qwen D4가 예고한 dead code) | `post.id`로 수정. 임시 공개 글 스모크 빌드로 `/posts/<id>/` 렌더 실증 후 삭제 | 구현 웨이브 실측 §7 |
| C2 | Muse D-IA-1/4의 `/productivity`·`/ai-workflows` 목록 라우트 신설 vs "기존 라우트 계약 보존" 지시 | **v0 범위 밖으로 유보.** 라우트 미생성. 홈에 비링크 주제 갈래 패널 2개로 D-UX-4를 대체 충족. 라우트 신설은 목록 웨이브 결정으로 이관 | Dispatch 지시 + Muse P1 |
| C3 | Muse D-SEO-1 (JSON-LD는 P1) vs QA/Dispatch 요구(페이지 메타·JSON-LD) | **v0에서 선행 구현.** `WebSite`(홈)·`BlogPosting`+`BreadcrumbList`(글)·twitter card·og:type·페이지별 description 추가 | Dispatch 명시 요구 |
| C4 | `sourceIds` 원문 노출 vs `check-build`의 `sourceIds` 금지어와 렌더 형식 미확정 (Muse §7·D-UX-5·§13-3) | **잠정 형식**: 필드명 원문은 렌더하지 않고 "출처·확인" 라벨 + 항목 리스트 + 확인일(testedAt)로 표시. 금지어는 필드명 문자열이라 안전. 최종 형식은 Human 승인 시 개정 로그 기록 | Muse §13 보류 항목 반영 |
| C5 | DeepSeek "푸터 문구('검증 콘텐츠 있음' 인상을 준다)" | 푸터를 원칙 선언형으로 교체: "직접 확인과 사람 검토를 거친 콘텐츠만 공개합니다." | DeepSeek 2.1 |
| C6 | 목록 정렬을 testedAt 우선으로 (Muse) vs 현행 pubDate | **v0는 pubDate 유지.** 글 1개 미만에서 체감 차이 없음·`lib/posts.ts` 계약 보존. 20개 시점 재검토 | MINIMAL-CHANGE |
| C7 | 작성자 신원 미확정 vs Qwen §8 "작성자(링크)" | `/author`는 존재하는 라우트이므로 byline 링크 유지. 실명·전력 공개는 week0 게이트대로 보류 | D-TRUST-1 |
| C8 | 예약 글(JSON-LD datePublished) 위험 | `publishAt`은 어떤 메타에도 쓰지 않음. `pubDate > 빌드 시각`인 이상 케이스는 `robots: noindex`로 보호 | DeepSeek 4.3 |

## 3. 토큰 (`src/styles/tokens.css`)

Qwen §3 규격을 그대로 이식. 요약:

- **색상**: 검증된 현행 값 유지(`#172033`/`#174ea6`/`#e5e9f0`/`#fbfcfe`) + 계층화. 무채색은 파란기 gray. `--color-faint`는 텍스트 사용 금지(3.2:1). 시맨틱 4종, 주제 2종 고정, 광고 전용 neutral 3종(본문 컴포넌트와 참조·재사용 금지).
- **타이포**: `--text-2xs(12)~h1(clamp 28→38)`, 줄간격 body 1.75 / snug 1.5 / head 1.35, `--flow-space: 1.15em`, `--measure-prose: 44rem`.
- **간격**: 4px 스케일 `--space-1~12`, `--section-gap: clamp(40,6vw,64)`, `--gutter-inline: clamp(16,4vw,20)`.
- **폭 계층**: narrow 36rem(법률·단문) / prose 44rem(본문) / page 60rem(프레임) / wide 72rem(TOC futura).
- **라운드·그림자·모션**: radius 4종, 그림자 2종 고정, 120/180ms, `--ease`.
- **브레이크포인트 단일 출처**: 480 / 768 / 1024 / 1280 (모바일 우선, `@media`는 리터럴 px — 파일 상단 주석 테이블이 규격).

## 4. 컴포넌트·상태 (`src/styles/global.css`)

- **헤더/내비**: sticky, 단행(min-height 64→72@md), wrap 허용(햄버거 없음 — DeepSeek 권고), 내비 `aria-current="page"` = brand + inset underline, 44px 타깃.
- **링크**: 본문 링크는 항상 밑줄. hover 두께 1→2px. visited 색 변형 금지. 카드 제목은 ink + hover에만 연결색 (Qwen D11 교정).
- **배지**: `badge--prod`/`badge--ai`(주제), `badge--verified`("직접 테스트" — testedAt 존재 시), `badge--pending`("AI 보조 · 사람 검토" 확인 대기 계열).
- **notice 4분리**: info(기본)/warning(준비중·플레이스홀더 5개 페이지 전부)/success/danger. **empty**: dashed 패널(홈 빈 상태·404).
- **마크다운 본문**: `p, h2~h3, ul/ol(marker 브랜드색), inline code, pre(가로스크롤·`word-break: normal`), kbd, table(tabular-nums·zebra), blockquote, figure/figcaption, hr` 전량 규격화 — Qwen §5.6 이식. 표는 편집 규칙상 최대 5열(rehype 래퍼는 보류).
- **post 상세**: `.post-header`(배지·h1·byline·lede, 하단 구분선) + `.meta-panel`(dl 그리드: 직접 테스트/도구 버전/출처·확인 + AI 고지) + 목록 회귀 링크. 기존 `hr` 2회 구조는 헤더 구분선·메타 카드가 대체.
- **광고 슬롯(미렌더)**: `min-height: 280px`(300×250 예약, CLS 방지). 배치 규칙 5조는 Qwen §5.8 인용 — h2/h3 직후 금지, notice/badge/카드와 스타일 공유 금지.
- **버튼**: `.btn--primary/.btn--ghost` 44px — 문의 폼 구현 시에만 사용 (현재 렌더 없음).

## 5. 페이지별 규격과 구현 상태

| 페이지 | 적용 내용 |
|---|---|
| `/` 홈 | hero(eyebrow·h1·lede) → 주제 갈래 2패널(C2) → 최근 글(카드: 주제·verified 배지, `<time>` 작성·테스트, h3 제목 링크, `aria-labelledby`) → 신뢰 요약(편집 원칙 링크). 빈 상태는 `.empty` 패널로 교체(Qwen §7) |
| `/posts/<slug>` | trust 헤더(배지 3종·byline `<time>` 작성/확인·lede), 마크다운 본문, 메타 패널(testedAt·toolVersions·출처·확인·AI 고지), BlogPosting+Breadcrumb JSON-LD, og:type=article, 미래 pubDate noindex(C8) |
| About / Editorial | `.article` 폭, 원칙 텍스트 유지, about notice→warning, editorial에 광고 구분 원칙 1문단 추가 |
| Author / Contact / Privacy | 페이지별 `description` 명시(DeepSeek 위험 해소), `.article--narrow`(36rem), 실제 운영 전 안내 + `notice--warning` 유지(D-TRUST-1) |
| 404 (신규) | `.empty` 패턴 + 홈 링크 + noindex (DeepSeek 4.1) |

## 6. 접근성 구현 체크리스트 (대신 상태)

- [x] skip link(포커스 시 노출) → `#main`, `<main id="main">`
- [x] `:focus-visible` 2px 아웃라인 + offset (브라우저 기본 제거 코드 없음)
- [x] `viewport initial-scale=1`, `lang="ko"`, `color-scheme: light`
- [x] 내비·푸터 `<ul>` 그룹화 + 푸터 `aria-label="푸터 링크"` (중복 읽기 방지)
- [x] 44px 최소 터치 타깃(내비·푸터·버튼)
- [x] `prefers-reduced-motion`에서 transition/animation 0.01ms
- [x] 날짜 `<time datetime="YYYY-MM-DD">` + 기계·인간 판독 병기, `tabular-nums`
- [x] 색상 단독 신호 금지: 배지는 텍스트 라벨, notice는 보더+라벨, 구분선은 문맥 유지
- [x] 대비: 유지 값 전부 AA(본문 13.8:1, 링크 7.8:1, muted 5.4:1; success/warning/danger는 배경 위 5.4~5.9:1 — Qwen §3.1 표)
- [ ] 남은 것(수동·출시 전): NVDA/VoiceOver 실읽기, 키보드 전 구간 순회 탭, 360/480/768/1024/1280 스크린샷 비교, 200% 확대 리플로우, axe-core CI 연계(별도 승인)

## 7. SEO·메타데이터 구현 상태

- 페이지별 `title`/`description` 전부 고유(BaseLayout 기본값은 폴백으로만 존재).
- `og:type` website/article 분리, `og:site_name`, `og:locale=ko_KR`, `twitter:card=summary`.
- JSON-LD: 홈 `WebSite`, 글 `BlogPosting`(datePublished=pubDate — publishAt 사용 금지 규칙 명문화) + `BreadcrumbList`.
- canonical: `PUBLIC_SITE_URL` 미설정 시 현행 localhost 폴백 유지(도메인 승인 전 배포 금지 게이트와 무관하게 동작). `.env.example` 주의는 CEO_PLAN 2.4·DeepSeek 2.7 소관 — v0 범위 밖.
- sitemap/robots는 `site` 설정 시에만 활성화되는 기존 계약 그대로(변경 없음).

## 8. 콘텐츠 계약·빌드 경계 (보존 확인)

- 수정하지 않음: `content.config.ts`, `lib/posts.ts`(isPublicPost/getPublicPosts 로직), `scripts/check-*.mjs`, `sample-draft.md`, robots 라우트, astro 설정.
- `check:content` / `build` / `check:build` 전부 통과 (최종 상태: 공개 글 0건 — 9개 산출물).
- 스모크 검증 절차: 임시 `published` 글 1개로 `/posts/<id>` 렌더(time×4, kbd, table, JSON-LD×2, 배지, warning notice 구분, 홈 카드 링크) 실증 → 파일 삭제 → 재생성 산출물에서 잔존 없음 확인. `sourceIds`·`TBD`·`.planning/` 금지어 무노출 검증 포함.
- 발견된 소스 버그 1건: `getStaticPaths`의 `post.slug` → `post.id` (C1-b). 이 수정 전에는 첫 공개 글이 `/posts/index.html` 오경로에 렌더됐을 것.

## 9. 파일 목록

```
src/styles/tokens.css          신규 — 토큰 전체 + 브레이크포인트 주석 규격
src/styles/global.css          신규 — 베이스/컴포넌트/본문/상태 (BaseLayout에서 import)
src/lib/format.ts              신규 — formatKoDate·toIsoDate·topicLabel·topicBadgeClass
src/layouts/BaseLayout.astro   재작성 — :global() 스타일 0줄 수렴(§9단계1), 스킵링크·포커스·메타·JSON-LD·noindex·ogType props
src/pages/index.astro          주제 갈래·신뢰 요약·카드 v2·.empty
src/pages/posts/[...slug].astro trust 헤더·메타 패널·JSON-LD·post.id 수정
src/pages/{about,author,contact,privacy,editorial-policy}.astro  description·notice 변형·narrow 폭
src/pages/404.astro            신규 — noindex 빈 상태
```

## 10. 유지보수 규칙 (Qwen §10 계승 — 위반 시 개정 필요)

1. raw hex·스케일 외 간격 금지 — 새 값은 tokens.css에 추가하고 이 문서에 근거 기록.
2. 한글 타이포 불문율 변경 금지(keep-all·자간 0·uppercase 금지·italic 금지·최소 14px).
3. `@media` px는 480/768/1024/1280 외 값 금지 — 추가는 이 문서 개정 후.
4. 공유 스타일은 `global.css`, 페이지 전용은 그 컴포넌트의 scoped `<style>`에만. BaseLayout `:global()` 부활 금지.
5. 새 색·테두리·포커스 색은 AA 재계산 후 표에 기록. `--color-faint` 텍스트 금지.
6. `.ad-*` 토큰과 `.notice/.badge/.post-card` 스타일 상호 참조 절대 금지.
7. 토큰 값 변경은 "개정: 날짜 · 구→신 · 사유" 한 줄을 §12에 추가.
8. 2주 이상 렌더 경로 없는 클래스·변수는 삭제 우선.

## 11. 보류 항목 (각 항목은 별도 Human 결정 필요)

| 항목 | 상태 | 게이트 |
|---|---|---|
| 다크 모드 | 토큰 비활성 보관 | AdSense 인벤토리 결정 후 |
| Pretendard 자기호스팅 | 미적용 | P2 — 서브셋·size-adjust 계획 수반 |
| TOC 사이드바·이전/다음 글·관련 글 | CSS 여백만(1152) | 글 8개/h2 4개 이상 |
| 광고 스크립트·슬롯 렌더 | CSS 준비만 | Human 승인(CEO_PLAN 0주차) |
| 주제 목록 라우트 `/productivity` 등 | 미생성(C2) | 목록 웨이브 |
| `estimatedReadingTime`·`updatedDate`·`tags[]`·heroImage/alt 스키마 | 미추가 | 콘텐츠 스키마 개정 |
| axe·Lighthouse CI, rehype 표 래퍼, RSS | 미구현 | 출시 QA 웨이브 |
| 출처 노출 최종 형식 | 잠정(C4) | Muse §13-3 Human 승인 |

## 12. 개정 로그

- 2026-09-05: v0 작성 — 3 보고서 통합, C1~C8 판정, 구현 반영, `post.slug`→`post.id` 교정.
