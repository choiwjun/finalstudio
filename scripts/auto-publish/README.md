# 자동 글발행 파이프라인

관리자 대시보드(`/admin`, 개발 환경)의 **자동 글발행** 메뉴와 연결되는 파이프라인 설명서입니다.
**명령 1줄로 초안 생성 → 윤문 → 검수 → draft 저장까지 자동 실행**됩니다.

```
npm run auto:write "글 주제" --level 완전초보 --stage 정보 --topic 카테고리 [--format 유형] [--notes 원자료]
        │
        ├─ [자동] 1단계 초안 (편집 헌법+문체+페르소나+블루프린트+exemplar)
        │         --best-of N이면 N개 생성 후 기계 점수로 최적 선택
        ├─ [자동] 2단계 윤문 — 한국어 AI 티 제거 (im-not-ai 규칙 이식)
        ├─ [자동] 기계 검사 — check-writing.mjs (문장·구조·형식·마커·출처 없는 주장)
        ├─ [자동] 독립 심사 — 작가 컨텍스트를 배제한 심사자만 채점 (작가 ≠ 심사자)
        │         미달이면 기계 실패 목록 + 심사 지적을 반영한 수정 루프 (기본 2회)
        ├─ [자동] 프론트매터 변환 → status: draft 저장
        │         (기계 검사 0건 실패 && 심사 90점 이상일 때만 저장)
        ▼
[사람] 실제 테스트 → 스크린샷·버전·마커 채우기 → npm run check:content → 승인·발행
```

지원 글 형식: `how-to`(사용법) · `review`(리뷰) · `essay`(에세이) · `experience`(경험 기록) · `place-log`(여행·장소) · `book-memo`(책·콘텐츠 메모) · `photo-log`(사진 기록). `experience`·`place-log`·`book-memo`·`photo-log`는 `--notes` 원자료가 필수다 — 모델은 원자료에 없는 경험을 만들지 못한다 (`notes/README.md`).

## 1회 설정

### A. ChatGPT OAuth 모드 — Codex CLI (권장)

1. `npm install -g @openai/codex`
2. 터미널에서 `codex login` → 브라우저가 열리면 **ChatGPT 계정으로 로그인**
3. 끝. `npm run auto:write`가 codex 엔진으로 3단계를 자동 실행합니다.
   - 엔진은 Codex로 고정되어 있으며 OpenAI API 키를 읽거나 호출하지 않습니다.
   - 로그인 상태 확인: `codex login status`

### B. 수동 모드 — ChatGPT 붙여넣기

같은 대화에서 순서대로 붙여넣기: ① `.editorial/` 모듈+`BRAND.md`+`VOICE.md`+`content-writer-prompt.md` → ② `chatgpt-humanize-prompt.md` → ③ `chatgpt-review-prompt.md`.
통과본을 파일로 저장한 뒤 변환만 자동화: `npm run auto:write --from-final 검수통과본.md --topic 카테고리`

### C. 예약 발행 재빌드 (호스팅 연결 후)

`scheduled-publish.yml`이 15분마다 콘텐츠 계약과 빌드를 확인합니다. 정적 호스팅이
저장소 변경 없이 예약 글을 공개하려면 호스팅 Deploy Hook URL을 GitHub Secrets의
`DEPLOY_HOOK_URL`로 등록하세요. secret이 없으면 workflow는 빌드 검증만 수행합니다.

## 명령 레퍼런스

```bash
# 풀 자동 (주제 직접 지정) — ChatGPT OAuth Codex 세션 사용
npm run auto:write "주제" --topic 카테고리 --level 완전초보 --stage 정보 [--format how-to] [--persona wj-editor] [--slug my-slug]
npm run auto:write "주제" --topic 일상 --format experience --notes notes/memo.md   # 경험 계열은 원자료 필수
npm run auto:write "주제" --topic 카테고리 --best-of 2                            # 초안 2개 생성 후 기계 점수로 선택

# 기계 문장·구조 검사 단독 실행 (생성 없이 기존 글 측정)
npm run check:writing -- src/content/posts/excel-vlookup-other-sheet.md --format how-to

# 캘린더에서 다음 주제 자동 가져오기 (성공 시 해당 항목 [x] 표시)
npm run auto:write --calendar scripts/auto-publish/calendar.md

# 이미 쓴 초안에 윤문+검수만 적용
npm run auto:write --input 초안.md --topic 카테고리

# 생성 없이 변환만 (수동 ChatGPT 흐름 마무리)
npm run auto:write --from-final 검수통과본.md --topic 카테고리 --angle "관점"

# 프롬프트와 페르소나 계약 검사
npm run check:prompts

# 최근 초안과 평가 사례를 바탕으로 개선안만 생성 (저장소 파일은 자동 수정하지 않음)
npm run auto:improve -- --input src/content/posts/excel-vlookup-other-sheet.md

# 썸네일 이미지 (Codex OAuth + $imagegen)
npm run image -- --slug 글슬러그
npm run image -- --slug 글슬러그 --engine manual          # ChatGPT Images에서 생성 후
npm run image -- --slug 글슬러그 --attach "받은이미지.png"  # 받은 파일 등록 → frontmatter image 기록
```

