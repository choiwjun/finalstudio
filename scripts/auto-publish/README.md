# 자동 글발행 파이프라인

관리자 대시보드(`/admin`, 개발 환경)의 **자동 글발행** 메뉴와 연결되는 파이프라인 설명서입니다.
Codex writer는 승인 artifact를 발급하는 `npm run keywords:draft`를 통해서만 실행됩니다. `auto:write`를 직접 호출하면 승인·해시·사람 작성 angle 게이트에서 거부됩니다.

```
npm run keywords:draft -- --brief <검토한-브리프.json> --brief-sha256 <SHA-256> \
  --approve --reviewer "검토자" --reason "검토 사유" --angle "사람이 승인한 글 방향"
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

## 키워드 브리프 연결

키워드 시스템에서 생성한 JSON 브리프는 사람이 Markdown을 검토한 뒤에만 기존 writer로 넘깁니다.

```bash
npm run keywords:draft -- \
  --brief out/keyword-briefs/<category>-<keyword>.json \
  --brief-sha256 "$(sha256sum out/keyword-briefs/<category>-<keyword>.json | cut -d' ' -f1)" \
  --approve --reviewer "검토자" --reason "근거와 글 방향 확인" \
  --angle "사람이 승인한 글 방향" [--format how-to]
```

이 명령은 검토한 JSON의 SHA-256과 사람이 직접 작성한 `--angle`을 확인한 뒤 브리프 Markdown을 writer에 전달합니다. NAVER/외부 원자료는 인용 데이터로 격리되며 그 안의 지시문은 실행하지 않습니다. 통과한 결과를 `src/content/posts/`에 `status: draft`로 저장합니다. 실패하거나 승인·사람 작성 angle이 없으면 writer를 호출하지 않습니다. `written` keyword record는 draft 경로와 writer handoff 결정을 기록합니다.

## 키워드 전체 자동 게시(명시적 자동화 정책)

사람이 키워드마다 승인 필드를 반복하지 않고 전체 후보를 처리하려면 다음 명령을 사용합니다.

```bash
npm run keywords:auto-publish -- --dry-run
npm run keywords:auto-publish -- --publish
```

`--dry-run`은 전체 ready 후보를 대상으로 글·이미지·게시 계획만 만듭니다. `--publish`는 버전 관리된 `scripts/keyword-system/automation-policy.json`을 확인한 뒤 모든 후보에 대해 글을 생성하고, 메인 이미지 1장과 서브 이미지 2~3장을 생성·삽입합니다. 글·이미지·콘텐츠 계약을 모두 통과한 번들만 published로 전환하고 생성 파일만 커밋·push한 다음 `DEPLOY_HOOK_URL`을 호출합니다. 금융·건강·법률 등 위험 글이나 검사 실패 글은 자동 게시하지 않습니다.

## 1회 설정

### A. ChatGPT OAuth 모드 — Codex CLI (권장)

1. `npm install -g @openai/codex`
2. 터미널에서 `codex login` → 브라우저가 열리면 **ChatGPT 계정으로 로그인**
3. 끝. 사람이 승인한 `npm run keywords:draft`가 codex 엔진으로 3단계를 실행합니다.
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
# Codex writer는 승인된 `npm run keywords:draft` 브리지에서만 호출
# `npm run auto:write` 직접 호출은 승인 artifact가 없어 거부됨

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
2. **기본 writer 경로는 사람 승인 없이 발행하지 않습니다.** `keywords:draft`는 사람 승인 게이트를 유지합니다. 전체 자동 게시가 필요한 운영자는 버전 관리된 `automation-policy.json`과 명시적인 `keywords:auto-publish --publish` 명령을 사용하며, 품질검사·이미지 완성·위험 주제 차단을 모두 통과한 경우에만 게시합니다.
3. **마커 보존·완결.** `[직접 확인 필요]`, `[테스트 필요]`, `[스크린샷: ...]` 마커를 사람이 모두 채운 뒤에만 발행합니다.
4. **YMYL 금지 주제**는 `BRAND.md`가 단일 근거이며, 캘린더 주제 선정부터 적용됩니다.
5. 검수 리포트에서 ChatGPT가 제시한 통계 중 **출처 없는 수치는 전부 삭제** 대상입니다.
6. 금융·투자, 의료·건강, 법률·분쟁, 피해·논란 주제가 감지되면 `manualReview: required`로 저장됩니다. 사람이 검토한 뒤 frontmatter를 `manualReview: approved`로 바꾸기 전에는 공개할 수 없습니다.

## 전체 문서

- 파이프라인 원문(단계별 상세·근거): `.planning/prompts/content-pipeline.md`
- 1단계 초안: `.planning/prompts/content-writer-prompt.md` · 2단계 윤문: `chatgpt-humanize-prompt.md` · 3단계 검수: `chatgpt-review-prompt.md`
- 고정 편집 헌법·문체·구조: `.editorial/constitution.md`, `.editorial/style-guide.md`, `.editorial/blueprints/`
- 페르소나·평가 사례·버전: `.editorial/manifest.json`, `scripts/auto-publish/persona/`, `.editorial/evals/`

## 완성 글 기반 이미지 번들 / 기존 초안 보강

`keywords:draft`와 `auto:write`는 **텍스트 초안**입니다. 단독 `image` 명령도 커버만 다루며 완성 번들을 증명하지 않습니다. 정상 신규 글 경로는 `npm run keywords:auto-publish` (발행 플래그 없음)입니다. 글 작성 전에 시작한 하나의 900초 예산 안에서 저장된 본문 스냅샷, 근거 notes, 메인 1장 + 기본 서브 2장(정책으로 3장), 기계 검사, 독립 90점 심사, 설치를 마칩니다. 첫 실패에서 중단하며, 비발행 모드는 Git을 되돌리지 않고 저장된 텍스트 초안과 keyword handoff를 검토용으로 남깁니다. POSIX 프로세스 그룹 취소가 필요하며 현재 Windows 직접 실행은 fail-closed입니다.

기존 초안은 별도 redraft/키워드 전이 없이 아래 경로만 사용합니다. **현재 복구 개발 단계에서는 실제 실행/생성 금지**이며 아래 설치 명령은 별도의 명시적 운영 승인 후에만 사용합니다.

```sh
# 승인자가 직접 준비한 목록으로 읽기 전용 계획/해시/기계 검사
node scripts/keyword-system/image-backfill.mjs --approved out/keyword-recovery/approved-images.json --dry-run
# 아래 명령은 이 개발 작업에서 실행하지 않음: 승인된 실제 생성/설치
node scripts/keyword-system/image-backfill.mjs --approved out/keyword-recovery/approved-images.json
# 서브 3장을 명시하려면 두 명령 모두 --sub-count 3 사용
```

목록은 `{ "posts": [{ "path": "src/content/posts/slug.md", "sha256": "원본64자리SHA256", "notesPath": "out/keyword-briefs/원자료.md", "notesSha256": "원자료64자리SHA256", "format": "how-to" }] }` 형식입니다. 경로/해시는 승인자가 실제 파일에서 확인해야 하며 예시 값을 사용하면 거부됩니다. 1~15개 명시적 초안만 허용합니다. notes 경로와 해시는 함께 제공해야 합니다. `out/keyword-briefs` 또는 `out/keyword-recovery`의 검증된 일반 파일만 읽으며, JSON 브리프는 기존 canonical normalize/render 계약을 재사용합니다. 동일한 스냅샷 notes가 기계 검사와 독립 심사에 전달됩니다. notes가 없으면 실제 검사를 그대로 수행하며 실패를 면제하지 않습니다.

본문 중앙 논지와 서로 다른 섹션 원문/오프셋/앵커가 `out/image-bundles/<slug>/plan.json`에 보존됩니다. 설치 PNG는 실제 디코딩, 20MB/40MP 이하, 각 변 16~8192 픽셀 검사를 통과해야 합니다. 삽입은 AI 일러스트임을 명시하며 실제 UI 스크린샷을 만들었다고 주장하지 않습니다. 누락된 screenshot/placeholder 임베드는 원문 문법·설명을 provenance에 남기고 독자에게 보이는 실제 화면 확인 의무로 바꿉니다. 코드 예제와 확인 마커는 삭제하지 않습니다.

명백한 **말미의 구조화된 윤문 리포트**만 공통 `scripts/lib/generated-report.mjs` 계약으로 분리합니다. 경계·필드·변경 건수·자체검증 구조가 정확해야 하며 모호하거나 검증 마커가 들어 있으면 중단합니다. 원문/위치/원본 및 후보 해시를 보존하고, 일반 본문·백분율·코드 예제는 그대로 둡니다. 작성 경로는 raw humanizer 출력과 별도 report JSON을 저장하고, 이미지 경로는 immutable source/plan에 보관합니다. **두 실제 품질 게이트 전에** 분리하며 리포트를 근거 notes에 섞지 않습니다. 기존 실패 리포트/92점 중간 심사는 소급해서 통과가 되지 않습니다.

최종 후보 해시·기계 결과·독립 원문 심사는 `quality.json`, `judge.md`에 기록됩니다. 실패 기록과 직전 시도 산출물은 `history/`에 보존합니다. `transaction.json`은 독점 잠금, 소유 자산, 원본/최종 해시를 결합합니다. 정상 재실행은 검증된 완료 번들만 무생성 no-op입니다. 준비 중 충돌 없는 실패는 소유 파일만 복구하지만 외부 수정·불명확한 crash 상태는 자동 덮어쓰기 없이 수동 검토를 요구합니다. 출판/DB sync/Git staging/커밋/배포는 backfill에 없습니다. 이미지 생성 성공도 사람의 시각·문구·출판 검토를 대체하지 않습니다.
