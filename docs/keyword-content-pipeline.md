# 키워드 기반 콘텐츠 파이프라인

- 상태: 진행 중인 기준 문서
- 대상: WJ Blog
- 최종 갱신: 2026-09-11

## 1. 확정 방향

블로그 발행 후보는 다음 세 카테고리에서 NAVER API HUB 수집 결과로 자동 발견한다.

| 카테고리 | 저장용 slug | 최초 NAVER 조사어 | 운영 원칙 |
| --- | --- | --- | --- |
| 경제·비즈니스 | `economy-business` | `경제 비즈니스` | 공식 통계·공식 문서·기준일을 우선한다. |
| AI | `ai` | `AI 인공지능` | 모델·기능·버전·기준일과 실제 확인 범위를 기록한다. |
| 여행 | `travel` | `여행` | 일정·비용·교통·현장 조건을 확인한 범위만 쓴다. |

사용자가 매번 세부 키워드를 입력하는 방식이 아니다. 시스템이 공식 NAVER 블로그 검색 결과의 제목에서 후보 표현을 결정론적으로 추출하고, 블로그·trend 근거를 다시 수집해 검증한다. 자동 추출 순위는 내부 후보 순위일 뿐 검색량·인기도·수익성을 의미하지 않는다.

NAVER 공식 문서에는 별도의 키워드 추천 API가 없으므로, [블로그 검색 API](https://developers.naver.com/docs/serviceapi/search/blog/blog.md)로 후보를 발견하고 [통합검색어 트렌드 API](https://developers.naver.com/docs/serviceapi/datalab/search/search.md)로 상대 추이를 비교한다.

## 2. 콘텐츠 생성 흐름

```text
고정 카테고리 조사어
  -> NAVER 블로그 검색으로 주제 후보 자동 추출
  -> 후보별 공식 NAVER blog + trend 근거 재수집
  -> raw evidence와 evidence index 저장
  -> 후보와 수집 근거의 일치·최신성·위험도 분석
  -> 카테고리별 글 브리프(Markdown + JSON) 생성
  -> wj-editor 페르소나 배치가 카테고리별 후보·작성 방향·검토 사유를 결정
  -> 승인 메타데이터가 붙은 JSON 브리프를 기존 초안 생성기에 전달
  -> 글마다 메인 이미지 1장 + 본문 이미지 1~2장 생성·삽입
  -> 기계 검사·독립 심사·이미지 완성 검사
  -> 전체 번들 검증 통과 시 자동 게시
```

NAVER 수집 데이터는 키워드 자체를 대신하지 않는다. 수집 결과는 정한 키워드의 검색 맥락, 관련 표현, trend 상대 지표, 블로그 결과를 보강하는 근거로만 사용한다. trend `ratio`는 절대 검색량으로 표현하지 않는다.

## 3. 데이터와 경계

- 자동 조사 실행: `npm run keywords:auto`
- 자동 생성 입력: `data/keywords/automatic-seeds.json`
- 자동 발견 manifest: `data/keywords/automatic-discovery.json`
- legacy/test 입력: `data/keywords/seeds.json`
- raw evidence: `data/keywords/raw/`
- evidence index: `data/keywords/evidence-index.jsonl`
- collection manifest: `data/keywords/collection.json`
- canonical records: `data/keywords/records.json`
- 작성·이미지·게시 대기: `data/keywords/ready-to-write.json`
- 사람 결정 로그: `data/keywords/decisions.jsonl`
- raw evidence에는 API key, secret, request header, 인증 정보가 들어가면 안 된다.
- fixture와 `--dry-run`은 provider/network를 호출하지 않는다.
- `ready-to-write`는 글 작성 승인 대기 상태이며 자동 작성·예약·발행을 의미하지 않는다.
- `written` 전환은 사람의 writer handoff reference와 reason이 저장된 뒤에만 가능하다.
- 정적 사이트 build에는 `data/keywords`와 내부 keyword-system 산출물이 포함되면 안 된다.

## 4. 현재 구현 상태

### 완료

- NAVER API HUB 공식 provider와 fixture transport
- seed discovery(legacy/test), raw evidence, evidence index, collection manifest
- NAVER blog 결과 기반 자동 주제 후보 추출과 category-scoped evidence path
- deterministic analysis와 record transition
- records/decision rollback 및 path/symlink/TOCTOU 방어
- `ready-to-write` 수동 handoff gate
- `npm run test:keywords`
- `npm run keywords:brief`로 ready record와 같은 키워드의 raw evidence를 결합한 결정론적 사람 검토용 브리프 생성
- `npm run keywords:draft`의 명시적 `--approve`·검토자·사유 게이트와 기존 auto-write 연결
- `npm run keywords:batch-draft -- --dry-run`으로 전체 ready 후보의 배치 계획을 생성
- `npm run keywords:auto-publish -- --dry-run`으로 전체 후보의 글·이미지·게시 계획을 검증
- `npm run keywords:auto-publish -- --publish`가 전체 후보를 순차 처리하고 글마다 메인 1장·서브 1~2장을 생성
- 글·이미지·콘텐츠 검사가 모두 통과한 번들만 `published`로 전환하고 Git push와 Deploy Hook을 실행
- 금융·건강·법률 등 위험 글은 자동 게시하지 않고 차단 목록에 기록
- CI에서 keyword regression test, content/prompt/build boundary 검사

### 운영 전제

- 실제 NAVER 수집 credentials를 로컬에 설정하고 `npm run keywords:auto` 실행
- `npm run keywords:auto-publish -- --dry-run` 결과를 먼저 확인
- 실제 자동 게시에는 Codex 로그인, Git push 권한, `DEPLOY_HOOK_URL`이 필요
- `--publish` 실행 전 저장소 worktree와 index가 모두 clean이어야 하며, 변경된 정책 파일의 SHA-256이 writer decision과 게시 manifest에 고정된다.
- 후보·이미지·콘텐츠 검사 중 하나라도 실패하면 생성된 데이터·글·이미지를 rollback하고 게시하지 않는다. 이미 commit/push가 끝난 뒤 Deploy Hook만 실패한 경우에는 manifest에 `deploy-hook-failed`를 남긴다.
- NAVER API HUB의 전용 키워드 추천 API가 없으므로 blog 결과 추출 + trend 비교 방식으로 운영

## 5. 운영 승인 게이트

1. 시스템이 고정 카테고리에서 NAVER 후보 주제를 자동 추출한다.
2. API credentials는 로컬 환경에만 설정한다.
3. evidence가 없거나 malformed·실패·위험 상태면 ready 승격하지 않는다.
4. 자동화 정책 파일 `scripts/keyword-system/automation-policy.json`이 writer·이미지·게시 범위를 선언한다.
5. `keywords:auto-publish --dry-run`은 writer·이미지 생성·게시를 호출하지 않고 전체 계획만 기록한다.
6. `keywords:auto-publish --publish`는 모든 후보를 처리하되 글·이미지·콘텐츠 검사 중 하나라도 실패하면 해당 배치를 게시하지 않는다.
7. 금융·건강·법률 등 위험 글, 미해결 마커, 분량 부족, 이미지 누락 글은 자동 게시하지 않는다.
8. 게시 성공 시 생성 파일만 커밋·push하고 `DEPLOY_HOOK_URL`을 호출한다. 게시 manifest에는 policy path, id, SHA-256과 commit/deploy 상태를 남긴다.

## 6. 금지 사항

- fixture 샘플을 실제 NAVER 자동 발견 결과로 간주하지 않는다.
- 고정 카테고리 밖의 후보를 자동으로 추가하지 않는다.
- NAVER API evidence만으로 검색량·수익성·인기도를 확정하지 않는다.
- keyword collection 단계에서는 writer·이미지·publish를 호출하지 않는다. 자동 게시가 필요하면 별도의 `keywords:auto-publish` 명령을 명시적으로 실행한다.
- API secret을 채팅·문서·로그·커밋에 기록하지 않는다.
