/**
 * 검증 오케스트레이션 게이트 — veto 가능한 preflight와 조건부 executor를 분리한다.
 *
 * 계약 (handoff erratum 2026-09-13):
 *   - preflight는 실행 가능한 verify hook을 받지 않는다 (인자 없이 호출).
 *   - preflight가 ok가 아니면(거부·예외 포함) executor는 0회 호출된다.
 *   - executor는 수신·판정된 안전한 preflight 결과를 데이터로만 받아 1회 호출된다.
 */
export async function runVerification({ preflight, executor } = {}) {
  if (typeof preflight !== "function")
    throw new TypeError("runVerification requires a preflight function");
  if (typeof executor !== "function")
    throw new TypeError("runVerification requires an executor function");

  let preflightResult;
  try {
    preflightResult = await preflight();
  } catch (error) {
    preflightResult = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const record = {
    preflight: preflightResult,
    executorCalls: 0,
    executor: null,
  };
  if (preflightResult?.ok !== true) return record;
  record.executorCalls += 1;
  record.executor = await executor(
    Object.freeze({ preflight: structuredClone(preflightResult) }),
  );
  return record;
}
