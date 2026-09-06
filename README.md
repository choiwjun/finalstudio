# WJ Blog

Astro 기반으로 만든 나만의 정적 블로그입니다. 카테고리와 글을 계속 추가할 수 있도록 특정 주제에 종속되지 않는 구조로 만들었습니다.

## 현재 방향

- 블로그 성격: 업무도구·공부·리뷰·여행·일상 등 원하는 주제를 담는 개인 블로그
- 현재 첫 카테고리: 업무도구 실전 (새 카테고리는 글 frontmatter의 `topic`으로 추가)
- 콘텐츠 원본: Git/Markdown
- 공개 읽기 경로: 정적 HTML
- 자동화: 사람 승인 이후에만 예약 빌드·배포

## 블로그 UI/UX v2 — Signal Archive

- v0 랜딩페이지형 시안과 v1 일반 블로그 템플릿을 재검토하고, 검색·읽기 큐·주제 인덱스를 중심으로 한 `Signal Archive` 방향으로 전면 재설계했습니다.
- 2번 시안의 검색 우선 정보 구조와 3번 시안의 차분한 아카이브 리듬을 결합했습니다.
- 카테고리 목록: `/categories`, 개별 카테고리: `/categories/<category>`
- 공개 글 검색: `/search`
- 조사 근거: `.planning/research/blog-design-benchmark-2026-09-06.md`
- 현재 디자인 규격: `.planning/design/DESIGN_SYSTEM_V2.md`
- 공개 홈은 `검색 → 오늘의 읽을 글 → 최근 읽기 큐 → 주제 지도` 순서로 동작하고, 관리자 화면은 별도 운영 쉘을 사용합니다.

## 개발

```bash
npm install
npm run check:content
npm run build
npm run check:build
npm run dev
```

실제 도메인을 승인하기 전까지는 `PUBLIC_SITE_URL`을 설정하지 않아도 로컬 빌드가 가능합니다. `.planning/`은 내부 기획 문서이며 사이트 콘텐츠가 아닙니다.

## 자동 글발행 파이프라인

- `/admin/` 대시보드의 **자동 글발행** 메뉴에서 전체 흐름과 실행 명령을 확인할 수 있습니다.
- **`npm run auto:write "주제"` 한 줄**로 초안 생성 → 윤문 → 검수(90점 게이트) → draft 저장까지 자동 실행됩니다.
  모든 생성 단계는 ChatGPT OAuth로 로그인한 Codex CLI를 사용하며, OpenAI API 키를 사용하지 않습니다.
- GitHub Actions는 API 키 없는 운영 원칙에 따라 콘텐츠 검사·빌드·배포 검증만 담당합니다. 초안 생성은
  로컬 Codex 세션에서 `npm run auto:write --calendar scripts/auto-publish/calendar.md`로 실행합니다.
- 예약 글의 `publishAt` 시각에 정적 호스팅을 다시 빌드하려면 `scheduled-publish.yml`을 사용하고,
  호스팅 Deploy Hook URL을 GitHub `DEPLOY_HOOK_URL` secret으로 등록해야 합니다.
- 프롬프트 파일은 `.planning/prompts/`의 content-writer / chatgpt-humanize / chatgpt-review.
  고정 편집 헌법·문체·구조 템플릿은 `.editorial/`에서 관리하며, `npm run check:prompts`로 계약을 검사합니다.
  `npm run auto:improve -- --input <초안>`은 Codex OAuth 기반 개선안만 생성하고 실제 파일은 자동 수정하지 않습니다.
  설치·명령 레퍼런스는 `scripts/auto-publish/README.md`, 파이프라인 원문은 `.planning/prompts/content-pipeline.md`.
- `tools/` 아래 클론(im-not-ai, claude-blog)은 규칙을 추출한 **참고 자료**이며 실행 환경이 아닙니다 (커밋되지 않음).

## 관리자 페이지와 외부 공개

- 개발 환경에서만 `/admin/` 대시보드가 글 메타데이터를 표시합니다.
- `npm run admin`을 실행하면 **개발 서버와 관리 서버가 함께 실행**되고, 대시보드에서 **글 편집·삭제·상태 변경(발행)·새 글 작성·콘텐츠 검사**를 쓸 수 있습니다. 글 변경 후 사이트 반영까지 약 10초가 걸립니다(Astro 개발 서버가 콘텐츠 변경을 감시하지 않아 관리 서버가 재시작·재동기화를 수행). 관리 API는 localhost(127.0.0.1) 전용이며, 삭제는 실제 삭제 대신 `.trash/` 이동입니다.
- 발행 게이트: 상태를 `scheduled`로 바꾸려면 `publishAt`, `published`로 바꾸려면 `testedAt`과 실명 `author`가 필요합니다 (사람 검증 강제 — `scripts/lib/content-contract.mjs` 단일 규칙).
- 운영 빌드에서는 관리자 데이터를 렌더링하지 않고 접근 안내만 표시하며, 대시보드 스크립트도 번들에 포함되지 않습니다 (`scripts/check-build.mjs`가 dist 유출을 검사).
- `public/_headers`에는 정적 호스팅용 보안 헤더 기본값이 있습니다. 배포 서비스가 `_headers`를 지원하지 않으면 해당 서비스 설정으로 옮겨야 합니다.
- 이 프로젝트는 정적 사이트이므로 로그인·권한 검사를 자체 제공하지 않습니다. 운영 환경에서는 관리자 경로를 인증 또는 비공개 호스팅으로 보호해야 합니다.
