# 자동화 운영 환경

이 저장소의 자동화 명령(`auto:write`, `auto:improve`, `auto:eval`, `image-backfill`, `verify`)은
**WSL(Linux)에서만 실행**한다. Windows 네이티브에서의 동작은 지원하지 않는다.

## 왜 WSL로 고정하는가

- `node_modules`에 플랫폼별 바이너리(`sharp`, `lightningcss`, esbuild 등)가 포함된다.
  Windows에서 설치한 `node_modules`를 WSL에서 쓰거나 그 반대로 쓰면 바이너리가 깨진다.
- 프로세스 그룹 취소(이미지 deadline 취소 포함)는 POSIX 전용이다. Windows에서는
  `image-runtime`이 fail-closed로 동작한다.
- 검증 harness(`npm run verify`)의 preflight도 `linux` 플랫폼을 요구한다.

## 규칙

1. `npm install` / `npm ci`는 반드시 WSL 안에서 실행한다.
   Windows에서 `npm install`을 돌린 뒤 WSL에서 실행하면 안 된다.
2. 의심되면 `node_modules`를 지우고 WSL에서 `npm ci`로 재설치한다.

   ```bash
   rm -rf node_modules && npm ci
   ```

   (`node_modules`는 gitignore 대상이며 재생성 가능하므로 삭제해도 안전하다.)
3. 저장소 경로 `/mnt/c/...` 아래에서 실행하되, 의존성 바이너리는 WSL용이다.
4. Codex CLI는 WSL 쪽 설치(`~/.local/bin/codex`)와 로그인(`codex login`)을 사용한다.

## 확인 명령

```bash
node -e "console.log(process.platform)"   # linux 여야 함
```

`npm run verify`의 preflight가 플랫폼·메모리·fixture 격리를 자동 검사한다.
