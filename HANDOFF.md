# WJ Blog — 첫 글 발행·디자인 핸드오프

작성일: 2026-09-05 (Asia/Seoul)

## 현재 상태

- 저장소: <https://github.com/choiwjun/finalstudio>
- 브랜치: `main`
- 마지막 커밋: `944b1de docs: add first post publishing handoff`
- 첫 글: `src/content/posts/excel-linked-picture.md`
- 현재 상태: `status: draft`
- Excel 사용자가 라이선스 동의 화면에서 `수락`을 직접 눌렀음.

## 완료된 작업

- Excel Microsoft 365 16.0 한국어 화면을 열어 표 범위, 붙여넣기 옵션, 리본 사용자 지정 화면을 캡처함.
- 캡처 6건을 `public/images/`에 저장하고 첫 글 Markdown에 연결함.
  - `excel-linked-picture-1.png` ~ `excel-linked-picture-6.png`
- Q2 값을 `156`에서 `222`로 변경한 뒤 연결 그림 화면에 반영되는 것을 캡처함.
- 공식 출처 URL 1건을 본문에 연결함: <https://support.microsoft.com/en-us/excel/paste-options>
- 다음 명령을 통과함.

```bash
npm run check:content
npm run build
npm run check:build
```

- 로컬 정적 미리보기에서 홈 `/`은 HTTP 200을 확인함.
- 첫 글 경로 `/posts/excel-linked-picture/`는 `draft` 보호 때문에 HTTP 404인 것을 확인함.
- 현재 변경사항은 GitHub `main`에 푸시되어 있음.

## 발행 전 반드시 처리할 일

### 1. Excel 연결 그림 경로를 사람 화면에서 최종 확인

현재 `excel-linked-picture-4.png`, `excel-linked-picture-5.png`는 Word의 링크 그림과 갱신 결과를 보여주는 QA 캡처다. 자동화 환경에서는 Excel 범위를 렌더링한 이미지 파일을 Word에 연결하는 방식으로 안정적인 화면을 만들었다.

따라서 다음을 Windows에서 사람이 한 번 확인해야 한다.

1. Excel에서 실제 표 범위를 `Ctrl+C`.
2. Word에서 `홈 → 붙여넣기` 아래 화살표를 열기.
3. 실제 `연결된 그림` 항목을 선택.
4. Excel 원본 값을 변경하고 Word 그림의 갱신 여부를 확인.
5. 현재 캡처와 실제 화면이 다르면 3~5번 캡처를 다시 저장하고 Markdown 경로는 유지.

### 2. 남아 있는 직접 확인 3건

첫 글에 아래 항목은 아직 `[직접 확인 필요]`로 남아 있다.

- 고DPI·화면 배율에 따른 흐림 정도
- 웹용 Excel에서의 지원 여부
- 원본 시트 또는 원본이 되는 파일을 삭제했을 때의 실제 동작

확인하지 못한 내용을 확정 문장으로 바꾸지 말고, 확인 결과 또는 주의사항으로 본문을 갱신한다.

### 3. 작성자와 테스트 메타데이터 확정

- `author: 테스터`를 실제 표시할 작성자명으로 변경.
- 실제 최종 테스트 날짜를 `testedAt: YYYY-MM-DD`로 추가.
- `toolVersions.Excel`에 실제 확인한 Office 버전을 유지.
- 위 확인이 끝나기 전에는 `status: published`로 바꾸지 않는다.

### 4. 브라우저 실측 후 발행

메타데이터와 본문 검토가 끝난 뒤 다음 순서로 실행한다.

```bash
npm install
npm run check:content
npm run build
npm run check:build
npm run preview -- --host 127.0.0.1
```

브라우저에서 첫 글의 제목, 본문 폭, 이미지 크기·대체 텍스트, 표·코드·링크, 모바일 폭을 확인한다. 수정이 있으면 다시 세 검사를 실행한다.

