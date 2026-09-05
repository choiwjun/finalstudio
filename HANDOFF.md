# 업무도구 실험실 — 첫 글 발행 핸드오프

작성일: 2026-09-05 (Asia/Seoul)

## 현재 상태

- 저장소: <https://github.com/choiwjun/finalstudio>
- 브랜치: `main`
- 마지막 커밋: `09a8ad2 qa: add Excel linked picture screenshots`
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

## 배포·인증 메모

- GitHub 연결 및 `origin/main` 푸시는 완료됨.
- Codex OAuth 로그인은 로컬 글쓰기 작업용이며, `OPENAI_API_KEY`와는 별개다.
- 호스팅 연결과 `DEPLOY_HOOK_URL` 등록은 아직 완료되지 않음.
- `npm run image` 등 API 기반 이미지 생성을 사용할 경우에는 별도의 `OPENAI_API_KEY` 설정이 필요할 수 있다. 키를 Markdown, 로그, Git에 기록하지 않는다.

## 안전 규칙

- 발행 전까지 첫 글은 `draft`로 유지한다.
- 출처 없는 가격·버전·지원 범위를 확정적으로 쓰지 않는다.
- 사용자가 열어 둔 Office 문서는 닫거나 강제 종료하지 않는다. QA가 만든 임시 파일·창만 대상으로 정리한다.
- `dist/`는 생성물이며 커밋 대상이 아니다.
