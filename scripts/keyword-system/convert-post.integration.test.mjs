import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const converter = fileURLToPath(
  new URL("../auto-publish/convert-post.mjs", import.meta.url),
);

async function fixture(
  t,
  dateFields = "pubDate: 2026-09-12",
  body = "확인한 근거만 기록합니다.",
) {
  const root = await mkdtemp(join(tmpdir(), "convert-post-boundary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const out = join(root, "staging");
  const input = join(root, "input.md");
  await mkdir(out);
  await writeFile(
    input,
    `---\ntitle: "검증용 글"\ndescription: "출처와 확인 범위를 구분하는 검증용 설명입니다."\n${dateFields}\n---\n\n${body}\n`,
  );
  const run = (extra = []) => {
    const result = spawnSync(
      process.execPath,
      [
        converter,
        input,
        "--topic",
        "travel",
        "--angle",
        "근거와 확인 범위를 구분합니다",
        "--format",
        "essay",
        "--out",
        out,
        ...extra,
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
        // The real converter runs, but its optional Astro sync cannot execute.
        env: { HOME: root, PATH: "" },
      },
    );
    assert.ifError(result.error);
    return result;
  };
  return { root, out, input, run };
}

for (const field of ["pubDate", "date"]) {
  test(`converter rejects traversal in ${field} before creating any output`, async (t) => {
    const { root, out, run } = await fixture(t, `${field}: /../../escaped`);
    const result = run();
    assert.equal(
      existsSync(join(root, "escaped.md")),
      false,
      "must not write outside staging",
    );
    assert.notEqual(result.status, 0);
    assert.deepEqual(await readdir(out), []);
  });
}

for (const date of [
  "2026-02-29",
  "2026-02-30",
  "2026-13-01",
  "2026-00-01",
  "2026-9-12",
  "not-a-date",
]) {
  test(`converter rejects invalid calendar date ${date}, even with an explicit slug`, async (t) => {
    const { out, run } = await fixture(t, `pubDate: ${date}`);
    assert.notEqual(run(["--slug", "safe-post"]).status, 0);
    assert.deepEqual(await readdir(out), []);
  });
}

for (const modelDate of ["TBD", "2001-01-01", "/../../escaped"]) {
  test(`converter uses explicit operational date instead of model value ${modelDate}`, async (t) => {
    const body = "본문 날짜와 [직접 확인 필요: 원자료] 마커는 그대로 둡니다.";
    const { root, out, run } = await fixture(t, `pubDate: ${modelDate}`, body);
    const result = run(["--pub-date", "2026-09-12"]);
    assert.equal(result.status, 0, result.stderr);
    const text = await readFile(join(out, "post-2026-09-12.md"), "utf8");
    assert.match(text, /^pubDate: 2026-09-12$/m);
    assert.match(text, /^status: draft$/m);
    // The existing converter appends a newline to the input's trailing newline.
    assert.equal(text.replace(/^---\n[\s\S]*?\n---\n?/, "").trimEnd(), body);
    assert.equal(existsSync(join(root, "escaped.md")), false);
  });
}

for (const invalid of ["TBD", "/../../escaped", "2026-02-29"]) {
  test(`converter rejects invalid operational date ${invalid} despite valid model metadata`, async (t) => {
    const { root, out, run } = await fixture(t);
    assert.notEqual(run(["--pub-date", invalid]).status, 0);
    assert.deepEqual(await readdir(out), []);
    assert.equal(existsSync(join(root, "escaped.md")), false);
  });
}

test("converter rejects an explicit operational date option without a value", async (t) => {
  const { out, run } = await fixture(t);
  assert.notEqual(run(["--pub-date"]).status, 0);
  assert.deepEqual(await readdir(out), []);
});

test("converter preserves pubDate precedence, valid leap days and draft-only status", async (t) => {
  const { out, run } = await fixture(
    t,
    'pubDate: "2024-02-29"\ndate: /../../escaped',
  );
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const text = await readFile(join(out, "post-2024-02-29.md"), "utf8");
  assert.match(text, /^pubDate: 2024-02-29$/m);
  assert.match(text, /^status: draft$/m);
  assert.match(text, /^aiAssisted: true$/m);
});

test("converter supports the legacy date field and suffixes without overwriting", async (t) => {
  const { out, run } = await fixture(t, "date: 2026-09-12");
  const existing = join(out, "post-2026-09-12.md");
  await writeFile(existing, "keep original");
  assert.equal(run().status, 0);
  assert.equal(await readFile(existing, "utf8"), "keep original");
  assert.equal(existsSync(join(out, "post-2026-09-12-2.md")), true);
});

test("converter generates a UTC date when the input supplies none", async (t) => {
  const before = new Date().toISOString().slice(0, 10);
  const { out, run } = await fixture(t, "");
  assert.equal(run().status, 0);
  const after = new Date().toISOString().slice(0, 10);
  const files = await readdir(out);
  assert.equal(files.length, 1);
  assert.ok([`post-${before}.md`, `post-${after}.md`].includes(files[0]));
});

test("converter preserves suggested slugs and suffixes safely", async (t) => {
  const { out, run } = await fixture(
    t,
    undefined,
    "슬러그 제안: london-plan\n\n확인한 내용을 기록합니다.",
  );
  await writeFile(join(out, "london-plan.md"), "keep original");
  assert.equal(run().status, 0);
  assert.equal(existsSync(join(out, "london-plan-2.md")), true);
});

test("converter refuses an existing explicit slug without overwriting", async (t) => {
  const { out, run } = await fixture(t);
  await writeFile(join(out, "chosen.md"), "keep original");
  assert.notEqual(run(["--slug", "chosen"]).status, 0);
  assert.equal(await readFile(join(out, "chosen.md"), "utf8"), "keep original");
});

test("converter never follows a dangling destination symlink", async (t) => {
  const { root, out, run } = await fixture(t);
  const outside = join(root, "outside.md");
  await symlink(outside, join(out, "chosen.md"));
  assert.notEqual(run(["--slug", "chosen"]).status, 0);
  assert.equal(existsSync(outside), false);
});

test("converter refuses a symlinked output directory", async (t) => {
  const { root, out, run } = await fixture(t);
  const outside = join(root, "outside");
  await mkdir(outside);
  await rm(out, { recursive: true });
  await symlink(outside, out);
  assert.notEqual(run().status, 0);
  assert.deepEqual(await readdir(outside), []);
});
