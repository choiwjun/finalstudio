# Week 0 결정 로그 — AdSense 블로그

- 담당: Human(wj941)
- 상태: 기본값으로 로컬 설계 진행, 공개 배포는 보류
- 기준 문서: [CEO_PLAN.md](../CEO_PLAN.md)

## 로컬 도구체인

- Node: 24.19.0 (CI는 24 계열)
- npm: 11.7.0
- Astro: 7.3.1
- sitemap integration: 3.7.4
- 콘텐츠 입력: `src/content/posts/`
- 정적 출력: `dist/`

| 항목 | 현재 기본값 | 상태 | Human 확정 필요 |
|---|---|---|---|
| 언어·시장 | 한국어·한국 | provisional | 예 |
| 작성자 | 미정. 공개 글은 작성자 확정 전 금지 | blocking for publish | 예 |
| 검토 용량 | 주 2개 이하 | provisional | 예 |
| 도메인·Google 계정 | 미정. 로컬 빌드만 허용 | blocking for deploy/AdSense | 예 |
| AI 입력 | 합성·공개 자료만, 개인정보·기밀정보 금지 | active rule | 아니오 |
| 콘텐츠 원본 | Git/Markdown | approved for local scaffold | 예: private remote 연결 시 |
| 인프라 | Astro + Cloudflare Pages | approved for local scaffold | 예: 상업 사용·요금 재확인 |
| DB | 초기 없음. 필요 시 Neon 검토 | approved for local scaffold | 예: workflow DB 도입 시 |
| 모델 경로 | 세 모델 모두 Command Code | active for planning | 아니오 |

## 로컬 진행 권한

- Astro 골격, 콘텐츠 스키마, 더미 draft, CI 검사, 문서 작성은 진행한다.
- 클라우드 리소스 생성, 자격 증명 등록, 외부 배포, 광고 활성화, 공개 작성자 정보 확정은 진행하지 않는다.

## 종료 조건

- [x] 로컬 Astro 정적 빌드 성공
- [x] draft 글의 `author: TBD`와 `testedAt: TBD` 허용
- [x] 공개 상태 글에는 실제 author와 testedAt을 요구하는 검사 추가
- [x] `.planning/`이 build 산출물에 포함되지 않는 검사 추가
- [ ] Human이 언어·시장과 작성자 확정
- [ ] Human이 도메인·Google 계정 제공
- [ ] private Git remote 연결
