# Fresh Security Re-review: NAVER Topic Bridge

Scope: current index (staged) diff plus relevant `HEAD` content. Product files were not modified. The intentionally unstaged `scripts/keyword-system/brief-cli.integration.test.mjs` and `cli.integration.test.mjs`, and untracked research files, are out of scope.

## Review result

The five requested bridge controls are present in the staged content:

- **Subprocess environments:** `draft.mjs:140-146` and `auto-write.mjs:233-237,275` use the minimal `writer-env.mjs` allowlist; NAVER credential variables are excluded. Codex login/status and all writer calls use that path.
- **Brief binding:** `draft.mjs:209-218,235-263` reads/hash-checks the exact JSON bytes, normalizes them, deterministically renders the reviewed notes, hashes those bytes into the approval artifact, and `auto-write.mjs:140-168` checks the notes hash, brief hash, angle, reviewer, reason, and nonce before any Codex call.
- **NAVER isolation:** `contracts.mjs:50-57,120-185` bounds normalized fields/items; `briefs.mjs:45-57,350-391` bounds/quotes external evidence and restricts topic syntax; `auto-write.mjs:350-360` passes writer data as quoted/escaped data rather than instructions.
- **Actual Codex boundary:** `auto-write.mjs:329-341` requires the bridge artifact, reviewed hash, human angle, and reviewer context before `codexLoggedIn` or `callCodex`; direct documented invocation is rejected.
- **Response limits:** `naver-api-hub-provider.mjs:17,80-123,172-181` caps streamed response bytes before JSON parsing; contracts cap blog/trend item counts and field lengths before persistence. The provider tests exercise oversized streams and fields.
- **TOCTOU/path checks:** bridge reads/writes use directory handles and no-follow/atomic helpers (`draft.mjs:126-137,249-255,279-305`; `file-lock.mjs`); output and draft paths are containment-checked.

No blocking security defect was found in the staged NAVER bridge path.

## Advisories

- **[A1] Medium — test coverage:** `draft-bridge.test.mjs:41-50` tests the environment helper, while `draft.integration.test.mjs:31-60` stubs the writer; there is no test capturing the real Codex child environment or exercising direct `auto-write` rejection at the process boundary. Add subprocess-level tests with a fake Codex executable.
- **[A2] Medium — adjacent out-of-scope Codex tools:** unchanged `scripts/auto-publish/generate-image.mjs:94-98`, `prompt-improve.mjs:79-83`, and `scripts/run-evals.mjs:66-70` still inherit the caller environment. They are not part of this NAVER bridge diff, but should adopt `buildWriterEnvironment()` before NAVER credentials are present in their parent process.
- **[A3] Low — approval artifact is self-attested:** `auto-write.mjs:155-167` validates artifact contents but has no signer/registry to prove the artifact was issued by `draft.mjs`. This is adequate as a local human-approval handoff, not as protection against a malicious local operator who can create files and invoke Codex.

SECURITY VERDICT: PASS
BLOCKING:
  []
ADVISORY:
  [A1] medium scripts/keyword-system/draft-bridge.test.mjs:41-50 — boundary subprocess environment and standalone rejection are not directly integration-tested → add fake-Codex process tests
  [A2] medium scripts/auto-publish/generate-image.mjs:94-98 — adjacent Codex child inherits environment → reuse writer environment allowlist
  [A3] low scripts/auto-publish/auto-write.mjs:155-167 — approval artifact is self-attested → use a signer/one-time registry if hostile local users are in scope
COVERAGE: checked staged bridge, relevant HEAD writer paths, all bridge Codex/Node subprocess environments, JSON/Markdown binding, NAVER normalization/isolation, response limits, path containment/TOCTOU helpers, and staged relevant tests; not-checked live NAVER/Codex behavior, deployment permissions, unrelated unstaged files, and untracked research files
