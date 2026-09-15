# 배포 운영 문서 (Cloudflare Pages)

정적 사이트(`astro build` → `dist/`)를 Cloudflare Pages에 배포하는 절차와 장애 대응을 정리합니다.
워커(`wrangler.jsonc`, Neon 연동 관리자/키워드 API)는 공개 블로그와 별개 구성요소이며 이 문서 범위 밖입니다.

## 1. 최초 설정

### 1-1. Pages 프로젝트 생성 (Cloudflare 대시보드, 1회)

1. Cloudflare 대시보드 → Workers & Pages → Create → Pages → Connect to Git
2. 저장소 `choiwjun/finalstudio` 선택
3. 빌드 설정:
   - Framework preset: `Astro`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: `/` (저장소 루트)
4. Environment variables (Production):
   - `PUBLIC_SITE_URL` = 확정된 공개 URL (예: `https://<project>.pages.dev` 또는 커스텀 도메인)
     - 이 값이 있어야 `astro.config.mjs`가 sitemap/canonical을 생성한다. 미설정 시 sitemap 비활성.

### 1-2. Deploy Hook 등록

1. Pages 프로젝트 → Settings → Builds & deployments → Deploy hooks → Add deploy hook
   - 이름: `scheduled-publish`, 브랜치: `main`
   - 생성된 URL을 복사 (한 번만 표시됨)
2. GitHub Secret 등록 (로컬에서 gh CLI로 가능):

   ```bash
   gh secret set DEPLOY_HOOK_URL --repo choiwjun/finalstudio
   # 프롬프트에 Deploy Hook URL 붙여넣기
   ```

### 1-3. 동작 확인

```bash
gh workflow run scheduled-publish.yml --repo choiwjun/finalstudio
gh run list --workflow=scheduled-publish.yml --limit 1
```

- secret 미등록 시 워크플로는 빌드 검증만 하고 notice로 종료 (실패 아님).
- secret 등록 후에는 build/check 통과 시 `curl -X POST $DEPLOY_HOOK_URL`로 Pages 재배포를 트리거한다.

## 2. 관리자 자동 작성 흐름

운영 `/admin/`에서 카테고리와 `ready-to-write` 키워드를 선택하면 Worker가 GitHub Actions의 `keyword-auto-draft.yml`을 `workflow_dispatch`로 호출합니다. Worker에는 다음 값을 secret/환경 변수로 등록합니다.

- `GITHUB_TOKEN`: 해당 저장소 workflow dispatch 권한을 가진 최소 권한 토큰. 브라우저에는 노출하지 않는다.
- `GITHUB_REPOSITORY`: 선택 사항. 기본값 `choiwjun/finalstudio`, `owner/repository` 형식만 허용.
- `GITHUB_WORKFLOW`: 선택 사항. 기본값 `keyword-auto-draft.yml`. 값은 workflow 파일명만 허용되며, 잘못된 repository/workflow 설정은 `automation_configuration_invalid`로 거부됩니다.

Workflow는 브리프 생성 → 본문·윤문·독립 심사·이미지 생성 → 콘텐츠/빌드 검사를 모두 통과한 뒤 변경사항을 `draft`로 커밋합니다. 호출 시 `--publish`를 사용하지 않으므로 자동 공개하지 않습니다. GitHub Actions 저장소 설정에서 workflow 권한과 `contents: write`를 확인하세요. 이 작업은 `self-hosted` runner label `wjblog-ai`를 사용하도록 고정되어 있습니다.

작성·윤문·심사·이미지 생성은 저장소가 사용하는 OAuth CLI(Codex 기본, 설정 시 Antigravity `agy`)가 실행 환경에 로그인되어 있어야 합니다. 장기 토큰이나 OAuth 세션을 저장소에 커밋하지 마세요. Workflow는 실행 전에 `command -v codex`와 `codex login status`를 확인하며, 인증이 없는 runner에서는 실패하고 글을 저장하지 않습니다. self-hosted runner는 저장소 전용으로 격리하고 작업 후 workspace와 OAuth 자격 증명을 보존·공유하지 않도록 운영하세요.

상태는 `/api/admin/auto-draft/status?request_id=<UUID>`로 조회되며 관리자 화면에 실행 단계와 품질 게이트 실패 여부를 표시합니다. Workflow의 `run-name`은 `Keyword draft <UUID> / <category> / <keyword>` 형식이므로 이 요청 ID로 정확한 실행을 찾습니다.

## 3. 예약 발행 흐름

- 글 승인 시 사람이 `status: scheduled` + `publishAt`을 frontmatter에 기록한다.
- `scheduled-publish.yml`이 15분마다 실행되어 저장소를 재빌드하고 Deploy Hook을 호출한다.
- `check:content`/`check:build`가 `publishAt` 미도래 scheduled 글을 공개 산출물에서 제외하는지
  빌드 단계에서 검증한다 (실패 시 배포 요청까지 가지 않고 중단).

## 4. 장애·복구 절차

### 3-1. Pages 배포 실패 (빌드 오류)

1. Cloudflare Pages → 해당 deployment → View build log 확인.
2. 로컬에서 재현:

   ```bash
   npm ci && npm run check:content && npm run build && npm run check:build
   ```

3. 원인 수정 → `main`에 push → Pages가 자동 재배포.
   - 코드 문제가 아닌 환경 문제면 Pages 대시보드에서 "Retry deployment" 가능.

### 3-2. 잘못 공개된 글 회수 (draft 복구)

1. 해당 `src/content/posts/<slug>.md`의 `status:`를 `draft`로 되돌린다.
2. `git push` → Pages 자동 재배포로 글이 사라진다.
3. 긴급 시(푸시 전 노출 차단이 필요하면): Pages 대시보드에서 이전 정상 deployment로
   "Rollback to this deployment"를 실행한다.

### 3-3. 예약 글이 시간 전에 보인 경우

- `check:content`가 실패하도록 되어 있으므로 우선 워크플로 로그 확인.
- 즉시 조치: 해당 글 `status: draft`로 변경 → push → 재배포.

### 3-4. Deploy Hook 무효/분실

- Pages 대시보드에서 hook 삭제 후 재생성 → `gh secret set DEPLOY_HOOK_URL`로 갱신.
- 오래된 hook URL은 재생성 즉시 무효화된다.

## 5. 미결 사항 (사람 입력 필요)

- [ ] 실제 공개 도메인 (`*.pages.dev` 기본 or 커스텀 도메인) 확정
- [ ] `PUBLIC_SITE_URL` 값 확정 후 Pages env에 등록
- [ ] Deploy Hook URL 발급 → `DEPLOY_HOOK_URL` secret 등록
- [ ] `wjblog-ai` self-hosted runner를 저장소 전용으로 구성하고 Codex OAuth 인증을 안전하게 등록
- [ ] 운영 Worker에 `GITHUB_TOKEN` secret 및 Actions 권한 설정
- [ ] 자동 작성 workflow 수동 실행 후 draft·이미지·상태 조회 확인
- [ ] 예약 발행 워크플로 수동 실행 후 실제 URL에서 전후 확인
- [ ] Safari/iOS 브라우저 확인 (Playwright 환경에서 미검증)
