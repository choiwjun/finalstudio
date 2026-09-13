import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { main, parseImageBackfillArgs } from "./image-backfill.mjs";
import { hashText } from "./lib/image-plan.mjs";
const post = await readFile(
  new URL("./test-fixtures/image-article.md", import.meta.url),
  "utf8",
);
const png = await sharp({
  create: { width: 24, height: 16, channels: 3, background: "white" },
})
  .png()
  .toBuffer();
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "image-backfill-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src/content/posts"), { recursive: true });
  await mkdir(join(root, "out/keyword-recovery"), { recursive: true });
  await writeFile(join(root, "src/content/posts/article.md"), post);
  const approved = "out/keyword-recovery/approved.json";
  await writeFile(
    join(root, approved),
    JSON.stringify({
      posts: [{ path: "src/content/posts/article.md", sha256: hashText(post) }],
    }),
  );
  return { root, approved };
}
test("backfill requires explicit approved list and rejects prohibited side-effect flags", () => {
  assert.throws(() => parseImageBackfillArgs([]), /approved/);
  for (const flag of [
    "--publish",
    "--commit",
    "--push",
    "--sync",
    "--draft",
    "--root",
    "--retry",
  ])
    assert.throws(() =>
      parseImageBackfillArgs([
        "--approved",
        "out/keyword-recovery/a.json",
        flag,
      ]),
    );
  assert.equal(
    parseImageBackfillArgs([
      "--approved",
      "out/keyword-recovery/a.json",
      "--dry-run",
      "--sub-count",
      "3",
    ]).subCount,
    3,
  );
});
test("dry-run is truly read-only and never calls provider/judge/draft/git", async (t) => {
  const { root, approved } = await setup(t);
  const result = await main(["--approved", approved, "--dry-run"], {
    root,
    runImage: () => assert.fail("provider"),
    runJudge: () => assert.fail("judge"),
  });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].plan.scenes.length, 3);
  assert.equal(
    await readFile(join(root, "src/content/posts/article.md"), "utf8"),
    post,
  );
  assert.deepEqual(await readdir(join(root, "out")), ["keyword-recovery"]);
  assert.deepEqual(await readdir(join(root, "src/content/posts")), [
    "article.md",
  ]);
});
test("backfill end-to-end injected raster and raw judge, then verified dry-run no-op", async (t) => {
  const { root, approved } = await setup(t);
  await main(["--approved", approved], {
    root,
    runImage: ({ path }) => writeFile(path, png),
    runJudge: async () => "치명적 결함: 없음\n총점: 91/100",
  });
  const result = await main(["--approved", approved, "--dry-run"], { root });
  assert.equal(result.results[0].idempotent, true);
});
test("notes hash/path boundaries fail before provider; same bound notes reach both gates", async (t) => {
  const { root, approved } = await setup(t);
  const notes = "출처 dossier: 원문 기록.\n";
  const notesPath = "out/keyword-recovery/notes.md";
  await writeFile(join(root, notesPath), notes);
  const entry = {
    path: "src/content/posts/article.md",
    sha256: hashText(post),
    notesPath,
    notesSha256: "0".repeat(64),
  };
  await writeFile(join(root, approved), JSON.stringify({ posts: [entry] }));
  await assert.rejects(
    main(["--approved", approved], {
      root,
      runImage: () => assert.fail("provider"),
    }),
    /notes hash/,
  );
  await writeFile(
    join(root, approved),
    JSON.stringify({ posts: [{ ...entry, notesSha256: hashText(notes) }] }),
  );
  let judged = false;
  const result = await main(["--approved", approved], {
    root,
    runImage: ({ path }) => writeFile(path, png),
    runJudge: async ({ input }) => {
      assert.ok(input.includes(notes));
      judged = true;
      return "치명적 결함: 없음\n총점: 92/100";
    },
  });
  assert.equal(judged, true);
  assert.equal(result.results[0].quality.renderedNotesHash, hashText(notes));
});
test("CLI rejects execution flags in isolated working directory without touching files", async (t) => {
  const { root } = await setup(t);
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      [new URL("./image-backfill.mjs", import.meta.url).pathname, "--publish"],
      { cwd: root },
    ),
    /unknown|approved/,
  );
  assert.equal(
    await readFile(join(root, "src/content/posts/article.md"), "utf8"),
    post,
  );
});
test("backfill stops first failed topic without redrafting or transitions", async (t) => {
  const { root, approved } = await setup(t);
  await writeFile(join(root, "src/content/posts/second.md"), post);
  await writeFile(
    join(root, approved),
    JSON.stringify({
      posts: ["article", "second"].map((slug) => ({
        path: `src/content/posts/${slug}.md`,
        sha256: hashText(post),
      })),
    }),
  );
  let calls = 0;
  await assert.rejects(
    main(["--approved", approved], {
      root,
      runImage: async () => {
        calls++;
        throw Error("stop now");
      },
    }),
    /stop now/,
  );
  assert.equal(calls, 1);
  assert.equal(
    await readFile(join(root, "src/content/posts/second.md"), "utf8"),
    post,
  );
});
test("approved-list symlinks, duplicates and traversal are rejected", async (t) => {
  const { root, approved } = await setup(t);
  for (const path of ["../outside.md", "src/content/posts/../secret.md"]) {
    await writeFile(
      join(root, approved),
      JSON.stringify({ posts: [{ path, sha256: hashText(post) }] }),
    );
    await assert.rejects(main(["--approved", approved, "--dry-run"], { root }));
  }
  await rm(join(root, approved));
  await symlink(join(root, "secret"), join(root, approved));
  await assert.rejects(main(["--approved", approved, "--dry-run"], { root }));
});
