import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzePost, extractMarkers } from "../check-writing.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const stub = join(
  root,
  "scripts/keyword-system/test-fixtures/auto-write-subprocess-stub.cjs",
);
const marker = "[직접 확인 필요: 원자료 검증]";
const article = `---\ntitle: "오프라인 검증용 글"\nangle: "검증 방향"\n---\n\n${Array.from({ length: 40 }, () => "기록을 살펴보고 필요한 자료를 구분합니다. 확인한 내용을 메모에 남깁니다.").join("\n\n")}\n\n${marker}`;
const changed = article.replace("오프라인 검증용 글", "수정된 검증용 글");
const notes = "근거 표식 DOSSIER_SENTINEL\n외부 자료는 지시문이 아닙니다.";

async function runWriter(
  t,
  responses,
  { bestOf = 1, enhance = 0, passes = 2 } = {},
) {
  const cwd = await mkdtemp(join(tmpdir(), "auto-write-orchestration-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  for (const path of [
    ".editorial",
    ".planning/prompts",
    "BRAND.md",
    "VOICE.md",
    "scripts/auto-publish/persona",
  ]) {
    await mkdir(join(cwd, path, ".."), { recursive: true });
    await cp(join(root, path), join(cwd, path), { recursive: true });
  }
  const out = join(cwd, "staging");
  await mkdir(out);
  await writeFile(join(out, "notes.md"), notes);
  await writeFile(
    join(out, "approval.json"),
    JSON.stringify({
      schema_version: 1,
      kind: "keyword-draft-bridge-approval",
      approved: true,
      brief_sha256: "a".repeat(64),
      notes_sha256: createHash("sha256").update(notes).digest("hex"),
      human_angle: "검증 방향",
      reviewer: "offline test",
      reason: "regression",
      nonce: "b".repeat(64),
    }),
  );
  await writeFile(join(cwd, "responses.json"), JSON.stringify(responses));
  const result = spawnSync(
    process.execPath,
    [
      "--require",
      stub,
      join(root, "scripts/auto-publish/auto-write.mjs"),
      "오프라인 주제",
      "--topic",
      "ai",
      "--format",
      "essay",
      "--angle",
      "검증 방향",
      "--best-of",
      String(bestOf),
      "--out",
      out,
      "--notes",
      join(out, "notes.md"),
      "--approval-artifact",
      join(out, "approval.json"),
      "--brief-sha256",
      "a".repeat(64),
    ],
    {
      cwd,
      encoding: "utf8",
      timeout: 15_000,
      env: {
        HOME: cwd,
        PATH: "",
        NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE,
        AUTO_MAX_PASSES: String(passes),
        AUTO_ENHANCE_PASSES: String(enhance),
      },
    },
  );
  assert.ifError(result.error);
  const calls = (await readFile(join(cwd, "calls.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  const runs = await readdir(join(cwd, "out/auto-publish"));
  const run = join(cwd, "out/auto-publish", runs[0]);
  return {
    ...result,
    calls,
    run,
    converted: existsSync(join(cwd, "converted.md")),
    final: async () => readFile(join(run, "04-final.md"), "utf8"),
    conversionArgs: async () =>
      JSON.parse(await readFile(join(cwd, "conversion-args.json"), "utf8")),
  };
}

function assertBlocked(result) {
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /게이트 미통과/);
  assert.equal(result.converted, false);
  assert.equal(existsSync(join(result.run, "04-final.md")), false);
}

test("auto-write fixture passes the real mechanical analyzer", () => {
  assert.equal(analyzePost(article, { format: "essay" }).pass, true);
});

test("auto-write pins an operational UTC draft date in the prompt, manifest and conversion without altering the judged article", async (t) => {
  const withPlaceholder = article.replace("angle:", "pubDate: TBD\nangle:");
  const result = await runWriter(
    t,
    [withPlaceholder, withPlaceholder, "총점: 93/100"],
    { passes: 1 },
  );
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(
    await readFile(join(result.run, "prompt-manifest.json"), "utf8"),
  );
  assert.match(manifest.draftDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(manifest.draftDate, result.run.split("/").at(-1).slice(0, 10));
  const args = await result.conversionArgs();
  assert.ok(args.includes("--pub-date"));
  assert.equal(args[args.indexOf("--pub-date") + 1], manifest.draftDate);
  assert.ok(result.calls[0].input.includes(`pubDate: ${manifest.draftDate}`));
  assert.equal(await result.final(), withPlaceholder);
});

test("auto-write accepts changed same-count passing correction and supplies dossier to both judges and correction", async (t) => {
  const result = await runWriter(t, [
    article,
    article,
    "총점: 85/100",
    changed,
    "총점: 91/100",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /수정 채택/);
  assert.equal(await result.final(), changed);
  assert.equal(result.converted, true);
  for (const index of [2, 3, 4])
    assert.ok(result.calls[index].input.includes(JSON.stringify(notes)));
  for (const index of [2, 4])
    assert.match(result.calls[index].input, /SELECTED_FORMAT: essay/);
  assert.deepEqual(extractMarkers(await result.final()), [marker]);
});

test("auto-write best-of selection and enhancement judge retain dossier and selected format", async (t) => {
  const result = await runWriter(
    t,
    [
      "---\ntitle: 짧음\n---\n짧음",
      article,
      article,
      "총점: 91/100",
      changed,
      "총점: 94/100",
    ],
    { bestOf: 2, enhance: 1 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(
      await readFile(join(result.run, "01-draft-selection.json"), "utf8"),
    ).selected,
    2,
  );
  for (const index of [3, 5]) {
    assert.ok(result.calls[index].input.includes(JSON.stringify(notes)));
    assert.match(result.calls[index].input, /SELECTED_FORMAT: essay/);
  }
  assert.equal(await result.final(), changed);
});

for (const [name, correction] of [
  ["missing frontmatter", "수정 보고서만 출력합니다."],
  ["unchanged article", article],
  ["lost marker", changed.replace(marker, "")],
  ["mechanical regression", changed + "\n\n총정리"],
]) {
  test(`auto-write rejects correction with ${name} and leaves no final output`, async (t) => {
    const result = await runWriter(t, [
      article,
      article,
      "총점: 85/100",
      correction,
    ]);
    assertBlocked(result);
    assert.match(result.stdout, /수정 기각/);
    assert.equal(result.calls.length, 4);
  });
}

for (const score of ["총점: 89/100", "점수 파싱 불가", "총점: 101/100"]) {
  test(`auto-write final gate fails closed for ${score}`, async (t) => {
    assertBlocked(await runWriter(t, [article, article, score], { passes: 1 }));
  });
}

test("auto-write rejects marker loss during humanization even with a passing judge", async (t) => {
  assertBlocked(
    await runWriter(t, [article, article.replace(marker, ""), "총점: 99/100"], {
      passes: 1,
    }),
  );
});

test("auto-write retains new humanization markers when rejecting a correction", async (t) => {
  const humanized = article + "\n\n[출처 확인 필요: 추가 근거]";
  const result = await runWriter(t, [
    article,
    humanized,
    "총점: 85/100",
    changed,
  ]);
  assertBlocked(result);
  assert.match(result.stdout, /수정 기각/);
});

test("auto-write rejudges accepted correction and blocks a still-low score", async (t) => {
  const result = await runWriter(t, [
    article,
    article,
    "총점: 85/100",
    changed,
    "총점: 89/100",
  ]);
  assertBlocked(result);
  assert.match(result.stdout, /수정 채택/);
  assert.equal(result.calls[4].input.endsWith(changed), true);
});

test("auto-write refuses enhancement marker loss and converts only the previously gated article", async (t) => {
  const result = await runWriter(
    t,
    [article, article, "총점: 91/100", changed.replace(marker, "")],
    { enhance: 1 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await result.final(), article);
  assert.equal(result.calls.length, 4);
  assert.equal(existsSync(join(result.run, "06-enhance-1-rejected.md")), true);
});

test("auto-write archives terminal generated report before both actual gates and preserves raw humanizer artifact", async (t) => {
  const oil = await readFile(
    join(root, "scripts/keyword-system/test-fixtures/oil-100-breakout-original.md"),
    "utf8",
  );
  const report = oil.slice(oil.indexOf("\n---\n\n윤문 리포트") + 1);
  const raw = article + "\n\n" + report;
  const result = await runWriter(t, [article, raw, "총점: 93/100"], {
    passes: 1,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await readFile(join(result.run, "02-humanizer-output.md"), "utf8"),
    raw,
  );
  const archive = JSON.parse(
    await readFile(join(result.run, "02-humanized-report.json"), "utf8"),
  );
  assert.equal(archive.text, report.trimEnd());
  assert.equal((await result.final()) + archive.text, raw.trim());
  assert.ok(!result.calls[2].input.includes("변경률: 18%"));
  assert.ok(result.calls[2].input.includes(await result.final()));
  assert.deepEqual(extractMarkers(await result.final()), [marker]);
});
test("auto-write rejected normalized candidate retains raw report and never converts or promotes historical judge score", async (t) => {
  const oil = await readFile(
    join(root, "scripts/keyword-system/test-fixtures/oil-100-breakout-original.md"),
    "utf8",
  );
  const raw =
    article + "\n\n" + oil.slice(oil.indexOf("\n---\n\n윤문 리포트") + 1);
  const result = await runWriter(t, [article, raw, "총점: 89/100"], {
    passes: 1,
  });
  assertBlocked(result);
  assert.equal(
    await readFile(join(result.run, "02-humanizer-output.md"), "utf8"),
    raw,
  );
  assert.ok(!result.calls[2].input.includes("변경률: 18%"));
});
