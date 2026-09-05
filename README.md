# 업무도구 실험실

Astro 기반의 정적 블로그 골격입니다.

## 현재 방향

- 핵심 카테고리: 업무도구 실전 (Excel·Google Sheets·Notion·Google Workspace)
- 인접 주제: 직접 테스트한 AI 업무 활용법
- 콘텐츠 원본: Git/Markdown
- 공개 읽기 경로: 정적 HTML
- 자동화: 사람 승인 이후에만 예약 빌드·배포

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
  기본은 로그인된 Codex 구독 엔진이며, `OPENAI_API_KEY`를 설정하면 API 엔진을 사용할 수 있습니다. 둘 다 없으면 ChatGPT 수동 모드 안내로 전환됩니다.
- 저장소를 GitHub에 연결하고 `OPENAI_API_KEY` 시크릿을 등록하면, Actions가 매주 월·목 10시(KST)에
  `scripts/auto-publish/calendar.md`의 다음 주제로 초안 **PR**을 제안합니다 (PR 머지 = 사람 승인).
- 예약 글의 `publishAt` 시각에 정적 호스팅을 다시 빌드하려면 `scheduled-publish.yml`을 사용하고,
  호스팅 Deploy Hook URL을 GitHub `DEPLOY_HOOK_URL` secret으로 등록해야 합니다.
- 프롬프트 파일은 `.planning/prompts/`의 content-writer / chatgpt-humanize / chatgpt-review.
  설치·명령 레퍼런스는 `scripts/auto-publish/README.md`, 파이프라인 원문은 `.planning/prompts/content-pipeline.md`.
- `tools/` 아래 클론(im-not-ai, claude-blog)은 규칙을 추출한 **참고 자료**이며 실행 환경이 아닙니다 (커밋되지 않음).

## 관리자 페이지와 외부 공개

- 개발 환경에서만 `/admin/` 대시보드가 글 메타데이터를 표시합니다.
- `npm run admin`을 실행하면 **개발 서버와 관리 서버가 함께 실행**되고, 대시보드에서 **글 편집·삭제·상태 변경(발행)·새 글 작성·콘텐츠 검사**를 쓸 수 있습니다. 글 변경 후 사이트 반영까지 약 10초가 걸립니다(Astro 개발 서버가 콘텐츠 변경을 감시하지 않아 관리 서버가 재시작·재동기화를 수행). 관리 API는 localhost(127.0.0.1) 전용이며, 삭제는 실제 삭제 대신 `.trash/` 이동입니다.
- 발행 게이트: 상태를 `scheduled`로 바꾸려면 `publishAt`, `published`로 바꾸려면 `testedAt`과 실명 `author`가 필요합니다 (사람 검증 강제 — `scripts/lib/content-contract.mjs` 단일 규칙).
- 운영 빌드에서는 관리자 데이터를 렌더링하지 않고 접근 안내만 표시하며, 대시보드 스크립트도 번들에 포함되지 않습니다 (`scripts/check-build.mjs`가 dist 유출을 검사).
- `public/_headers`에는 정적 호스팅용 보안 헤더 기본값이 있습니다. 배포 서비스가 `_headers`를 지원하지 않으면 해당 서비스 설정으로 옮겨야 합니다.
- 이 프로젝트는 정적 사이트이므로 로그인·권한 검사를 자체 제공하지 않습니다. 운영 환경에서는 관리자 경로를 인증 또는 비공개 호스팅으로 보호해야 합니다.
