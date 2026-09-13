# AutoStudio 네이버 키워드 수집 기능 재사용 조사

- 조사일: 2026-09-08
- 대상 저장소: <https://github.com/choiwjun/autostudio>
- 조사 기준 커밋: [`d3659c77828e0c5e1083f0dc17e6da01ab9f393a`](https://github.com/choiwjun/autostudio/commit/d3659c77828e0c5e1083f0dc17e6da01ab9f393a) (`main`, 2026-08-18)
- 조사 범위: README, 설정, 수집·인증·네이버 호출·분석·저장·출력 코드, 실행 워크플로, 테스트/설계 문서, 네이버 공식 문서
- 방법: GitHub raw/API와 네이버 개발자 센터 공식 문서를 읽었다. 코드는 실행하지 않았고 네이버 계정·API 키·외부 계정에 접근하지 않았다.

## 결론

**일부 재사용은 가능하지만, AutoStudio 전체를 WJ Blog의 키워드 시스템으로 가져오는 것은 권장하지 않는다.**

1. `naver_client.py`의 네이버 **공식 검색 API 호출 방식**은 별도 어댑터로 재사용할 수 있다. 블로그·뉴스 검색 결과와 검색 결과 수, 게시일, 제목·설명·링크를 WJ Blog의 근거 자료로 변환할 수 있다.
2. `datalab.py`와 `shopping_insight.py`의 **공식 DataLab API 호출·상대 지수 계산**도 선택적으로 재사용할 수 있다. 다만 DataLab의 `ratio`는 절대 검색량이 아니라 요청 결과 안에서 정규화된 상대값이다.
3. `autocomplete.py`의 `https://ac.search.naver.com/nx/ac` BFS 호출은 코드가 사용하는 **비공식·문서화되지 않은 엔드포인트**다. 공식 Open API 목록과 공식 검색 API 문서에서 이 엔드포인트의 계약·허용 범위를 확인하지 못했다. WJ Blog의 기본 수집기로 복사하지 않는 것이 안전하다.
4. AutoStudio의 DB·수집 오케스트레이터·대시보드까지 복사하면 WJ Blog의 미확정 레코드 계약과 충돌한다. WJ Blog가 요구하는 `head_keyword`, `related_keywords`, `search_intent`, `content_angle`, `source`, `collected_at`, `freshness`, `risk_flags`, `evidence_available`, `status`를 AutoStudio의 키워드 테이블이 직접 제공하지 않는다.

따라서 현재 판단은 **“공식 API 클라이언트와 분석 아이디어만 조건부 재사용, 비공식 자동완성 크롤러와 전체 저장/배치 시스템은 재사용하지 않음”**이다.

## 1. AutoStudio의 실제 실행 흐름

### 1.1 실행 진입점

README의 로컬 실행 예시는 다음과 같다.

```text
python -m venv .venv
.venv\\Scripts\\pip install -r requirements-dev.txt
.venv\\Scripts\\python -m uvicorn server:app --port 8000
.venv\\Scripts\\python collect.py
python -m pytest tests -q
```

근거: [`README.md`](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/README.md#L58-L69), [`requirements.txt`](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/requirements.txt).

GitHub Actions는 [`daily-collect.yml`](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/.github/workflows/daily-collect.yml#L1-L36)에서 매일 `22:17 UTC`(주석상 07:17 KST)에 Python 3.11로 `python collect.py`를 실행한다. `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `DATABASE_URL` 등을 GitHub Secrets에서 주입한다. 잡 제한 시간은 60분이다.

### 1.2 수집 파이프라인

[`collect.py`](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/collect.py#L89-L211)의 `run_collection()`과 관련 함수 기준 흐름은 다음과 같다.

```text
seed_keywords 조회
  → seed가 없으면 DEFAULT_FOCUS_SEEDS 자동 삽입
  → 네이버 자동완성 BFS 확장
  → refine.py 정제/블랙리스트/길이 필터
  → keywords upsert
  → 오래된 활성 키워드부터 네이버 블로그·뉴스 스냅샷
  → daily_stats·top_results 저장
  → (schedule일 때) DataLab 검색 트렌드
  → (schedule일 때) Shopping Insight 클릭 트렌드
  → 은퇴 판정·보존 정리
  → (설정 시) 초안·이미지 배치
```

- 발굴은 `AUTOCOMPLETE_MAX_DEPTH` 기본 2, `AUTOCOMPLETE_MAX_REQUESTS` 기본 300, 활성 키워드 상한 기본 500이다. 수동 실행은 별도 신규 수와 요청 상한을 둔다. 근거: [`config.py`](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/config.py#L130-L171), [`collect.py`](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/collect.py#L99-L171).
- 검색 스냅샷은 활성 키워드 중 마지막 수집일이 오래된 순서로 처리된다. 당일 수집은 건너뛴다. 근거: [`collect.py`](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/collect.py#L175-L211), [`db.py`](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/db.py#L878-L887).
- 예약 수집은 스냅샷 뒤에 DataLab·쇼핑인사이트·은퇴·보존을 수행한다. 초안/이미지 배치는 예산 없는 schedule 실행에서만 시도된다. 근거: [`collect.py`](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/collect.py#L566-L665).

### 1.3 키워드 분석

[`analyzer.py`](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/analyzer.py#L37-L101)의 `analyze_keyword()`는 키워드마다 다음 호출을 한다.

- 블로그 `sort=sim`, `display=20`
- 블로그 `sort=date`, `display=100`
- 뉴스 `sort=date`, `display=20`

응답에서 `total_sim`, `total_date`, 최근 게시물 비율(`fresh_ratio`), 상위 블로거 중복, 상위 설명문을 계산한다. 제목·설명·게시일·링크를 최대 12개까지 정리한 `search_evidence`도 메모리상 생성한다.

`collect.py`의 일반 스냅샷 경로는 숫자 요약과 상위 게시일을 저장한다. `search_evidence` 전체는 일반 `daily_stats` 열에 저장되지 않는다. 콘텐츠 배치가 실행될 때만 [`content_batch.py`](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/content_batch.py#L132-L150)가 이를 `outlines.structure` JSON에 넣어 초안 프롬프트에 전달한다.

## 2. 네이버 API·인증·정책 의존성

### 2.1 공식 검색 API

공식 문서:

- [네이버 검색 API 공통/블로그 검색 문서](https://developers.naver.com/docs/serviceapi/search/blog/blog.md)
- [네이버 검색 API 쇼핑 문서](https://developers.naver.com/docs/serviceapi/search/shopping/shopping.md)
- [네이버 검색 API 뉴스 문서](https://developers.naver.com/docs/serviceapi/search/news/news.md)
- [네이버 Open API 종류·인증 안내](https://developers.naver.com/docs/common/openapiguide/apilist.md)

공식 문서에서 확인한 사항:

- 블로그·뉴스·쇼핑 검색은 네이버 검색 API의 비로그인 방식 Open API다.
- 네이버 개발자 센터에서 애플리케이션을 등록하고 `X-Naver-Client-Id`, `X-Naver-Client-Secret` 헤더를 보내야 한다.
- 검색 API의 하루 호출 한도는 공식 블로그/쇼핑 문서에 **25,000회**로 표시된다. 실제 애플리케이션의 설정·정책 변경 여부는 사용 전 개발자 센터에서 다시 확인해야 한다.
- 블로그 검색은 `query`, `display`(최대 100), `start`(최대 1000), `sort=sim|date`를 지원한다. AutoStudio의 `search_blog()` 호출은 이 범위 안에 있다.
- 공식 문서는 애플리케이션에서 검색 API가 활성화되지 않은 경우 403(권한 없음)이 날 수 있다고 설명한다.

AutoStudio의 [`naver_client.py`](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/naver_client.py#L1-L68)는 공식 `https://openapi.naver.com/v1/search` 경로를 사용하고, 위 두 헤더를 붙인다. 429·500·502·503·504와 네트워크 오류를 최대 3회 지수 백오프로 재시도하고, 오류 JSON을 `NaverAPIError`로 정규화한다.

### 2.2 DataLab 검색어 트렌드

공식 문서: [통합 검색어 트렌드 API](https://developers.naver.com/docs/serviceapi/datalab/search/search.md)

확인한 사항:

- `POST https://openapi.naver.com/v1/datalab/search`를 사용한다.
- 같은 Client ID/Secret 헤더가 필요하다.
- 하루 호출 한도는 **1,000회**로 문서에 표시된다.
- 요청은 최대 5개 그룹, 그룹마다 최대 20개 키워드를 받을 수 있다. AutoStudio는 앵커 1개와 후보 최대 4개를 한 요청에 넣는다.
- 응답 `ratio`는 해당 응답의 기간에서 가장 큰 값이 100이 되도록 만든 상대값이다. 절대 검색량으로 해석하면 안 된다.

AutoStudio의 [`datalab.py`](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/datalab.py#L1-L88)는 30일 일간 시계열을 받아 앵커 평균으로 정규화하고 최근 7일과 이전 기간의 성장률을 계산한다. WJ Blog에서 재사용한다면 `demand_idx`가 “검색량”이 아니라 “앵커 대비 상대 추이”라는 설명을 반드시 유지해야 한다.

### 2.3 Shopping Insight

공식 문서: [쇼핑인사이트 API](https://developers.naver.com/docs/serviceapi/datalab/shopping/shopping.md)

확인한 사항:

- `POST https://openapi.naver.com/v1/datalab/shopping/category/keywords` 등 DataLab 쇼핑인사이트 API를 사용한다.
- Client ID/Secret 헤더가 필요하다.
- 하루 호출 한도는 **1,000회**로 문서에 표시된다.
- 네이버 통합검색 쇼핑 영역과 네이버쇼핑의 검색 클릭 추이를 제공한다.
- `ratio` 역시 요청 기간 내 최대값을 100으로 만든 상대 클릭 지수이며, 절대 클릭 수가 아니다.

AutoStudio는 키워드와 쇼핑 카테고리 코드를 묶어 앵커 대비 클릭 지수를 계산한다. 이 값은 WJ Blog의 필수 키워드 레코드가 아니며, 상업성 분석을 선택할 경우에만 추가하는 편이 적절하다.

### 2.4 자동완성 엔드포인트

코드상 [`autocomplete.py`](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/autocomplete.py#L1-L116)는 다음 URL로 GET 요청을 한다.

```text
https://ac.search.naver.com/nx/ac?q=...&q_enc=utf-8&st=100
```

헤더는 `Referer: https://www.naver.com/`이며 Client ID/Secret 인증은 없다. 응답이 리스트 또는 딕셔너리라고 가정해 제안어를 파싱하고 BFS로 확장한다.

**확인된 사실:** 이 URL과 자동완성 응답 형식은 AutoStudio 소스에 있다.

**확인하지 못한 사실:** 네이버 개발자 센터의 [공식 Open API 목록](https://developers.naver.com/docs/common/openapiguide/apilist.md), 검색 API 문서, DataLab 문서에서 이 엔드포인트의 공식 API 계약·호출 한도·상업적 자동 수집 허용 범위를 확인하지 못했다. 그러므로 이를 “네이버 공식 키워드 API”라고 부르면 안 된다. 서비스 변경, 차단, 이용약관·로봇 정책·접근 제한 위험이 남는다.

## 3. 저장 형식과 출력

### 3.1 저장소

AutoStudio의 [`db.py`](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/db.py#L19-L167)는 URL 스킴에 따라 SQLite 또는 Postgres를 선택한다. 핵심 테이블은 다음과 같다.

| 테이블 | 확인된 주요 필드 | 역할 |
| --- | --- | --- |
| `seed_keywords` | `keyword`, `category` | BFS 시작점 |
| `keywords` | `keyword`, `category`, `first_seen`, `active`, `performance_boost`, `inflow_score` | 활성 키워드와 운영 상태 |
| `daily_stats` | `day`, `total_sim`, `total_date`, `fresh_ratio`, `growth`, `opportunity`, `commercial`, `demand_idx`, `shop_click_idx`, `ai_cite_idx`, `demand_growth` | 날짜별 수치 스냅샷 |
| `top_results` | `day`, `post_date` | 상위 블로그 게시일 |
| `collection_log` | `run_at`, `keyword`, `action`, `note` | 발굴·필터·오류 로그 |
| `collection_runs` | `started_at`, `finished_at`, `status`, `new_keywords`, `snapshotted`, `errors`, `note` | 실행 결과·잠금 |
| `outlines` | `day`, `structure` JSON, `source` | 상위글 골격과 검색 근거(콘텐츠 배치 시) |

스키마 근거: [`db.py` SQLite 스키마](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/db.py#L21-L129), [`db.py` 저장 메서드](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/db.py#L828-L857), [`db.py` 스냅샷 메서드](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/db.py#L933-L954).

**중요한 저장 한계:** `keywords` 자체에는 원래 키워드의 제공처(`source`), 관련 키워드 그룹, 검색 의도, 글감 각도가 없다. `first_seen`은 발견일에 가깝지만 `collected_at`과 같은 의미로 문서화되어 있지 않다. 자동완성 제안어의 원문 응답도 별도 원자료 테이블에 보존하지 않고, 로그와 정제 후 키워드만 남긴다.

### 3.2 API/대시보드 출력

FastAPI 서버는 운영 환경에서 읽기 API에도 `DASHBOARD_TOKEN`을 요구한다. 주요 엔드포인트는 다음과 같다.

- `GET /keywords`: 정렬·카테고리·검색어·프리셋·페이지 필터와 함께 `items`, `count`, `page`, `page_size`, `thresholds`, `threshold_source`를 반환한다.
- `GET /keywords/{id}`: 키워드와 history를 반환한다.
- `GET /seeds`: 시드 목록을 반환한다.
- `POST /collect`: 수동 또는 예산 제한 schedule 수집을 시작한다.

근거: [`server.py`](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/server.py#L490-L597).

CSV/JSON 파일을 WJ Blog에 바로 넣는 공식 export 계약은 확인하지 못했다. `/keywords` JSON을 읽어 별도 매핑하는 어댑터가 필요하다.

## 4. WJ Blog 계약과의 차이

WJ Blog 최신 [`HANDOFF.md`](../../HANDOFF.md#남은-작업-핸드오프--키워드-시스템승인-후-자동-배포첫-발행-검증)은 자동 수집기와 작성 대기열 연동이 아직 미구현이라고 명시한다. 입력 제공처와 저장 위치도 미확정이며, 키워드 레코드 계약은 다음과 같다.

```text
category, head_keyword, related_keywords, search_intent, content_angle,
source, collected_at, freshness, risk_flags, evidence_available, status
```

`status`는 `candidate`, `researching`, `ready-to-write`, `written`, `rejected`다. 각 글은 대표 키워드 1개와 관련 키워드 2~5개를 가져야 한다.

AutoStudio와의 직접 대응은 다음과 같다.

| WJ Blog 필드 | AutoStudio에서 얻을 수 있는가 | 판단 |
| --- | --- | --- |
| `category` | `keywords.category` | 직접 매핑 가능하나 AutoStudio 기본 분류와 WJ 범위를 다시 정해야 함 |
| `head_keyword` | `keywords.keyword` | 직접 매핑 가능 |
| `related_keywords` | 자동완성 BFS의 같은 seed 유래 정보가 메모리상 존재 | DB에 그룹으로 보존되지 않아 별도 추적/그룹화 필요 |
| `search_intent` | 직접 저장하지 않음 | 제목·설명문 분류 또는 사람이 결정해야 함 |
| `content_angle` | 직접 저장하지 않음 | WJ 편집 브리프에서 결정해야 함 |
| `source` | `outlines.source`는 `naver_blog_search`뿐 | 키워드 발굴 출처와 검색 결과 출처를 분리해 새 필드 필요 |
| `collected_at` | 로그·`first_seen` 날짜는 있음 | 명시적 수집 시각과 timezone으로 새로 기록해야 함 |
| `freshness` | `fresh_ratio`·게시일로 계산 가능 | WJ 정의와 계산식 합의 필요 |
| `risk_flags` | `refine.py`의 일부 금칙 사유만 있음 | 경제·건강·금융 위험 검토와 동일하지 않음 |
| `evidence_available` | `search_evidence`가 콘텐츠 배치 시 생성됨 | 증거 상태·URL·확인일을 WJ 형식으로 어댑트해야 함 |
| `status` | `active`와 collection run 상태만 있음 | WJ 작업 상태로 직접 매핑 불가 |

따라서 AutoStudio 출력은 WJ 계약의 완성 레코드가 아니라 **검색 신호 원료**다.

## 5. 재사용 판단

### 재사용 가능(조건부)

- `naver_client.py`의 공식 검색 API 호출/재시도/오류 정규화: 가능
- `analyzer.py`의 블로그 검색 결과 수·게시일·신선도·근거 URL 추출: 가능
- `datalab.py`의 공식 검색 트렌드 호출: 필요할 때 가능
- `shopping_insight.py`의 쇼핑 클릭 추이: 상업 키워드를 다룰 때만 선택
- `refine.py`의 정제 아이디어: 일부만 참고. WJ의 주제·안전·편집 정책에 맞춰 새 규칙을 작성해야 함

### 재사용하지 않는 편이 좋은 부분

- `autocomplete.py`의 비공식 자동완성 BFS: 공식 계약·한도·허용 범위 미확인
- `collect.py` 전체: AutoStudio의 Supabase/SQLite, 은퇴 임계, CPC·쇼핑·LLM·초안 배치가 WJ의 범위와 다름
- `db.py` 전체 스키마: WJ의 파일 기반 글 제작 흐름과 키워드/브리프 계약이 다름
- AutoStudio의 `opportunity`, `priority`, `commercial` 점수: WJ가 검색량·경쟁도·수익화 목표를 확정하기 전에는 의미가 고정되지 않음

## 6. 호출량·운영 위험의 1차 계산

확인된 코드 설정을 단순 적용하면 다음과 같다.

- 활성 키워드 500개를 매일 모두 갱신할 경우 Search API는 키워드당 블로그 2회 + 뉴스 1회로 약 **1,500회/일**이다. 공식 검색 문서의 25,000회/일보다 작지만, 재시도·다른 기능 호출·애플리케이션별 실제 제한은 별도 확인해야 한다.
- DataLab 검색은 앵커+후보 4개 묶음이므로 500개 전부면 약 **125회/일**이다.
- 쇼핑인사이트도 코드상 후보 4개 묶음이므로 약 **125회/일**이다.
- 자동완성은 기본 최대 300개 요청이며 각 요청은 최대 3회 재시도할 수 있다. 이것은 공식 API quota로 확인된 수치가 아니라 코드의 상한이다.

429/5xx에 대한 재시도는 있지만, 재시도는 호출량을 줄이지 않는다. WJ Blog에서 적용할 때는 키워드 수·수집 주기·원문 보존량을 먼저 제한하고, 실패/부분 성공을 정상 성공으로 기록하지 않아야 한다.

## 7. 권장 다음 단계

1. **WJ의 1차 입력과 범위를 확정한다.** `ai-it`, `economy`, `health` seed 목록을 사람이 정하고, 사용자 CSV/JSON·공식 DataLab·공식 문서/공공기관 출처 중 허용할 제공처를 결정한다.
2. **공식 API를 쓸 경우 개발자 애플리케이션을 별도로 등록한다.** Search와 필요한 DataLab API 권한만 활성화하고 Client ID/Secret은 저장소가 아닌 로컬/호스팅 비밀 저장소에 둔다. 이 조사는 계정 등록이나 키 발급을 하지 않았다.
3. **자동완성 결과는 기본 입력에서 제외한다.** 사용자가 필요하다고 승인할 때만 현재 endpoint의 이용 조건을 네이버 측에서 확인하고, 차단/정책 변경을 전제로 낮은 빈도의 실험 어댑터로 격리한다.
4. **WJ canonical JSON 계약을 먼저 만든다.** 예시 필드에는 `category`, `head_keyword`, `related_keywords`, `search_intent`, `content_angle`, `source`, `collected_at`, `freshness`, `risk_flags`, `evidence_available`, `status`와 원본 API URL/응답 기준일을 포함한다.
5. **AutoStudio 클라이언트의 반환값을 WJ 어댑터로 변환한다.** raw 응답에서 제목·설명·링크·게시일을 보존하고, DataLab `ratio`는 `relative_ratio`처럼 상대값임을 드러내는 이름으로 저장한다.
6. **작은 입력으로 먼저 검증한다.** 실제 계정 작업 전에 mocked HTTP fixture로 5~10개 키워드의 성공·빈 결과·403·429·잘못된 JSON·부분 실패를 검증한다. 이후 실제 API를 쓰게 되면 수집일·출처·실패 상태를 모두 기록한다.
7. **첫 브리프를 사람이 승인한다.** 자동 수집 결과는 `candidate`로만 저장하고, 근거 URL·기준일·위험 검토가 채워진 항목만 `ready-to-write`로 전환한다.

## 8. 확인/미확인 구분

### 확인

- AutoStudio `main`의 기준 커밋과 파일 구조
- `collect.py`의 발굴→검색 스냅샷→DataLab/쇼핑인사이트→저장 흐름
- 공식 Search API·DataLab API의 URL, 헤더 인증 방식, 주요 파라미터·응답 의미·문서상 호출 한도
- SQLite/Postgres 테이블과 FastAPI 키워드 출력 구조
- WJ Blog의 현재 키워드 계약 미구현 상태와 필수 필드

### 미확인/추가 확인 필요

- 실제 네이버 Client ID/Secret의 권한·일일 한도와 현재 사용량
- AutoStudio의 운영 DB에 실제 어떤 데이터가 들어 있는지
- 자동완성 endpoint의 최신 응답 형식, 호출 허용 범위, 이용약관·차단 정책
- WJ Blog가 사용할 실제 seed 목록과 canonical 저장 경로/형식
- AutoStudio 점수와 WJ Blog 편집 우선순위가 상관되는지
- 실제 API 응답과 현재 날짜 기준 데이터 품질. 이 조사에서는 API 키 없이 호출하지 않았다.

## 출처 목록

### 저장소 1차 소스

- [README.md](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/README.md)
- [collect.py](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/collect.py)
- [naver_client.py](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/naver_client.py)
- [autocomplete.py](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/autocomplete.py)
- [analyzer.py](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/analyzer.py)
- [datalab.py](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/datalab.py)
- [shopping_insight.py](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/shopping_insight.py)
- [db.py](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/db.py)
- [server.py](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/server.py)
- [daily-collect.yml](https://github.com/choiwjun/autostudio/blob/d3659c77828e0c5e1083f0dc17e6da01ab9f393a/.github/workflows/daily-collect.yml)

### 네이버 공식 문서

- [Open API 종류와 비로그인 인증](https://developers.naver.com/docs/common/openapiguide/apilist.md)
- [검색 > 블로그](https://developers.naver.com/docs/serviceapi/search/blog/blog.md)
- [검색 > 뉴스](https://developers.naver.com/docs/serviceapi/search/news/news.md)
- [검색 > 쇼핑](https://developers.naver.com/docs/serviceapi/search/shopping/shopping.md)
- [통합 검색어 트렌드](https://developers.naver.com/docs/serviceapi/datalab/search/search.md)
- [쇼핑인사이트](https://developers.naver.com/docs/serviceapi/datalab/shopping/shopping.md)

## 검증 명령 및 결과

- GitHub 트리/API 조회: `GET https://api.github.com/repos/choiwjun/autostudio/git/trees/main?recursive=1` → **HTTP 200**, 293개 트리 항목 확인.
- 기준 커밋 조회: `GET https://api.github.com/repos/choiwjun/autostudio/commits/main` → **HTTP 200**, SHA `d3659c77828e0c5e1083f0dc17e6da01ab9f393a` 확인.
- 소스 raw 조회: 대상 파일별 `GET https://raw.githubusercontent.com/choiwjun/autostudio/main/<path>` → README, config, collect, naver_client, analyzer, autocomplete, db, server, workflow 등 모두 **HTTP 200**.
- 공식 문서 조회: 위 네이버 개발자 센터 링크 6개 → 모두 **HTTP 200**으로 문서 본문 확인.
- 로컬 결과 파일 확인: 이 문서가 작성된 뒤 `Path.exists()`와 크기를 확인한다.
- 코드 실행·pytest·실제 네이버 API 호출: **실행하지 않음** (조사 범위 제약).

## 위험 및 상태

- 위험: 비공식 자동완성 endpoint의 정책·차단·응답 변경. **높음**.
- 위험: API 키 권한·quota·403/429·문서 변경. **중간**.
- 위험: 상대 지수를 절대 검색량으로 잘못 표시. **중간**.
- 위험: AutoStudio 스키마를 그대로 이식하면 WJ Blog의 근거·브리프·상태 계약이 사라짐. **높음**.
- 상태: **DONE** — 조사 보고서와 재사용 판단을 작성했다. 구현·외부 계정 작업은 하지 않았다.