그 다음에만 `status: published`로 변경하고, `npm run build` 결과에 첫 글 경로가 생성되는지 확인한다. 최종 발행은 사람 승인 후 진행한다.

## 일반 블로그 전면 재수정 — v0 반려 / WJ Blog v1 구현 완료(로컬)

v0는 기술적으로 구현됐지만 블로그 스타일과 맞지 않아 소유자가 반려했다. 이번 세션에서 상위권 블로그의 탐색 구조를 다시 조사하고, 랜딩페이지형 v0를 **티스토리·워드프레스와 같은 일반적인 개인 블로그 기본 구조**로 전면 교체했다. `업무도구`는 첫 카테고리일 뿐이며, 블로그 이름·내비게이션·콘텐츠 계약은 특정 주제에 묶이지 않는다. 근거와 규격은 `.planning/research/blog-design-benchmark-2026-09-06.md`와 `.planning/design/DESIGN_SYSTEM_V1.md`에 기록했다. 기존 `.planning/design/DESIGN_SYSTEM.md`는 v0 역사 기록이다.

### 이번에 반영한 것

- 헤더를 `WJ Blog · 홈 · 카테고리 · 소개 · 검색` 중심의 일반 블로그 내비게이션으로 교체하고, 편집 원칙·문의 등은 푸터 보조 링크로 이동.
- 홈을 짧은 소개 → 최근 글 → 카테고리 → 블로그 소개 순서로 재구성.
- 공개 글이 0건이어도 아카이브처럼 보이는 빈 상태를 적용.
- `/categories`, `/categories/<category>` 범용 카테고리 목록 페이지 추가.
- `/search` 정적 공개 글 검색 페이지 추가.
- 글 상세에 브레드크럼·주제/검증 배지·읽기 레이아웃·테스트 정보·다음 읽을거리 영역 추가.
- 색상·간격·레이아웃을 v1 일반 블로그 토큰으로 교체하고 390px 대응 스타일 추가.

### 확장 기준

- `src/content.config.ts`의 `topic`은 고정 enum이 아닌 문자열이다.
- 새 글의 frontmatter에 `topic: travel`, `topic: books`처럼 카테고리를 추가하면 홈·카테고리 목록·검색·글 상세에 자동 반영된다.
- 기존 `productivity`, `ai-workflows` 값은 첫 글과 기존 초안의 데이터 호환을 위해 남겨 둔 초기 카테고리다.

### 남은 디자인 QA

- 390px·768px·1440px 브라우저 실측: 메뉴, 검색, 주제 목록, 빈 상태, 글 상세.
- 키보드 전체 순회, 200% 확대, 스크린리더와 표·코드 스크롤 확인.
- 첫 글 발행 후 실제 글 이미지·관련 글·목록 밀도 재확인.
- v1 디자인 승인과 첫 글 발행 승인은 별도 게이트로 유지.

## 배포·인증 메모

- GitHub 연결 및 `origin/main` 푸시는 완료됨.
- Codex OAuth 로그인은 로컬 글쓰기와 커버 이미지 생성에 함께 사용한다. OpenAI API 키는 사용하지 않는다.
- 호스팅 연결과 `DEPLOY_HOOK_URL` 등록은 아직 완료되지 않음.
- `npm run image -- --slug <슬러그>`는 Codex `$imagegen`으로 커버를 생성하고, `--engine manual`은 ChatGPT Images에서 생성한 파일을 등록한다. 본문 UI 스크린샷은 사람이 직접 촬영한다.

## 안전 규칙

- 발행 전까지 첫 글은 `draft`로 유지한다.
- 출처 없는 가격·버전·지원 범위를 확정적으로 쓰지 않는다.
- 사용자가 열어 둔 Office 문서는 닫거나 강제 종료하지 않는다. QA가 만든 임시 파일·창만 대상으로 정리한다.
- `dist/`는 생성물이며 커밋 대상이 아니다.
