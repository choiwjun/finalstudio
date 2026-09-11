# 키워드 기반 콘텐츠 파이프라인

- 상태: 진행 중인 기준 문서
- 대상: WJ Blog
- 최종 갱신: 2026-09-11

## 1. 확정 방향

블로그의 키워드 축은 다음 세 가지다.

| 카테고리 | 저장용 slug | 운영 원칙 |
| --- | --- | --- |
| 경제·비즈니스 | `economy-business` | 공식 통계·공식 문서·기준일을 우선한다. |
| AI | `ai` | 모델·기능·버전·기준일과 실제 확인 범위를 기록한다. |
| 여행 | `travel` | 일정·비용·교통·현장 조건을 확인한 범위만 쓴다. |

세부 키워드는 사용자가 확정한 목록을 canonical seed로 등록한다. 이 문서에 목록이 등록되기 전에는 fixture의 예시 키워드나 이전 프로젝트의 키워드를 실제 선정 키워드로 간주하지 않는다.

## 2. 콘텐츠 생성 흐름

```text
사용자 확정 카테고리·세부 키워드
  -> seed 등록
  -> 공식 NAVER API HUB 수집
  -> raw evidence와 evidence index 저장
  -> 정한 키워드와 수집 근거의 일치·최신성·위험도 분석
  -> 카테고리별 글 브리프 생성
  -> 사람 검토·작성 승인
  -> 기존 초안 생성기에 브리프 전달
  -> draft 저장
  -> 별도 사람 발행 승인
```

NAVER 수집 데이터는 키워드 자체를 대신하지 않는다. 수집 결과는 정한 키워드의 검색 맥락, 관련 표현, trend 상대 지표, 블로그 결과를 보강하는 근거로만 사용한다. trend `ratio`는 절대 검색량으로 표현하지 않는다.

## 3. 데이터와 경계

- 입력: `data/keywords/seeds.json`
- raw evidence: `data/keywords/raw/`
- evidence index: `data/keywords/evidence-index.jsonl`
- collection manifest: `data/keywords/collection.json`
- canonical records: `data/keywords/records.json`
- 사람 승인 대기: `data/keywords/ready-to-write.json`
- 사람 결정 로그: `data/keywords/decisions.jsonl`
- raw evidence에는 API key, secret, request header, 인증 정보가 들어가면 안 된다.
- fixture와 `--dry-run`은 provider/network를 호출하지 않는다.
- `ready-to-write`는 글 작성 승인 대기 상태이며 자동 작성·예약·발행을 의미하지 않는다.
- `written` 전환은 사람의 writer handoff reference와 reason이 저장된 뒤에만 가능하다.
- 정적 사이트 build에는 `data/keywords`와 내부 keyword-system 산출물이 포함되면 안 된다.

## 4. 현재 구현 상태

### 완료

- NAVER API HUB 공식 provider와 fixture transport
- seed discovery, raw evidence, evidence index, collection manifest
- deterministic analysis와 record transition
- records/decision rollback 및 path/symlink/TOCTOU 방어
- `ready-to-write` 수동 handoff gate
- `npm run test:keywords`
- `npm run keywords:brief`로 ready record와 같은 키워드의 raw evidence를 결합한 결정론적 사람 검토용 브리프 생성
- CI에서 keyword regression test, content/prompt/build boundary 검사

### 다음 구현

- 이 문서의 세부 키워드 목록을 `data/keywords/seeds.json`에 반영
- 검토 승인된 브리프를 기존 `scripts/auto-publish/auto-write.mjs`의 승인된 입력으로 전달
- 생성 결과를 `draft`로 저장하고 keyword record와 slug·초안 경로를 연결
- 실제 NAVER 수집과 사람 승인 후에만 위 흐름을 실행

## 5. 운영 승인 게이트

1. 세부 키워드 목록을 사람이 확정한다.
2. API credentials는 로컬 환경에만 설정한다.
3. evidence가 없거나 malformed·실패·위험 상태면 ready 승격하지 않는다.
4. 글 브리프를 사람이 검토한다.
5. 초안 생성은 사람의 명시적 실행으로만 시작한다.
6. 생성 성공 후에도 글 상태는 `draft`로 유지한다.
7. 공개 발행과 예약 배포는 별도의 사람 승인을 받는다.

## 6. 금지 사항

- fixture 샘플을 실제 사용자 선정 키워드로 승격하지 않는다.
- 사용자가 정하지 않은 키워드를 임의로 추가하지 않는다.
- NAVER API evidence만으로 검색량·수익성·인기도를 확정하지 않는다.
- 자동 writer, calendar, publish를 keyword collection 단계에서 호출하지 않는다.
- API secret을 채팅·문서·로그·커밋에 기록하지 않는다.