- 주제 태그: 고정 목록이 없습니다. `topic`에 원하는 카테고리 이름을 사용합니다.
- 캘린더 형식: `- [ ] 주제 | 독자수준 | 사다리단계 | 주제태그`
- 중간 산출물(초안·윤문본·심사 리포트·기계 검사 JSON)은 `out/auto-publish/<실행시각>/`에 저장 (커밋되지 않음)
- 생성 실행마다 선택된 편집 시스템 버전·페르소나·모듈 해시를 `prompt-manifest.json`에 저장합니다.
- 최종 저장 조건은 **기계 검사 통과 + 독립 심사 90점 이상**입니다. 심사자는 글 작성 지시 없이 채점하므로 자기 선호 편향이 분리됩니다.
- 개선안은 `out/prompt-lab/<실행시각>/proposal.md`와 `proposal.diff`에 저장하며, 사람 승인 전에는 적용하지 않습니다.

## 이미지 규칙 (중요)

- **썸네일·커버·일러스트**만 AI 생성 대상입니다 (글 상단 3:2 비율, `image` frontmatter → OG 이미지까지 자동 반영).
- **본문 UI 스크린샷은 사람이 직접 촬영**합니다. AI 이미지로 가짜 스크린샷을 만들면
  E-E-A-T와 애드센스 신뢰성이 무너집니다 — `[스크린샷: ...]` 마커는 사람 촬영 슬롯입니다.

## 하드 룰 (파이프라인 어떤 단계보다 우선)

1. **게이트 미통과 글은 자동 저장되지 않습니다.** 기계 검사(check-writing) 실패 1건이라도 남으면, 또는 독립 심사가 90점 미만이면 저장이 거부됩니다.
2. **사람 승인 없는 발행 금지.** 무검토 대량 발행은 구글 규모화 콘텐츠 악용 정책에 걸려 애드센스 계정 자체를 위태롭게 합니다.
   로컬 Codex로 생성한 초안도 사람 검토·승인 후에만 발행합니다. GitHub Actions는 검사·빌드·배포 검증만 수행합니다.
3. **마커 보존·완결.** `[직접 확인 필요]`, `[테스트 필요]`, `[스크린샷: ...]` 마커를 사람이 모두 채운 뒤에만 발행합니다.
4. **YMYL 금지 주제**는 `BRAND.md`가 단일 근거이며, 캘린더 주제 선정부터 적용됩니다.
5. 검수 리포트에서 ChatGPT가 제시한 통계 중 **출처 없는 수치는 전부 삭제** 대상입니다.
6. 금융·투자, 의료·건강, 법률·분쟁, 피해·논란 주제가 감지되면 `manualReview: required`로 저장됩니다. 사람이 검토한 뒤 frontmatter를 `manualReview: approved`로 바꾸기 전에는 공개할 수 없습니다.

## 전체 문서

- 파이프라인 원문(단계별 상세·근거): `.planning/prompts/content-pipeline.md`
- 1단계 초안: `.planning/prompts/content-writer-prompt.md` · 2단계 윤문: `chatgpt-humanize-prompt.md` · 3단계 검수: `chatgpt-review-prompt.md`
- 고정 편집 헌법·문체·구조: `.editorial/constitution.md`, `.editorial/style-guide.md`, `.editorial/blueprints/`
- 페르소나·평가 사례·버전: `.editorial/manifest.json`, `scripts/auto-publish/persona/`, `.editorial/evals/`
