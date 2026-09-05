# 콘텐츠 파이프라인 원문 (canonical)

> 이 문서가 발행 흐름의 단일 근거(single source of truth)다. 개별 도구 문서와 충돌하면 이 문서가 우선한다.
> 최종 승인자: Human(wj941). 발행 리듬: **주 3~5개, 고정 발행 시간 + 시리즈 단위 기획** (2026-09 벤치마크 실측 반영 — 상한이지 하한이 아님, `BRAND.md` 참조).
> **실행: `npm run auto:write` 한 줄. 엔진은 ① Codex CLI(ChatGPT 구독 OAuth — 과금 없음) ② OpenAI API(키 과금) ③ ChatGPT 수동 중 자동 선택. Claude Code 불필요.**

## 전체 흐름

```
[1~3] 자동 실행 — npm run auto:write "주제" --topic ...
    1단계 초안: BRAND.md + VOICE.md + content-writer-prompt.md (1단계 프롬프트)
    2단계 윤문: chatgpt-humanize-prompt.md (★필수 — AI 티 제거, 구조·마커 보존)
    3단계 검수: chatgpt-review-prompt.md (★필수 — 100점 채점, 90점 미만이면 수정·재채점)
    ※ 엔진: --engine codex|api 또는 .env AUTO_ENGINE. 기본: API 키 있으면 api, 없으면 codex.
      codex = `codex login`(ChatGPT 계정 OAuth) 후 구독 사용량으로 실행. API 키가 없으면 수동 모드 안내 출력.
        │
        ▼
[4] 스키마 변환 — 자동 (같은 명령)
    status: draft / aiAssisted: true 강제 → src/content/posts/ 저장
    ★ 90점 게이트 미통과 시 저장 거부, 중간 산출물은 out/auto-publish/에 보존
        │
        ▼
[4.5] 썸네일 이미지 (선택) — npm run image -- --slug <슬러그>
    API 키 있으면 gpt-image-1로 자동 생성(장당 약 $0.02~0.07), 없으면 ChatGPT(구독)용
    프롬프트를 출력 → 생성 후 --attach로 등록하면 frontmatter image 필드 + OG 이미지 반영.
    ★ 본문 UI 스크린샷은 AI 이미지 금지 — 사람이 직접 촬영한다 (E-E-A-T 해자)
        │
        ▼
[5] 사람 검증 (자동화 불가 — 여기가 이 블로그의 해자)
    실제 테스트 → 스크린샷 촬영 → 마커 채우기 → testedAt·toolVersions 기입
    발행 전 체크리스트 (content-writer-prompt.md 하단) 통과
        │
        ▼
[6] 발행 게이트
    npm run check:content → 사람이 status 변경(draft → scheduled/published)
    → 예약 빌드·배포 (사람 승인 후에만 자동화 허용 — README 원칙)

[부가] 주간 자동 초안 — GitHub Actions (.github/workflows/auto-draft.yml)
    월·목 10:00 KST에 calendar.md의 다음 주제로 초안 생성 → PR 제안 (머지 = 사람 승인)
```

## 단계별 근거

- **[1]** 초안 품질의 절반은 컨텍스트 품질이다. BRAND.md(주제 범위·금지 주제)와 VOICE.md(문체·
  구조 계약)를 항상 함께 넣는다. ChatGPT Projects/Custom GPT를 쓴다면 이 두 파일을
  지식 또는 지시문으로 등록해 매번 붙여넣기를 생략한다.
- **[2] 왜 필수인가**: 한국어 AI 티(번역투·AI 관용구·기계적 병렬·hedging)는 애드센스
  "도움이 되는 콘텐츠" 평가와 사용자 신뢰의 직접 감점 요인. 1단계 프롬프트의 예방 규칙만으로
  40+ 패턴을 다 잡을 수 없어 탐지·교정 단계를 게이트로 둔다.
- **[3] 왜 채점 게이트인가**: "그럴듯함"을 점수로 강제로 끌어올린다. 치명적 결함(지어낸 수치,
  테스트한 척, YMYL, 구조 파괴)은 90점 이상 불가로 규정해 구조적으로 차단한다.
- **[4] 왜 변환기가 필요한가**: ChatGPT 출력은 우리 스키마(`src/content.config.ts`)와 다르다.
  변환기가 `status: draft`·`aiAssisted: true`를 강제해 무검토 발행을 구조적으로 막는다.
- **[5] 자동화하지 않는 이유**: 실제 테스트·스크린샷은 이 블로그의 차별화이자 애드센스 승인 전략.
- **[6] 사람 승인 유지 이유**: 무검토 대량 발행 = 구글 규모화 콘텐츠 악용 정책 위험 → 계정 단위 리스크.

## 파일 지도

| 파일 | 역할 | 단계 |
|---|---|---|
| `scripts/auto-publish/auto-write.mjs` | 자동화 코어 (1~4단계 한 줄 실행, codex/api 이중 엔진) | [1~4] |
| `scripts/auto-publish/generate-image.mjs` | 썸네일 이미지 생성·등록 (API 자동 / ChatGPT 수동) | [4.5] |
| `content-writer-prompt.md` | 1단계 초안 페르소나 프롬프트 | [1] |
| `chatgpt-humanize-prompt.md` | 2단계 윤문 프롬프트 (im-not-ai 규칙 이식) | [2] |
| `chatgpt-review-prompt.md` | 3단계 검수 프롬프트 (claude-blog 루브릭 이식) | [3] |
| 저장소 루트 `BRAND.md`, `VOICE.md` | 초안 시 항상 함께 제공하는 브랜드·문체 컨텍스트 | [1] |
| `scripts/auto-publish/convert-post.mjs` | 프론트매터 변환 + draft 저장 | [4] |
| `scripts/auto-publish/calendar.md` | 주간 자동 초안 대기열 | [부가] |
| `.github/workflows/auto-draft.yml` | 주 2회 자동 초안 → PR 제안 | [부가] |
| `scripts/auto-publish/README.md` | 설치·명령 레퍼런스 | 전체 |

`tools/im-not-ai`, `tools/claude-blog` 클론은 규칙을 추출한 **참고 자료**이며 실행 환경이 아니다.
(gitignore 대상 — 커밋되지 않음)
