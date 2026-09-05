# design-v0 빌드 & 콘텐츠 계약 QA

- 작성: 2026-09-05
- 워커: Command Code `deepseek/deepseek-v4-flash-fast`
- Run: `run_5318bed1d0a2`, Task: `task_0cc05797430a`, Dispatch: `ctx_2107ce8055`
- 범위: read-only QA. `src/`와 `.planning/design/`은 수정하지 않음. 이 보고서(`.planning/qa/design-v0-build.md`)만 생성.
- 기준: `.planning/HANDOFF.md`와 `.planning/CEO_PLAN.md`에 따른 현재 골격(디자인 구현 웨이브 미반영) 상태.

## 실행한 검증 (read-only)

1. `npm run check:content` → **PASS** — `Content contract OK: 1 Markdown file(s)`, exit 0
2. `npm run build` → **PASS** — `7 page(s) built`, `[build] Complete!`, exit 0
3. `npm run check:build` → **PASS** — `Build boundary OK: 9 output file(s)`, 금지 토큰 0건, exit 0

세 명령 모두 성공. QA 동안 소스를 변경하지 않았다.

## 항목별 pass/fail

- **[PASS] 콘텐츠 스키마·상태 규칙** — `src/content.config.ts`가 `title`, `description`, `pubDate`, `status`, `topic`, `angle`, `author`, `sourceIds`, `publishAt`, `testedAt`, `toolVersions`, `aiAssisted`, `canonical`을 강제한다. `scripts/check-content.mjs`가 필수 키, `status` enum(`draft|scheduled|published`), `scheduled`는 `publishAt` 필요, `published`/`scheduled`는 실제 `author`·`testedAt` 필요를 검사해 CEO_PLAN §3.1의 최소 front matter 계약과 일치한다.
- **[PASS] draft/public 동작** — `src/lib/posts.ts#isPublicPost`: draft는 항상 비공개, scheduled은 `publishAt <= now`일 때만 공개, published은 `publishAt` 없거나 과거일 때만 공개. `sample-draft.md`(`draft`, `author: TBD`)는 홈(`index.astro`)과 글 라우트(`posts/[...slug].astro`의 `getStaticPaths`) 양쪽에서 제외되어, `dist/`에 `posts/` 산출물이 없다.
- **[PASS] 라우팅 커버리지** — 빌드가 `/`, `/404`, `/about`, `/author`, `/contact`, `/editorial-policy`, `/privacy`, `/robots.txt`를 정적 산출한다. 헤더·푸터(`BaseLayout.astro`)의 모든 링크가 실제 페이지로 해석된다. CEO_PLAN §4가 요구한 About·Author·Contact·Privacy·Editorial Policy 페이지가 전부 존재한다.
- **[PASS] 정적 빌드 산출물** — Astro 정적 확장이 에러 없이 성공(exit 0).
- **[PASS] `.planning/` 내부자료의 dist 부재** — `check:build`가 `.planning/`, `sourceIds`, `TBD`를 dist 전체에서 검사해 0건 적중. draft가 공개되지 않아 `TBD`가 산출물에 나타나지 않는 것도 함께 확인.
- **[확인/미결] SEO·canonical·sitemap 경계** — `PUBLIC_SITE_URL` 미설정이면 sitemap 통합이 비활성이고 `robots.txt`에 `Sitemap:` 라인이 없다(도메인 확정 전 의도된 동작). 다만 `BaseLayout.astro`의 canonical/og:url이 `http://localhost:4321/…`로 폴백한다(실측: `/` 페이지 canonical = `http://localhost:4321/`). 실배포 시 CI에서 `PUBLIC_SITE_URL`을 고정하지 않으면 canonical이 localhost로 남으므로, 배포 게이트에 이 설정을 강제해야 한다. `check:build`는 canonical 호스트를 감시하지 않으므로 별도 게이트로 둘 것.
- **[PASS] CI 회귀 위험** — 콘텐츠·빌드·경계 검사가 모두 통과해 현재 상태의 회귀는 기본적으로 없음. 참고: `check-content`는 `key: value`를 한 줄에 파싱하므로 다중행 YAML 값에는 취약하고, `published`/`scheduled` 글은 반드시 실제 `testedAt`이 필요하다.

## 환경 주의

- 개발 환경(OneDrive/WSL 마운트)에서는 Vite 의존성 최적화가 냉 상태에서 30초를 초과해, 기본 셸 타임아웃과 겹치면 `ENOTEMPTY` 또는 멈춤이 재발할 수 있다.
- 여러 `astro build`를 동시에 띄우면 공유 `.astro`/`dist/.prerender` 캐시가 뒤섞여 잘못된 렌더 에러(`Cannot read properties of undefined (reading 'replace')`)를 만들 수 있다. **검증은 단일·직렬 빌드로만 수행할 것.**
- 위 QA는 캐시 정리 후 단일 빌드로 수행했으며, 이 에러는 소스 오류가 아니라 동시 실행 산물인 것을 확인했다.

## 결론

현재 골격은 콘텐츠 계약, draft/public 제외, 라우팅, 정적 빌드, 내부문서 보호가 모두 pass. 유일한 실배포 전 게이트는 `PUBLIC_SITE_URL` 없이 배포하지 않기(canonical/sitemap)이며, 이 보고서 파일 이외에 변경한 항목은 없다.