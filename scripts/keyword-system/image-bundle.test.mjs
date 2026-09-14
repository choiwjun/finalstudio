import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import {
  buildImagePrompts,
  attachSubImages,
  generateImageBundle,
  validateImageBundle,
} from "./lib/image-bundle.mjs";
import { planArticleImages, hashText } from "./lib/image-plan.mjs";

const post = await readFile(
  new URL("./test-fixtures/image-article.md", import.meta.url),
  "utf8",
);
const png = await sharp({
  create: { width: 32, height: 24, channels: 3, background: "#abcdef" },
})
  .png()
  .toBuffer();
const judge = async () => "치명적 결함: 없음\n총점: 94/100";
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "image-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const postPath = join(root, "src/content/posts/article.md");
  await mkdir(join(root, "src/content/posts"), { recursive: true });
  await writeFile(postPath, post);
  return {
    root,
    postPath,
    slug: "article",
    runImage: async ({ path }) => writeFile(path, png),
    runJudge: judge,
  };
}
test("finished body grounds distinct main and 2/3 section scenes with immutable anchors", () => {
  for (const subCount of [2, 3]) {
    const plan = planArticleImages(post, { slug: "article", subCount });
    const prompts = buildImagePrompts({ plan });
    assert.equal(plan.scenes.length, subCount + 1);
    assert.equal(plan.sourceHash, hashText(post));
    assert.equal(new Set(plan.scenes.map((s) => s.excerpt)).size, subCount + 1);
    for (const scene of plan.scenes) {
      assert.ok(post.includes(scene.excerpt));
      assert.ok(prompts[scene.role].includes(post));
      assert.ok(prompts[scene.role].includes(scene.excerpt));
      assert.ok(prompts[scene.role].includes("블로그 포스팅 예정"));
      assert.ok(prompts[scene.role].includes("핵심내용과 연결관계"));
      assert.ok(!prompts[scene.role].includes("Visual metaphor"));
    }
    assert.ok(Object.isFrozen(plan.scenes[0]));
  }
  for (const subCount of [0, 1, 4])
    assert.throws(() => planArticleImages(post, { slug: "article", subCount }));
  assert.throws(
    () =>
      buildImagePrompts({ title: "title", topic: "travel", slug: "article" }),
    /finished|plan/,
  );
});
test("rejects duplicate, ambiguous and insufficient section anchors", () => {
  const heading = post.match(/^## .+$/m)[0];
  assert.throws(
    () =>
      planArticleImages(post + "\n" + heading + "\nextra", { slug: "article" }),
    /duplicate|ambiguous/,
  );
  assert.throws(
    () =>
      planArticleImages(
        "---\ntitle: x\nstatus: draft\n---\nintro\n## Only\ntext",
        { slug: "article" },
      ),
    /section/,
  );
});
test("normalization keeps screenshot obligations, original syntax, and honest labels", () => {
  const text =
    post +
    "\n![테스트 화면](placeholder)\n![설정 스크린샷](/images/missing.png)\n";
  const plan = planArticleImages(text, { slug: "article" });
  assert.equal(plan.screenshots.length, 2);
  assert.equal(plan.screenshots[0].original, "![테스트 화면](placeholder)");
  const images = plan.scenes.map((s) => ({
    role: s.role,
    publicPath: `/images/article-${s.role}.png`,
  }));
  const next = attachSubImages(text, { slug: "article", images, plan });
  assert.ok(next.includes("[스크린샷]"));
  assert.ok(next.includes("[직접 확인 필요]"));
  assert.ok(!next.includes("](placeholder)"));
  assert.match(next, /AI 생성 일러스트/);
  assert.match(next, /status: draft/);
  assert.equal(attachSubImages(next, { slug: "article", images, plan }), next);
});
for (const subCount of [2, 3])
  test(`installs decoded main1/sub${subCount}, exact quality evidence, then no-op`, async (t) => {
    const options = await setup(t);
    const result = await generateImageBundle({ ...options, subCount });
    assert.equal(result.images.length, subCount + 1);
    const text = await readFile(options.postPath, "utf8");
    assert.equal(result.quality.candidateHash, hashText(text));
    assert.equal(result.quality.mechanical.pass, true);
    assert.equal(result.quality.score, 94);
    await validateImageBundle(result, {
      root: options.root,
      postPath: options.postPath,
      postText: text,
    });
    const second = await generateImageBundle({
      ...options,
      subCount,
      expectedHash: hashText(post),
      runImage: () => assert.fail("regenerated"),
      runJudge: () => assert.fail("rejudged"),
    });
    assert.equal(second.idempotent, true);
    assert.equal(await readFile(options.postPath, "utf8"), text);
  });
test("rejects corrupt/truncated/extension-mismatched rasters without post changes", async (t) => {
  for (const bytes of [
    Buffer.from("png-placeholder"),
    png.subarray(0, 50),
    await sharp(png).jpeg().toBuffer(),
  ]) {
    const options = await setup(t);
    let calls = 0;
    await assert.rejects(
      generateImageBundle({
        ...options,
        runImage: async ({ path }) => {
          calls++;
          await writeFile(path, bytes);
        },
      }),
      /image|PNG|png/,
    );
    assert.equal(calls, 1);
    assert.equal(await readFile(options.postPath, "utf8"), post);
  }
});
test("first failure and shared timeout stop remaining roles, abort runner", async (t) => {
  const options = await setup(t);
  let calls = 0;
  let aborted = false;
  await assert.rejects(
    generateImageBundle({
      ...options,
      runImage: async () => {
        calls++;
        throw Error("first failure");
      },
    }),
    /first failure/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    generateImageBundle({
      ...options,
      deadline: Date.now() + 1000,
      runImage: ({ signal }) =>
        new Promise(() =>
          signal.addEventListener("abort", () => {
            aborted = true;
          }),
        ),
    }),
    /deadline/,
  );
  assert.equal(aborted, true);
  assert.equal(await readFile(options.postPath, "utf8"), post);
});
test("mechanical/independent quality failures cannot install assets", async (t) => {
  const options = await setup(t);
  await assert.rejects(
    generateImageBundle({
      ...options,
      runJudge: async () => "치명적 결함: 없음\n총점: 89/100",
    }),
    /90/,
  );
  assert.equal(await readFile(options.postPath, "utf8"), post);
  assert.deepEqual(
    (await readdir(join(options.root, "public/images"))).filter((n) =>
      n.endsWith(".png"),
    ),
    [],
  );
  await writeFile(
    options.postPath,
    "---\ntitle: 짧은 글\nstatus: draft\n---\n소개\n## 첫째\n짧다\n## 둘째\n짧음",
  );
  let calls = 0;
  await assert.rejects(
    generateImageBundle({
      ...options,
      runImage: () => {
        calls++;
      },
    }),
    /mechanical/,
  );
  assert.equal(calls, 0);
});
test("source hash conflicts, symlinks and asset conflicts are rejected before provider", async (t) => {
  const options = await setup(t);
  const noRun = () => assert.fail("provider ran");
  await assert.rejects(
    generateImageBundle({
      ...options,
      expectedHash: "0".repeat(64),
      runImage: noRun,
    }),
    /hash/,
  );
  await assert.rejects(
    generateImageBundle({ ...options, slug: "../escape", runImage: noRun }),
    /slug|path/,
  );
  await mkdir(join(options.root, "public/images"), { recursive: true });
  await writeFile(join(options.root, "public/images/article-main.png"), png);
  await assert.rejects(
    generateImageBundle({ ...options, runImage: noRun }),
    /conflict/,
  );
  await rm(join(options.root, "public/images/article-main.png"));
  await rm(options.postPath);
  await symlink(join(options.root, "outside.md"), options.postPath);
  await assert.rejects(generateImageBundle({ ...options, runImage: noRun }));
});
test("concurrent post edits are preserved and partial asset installation rolls back", async (t) => {
  const options = await setup(t);
  await assert.rejects(
    generateImageBundle({
      ...options,
      runJudge: async () => {
        await writeFile(options.postPath, post + "\nconcurrent edit\n");
        return judge();
      },
    }),
    /changed|conflict/,
  );
  assert.ok(
    (await readFile(options.postPath, "utf8")).endsWith("concurrent edit\n"),
  );
  await writeFile(options.postPath, post);
  await assert.rejects(
    generateImageBundle({
      ...options,
      installHook: async ({ index }) => {
        if (index === 1) throw Error("install interrupted");
      },
    }),
    /install interrupted/,
  );
  assert.equal(await readFile(options.postPath, "utf8"), post);
  assert.deepEqual(
    (await readdir(join(options.root, "public/images"))).filter((n) =>
      n.endsWith(".png"),
    ),
    [],
  );
});
test("fenced examples are not anchors or screenshot embeds and duplicate content fails", () => {
  const text = post + "\n```md\n## not a section\n![화면](placeholder)\n```\n";
  const plan = planArticleImages(text, { slug: "article" });
  assert.equal(plan.screenshots.length, 0);
  assert.ok(!plan.sections.some((s) => s.heading.includes("not a section")));
  const intro = "---\ntitle: x\nstatus: draft\n---\n중심 주장\n";
  assert.throws(
    () =>
      planArticleImages(intro + "## 하나\n같음\n## 둘\n같음\n", {
        slug: "article",
      }),
    /ambiguous/,
  );
});
test("relative unresolved screenshot syntax is preserved in provenance only", () => {
  const text =
    post +
    "\n![기록한 메모표](screenshot-data-center-power-reading-table.png)\n";
  const plan = planArticleImages(text, { slug: "article" });
  assert.equal(plan.screenshots.length, 1);
  assert.equal(
    plan.screenshots[0].target,
    "screenshot-data-center-power-reading-table.png",
  );
});
test("existing verified screenshot is retained and image path symlink/conflicts fail closed", async (t) => {
  const options = await setup(t);
  await mkdir(join(options.root, "public/images"), { recursive: true });
  await writeFile(join(options.root, "public/images/real.png"), png);
  const text = post + "\n![실제 스크린샷](/images/real.png)\n";
  await writeFile(options.postPath, text);
  const result = await generateImageBundle(options);
  assert.equal(result.plan.screenshots.length, 0);
  assert.ok(
    (await readFile(options.postPath, "utf8")).includes(
      "![실제 스크린샷](/images/real.png)",
    ),
  );
  await writeFile(
    join(options.root, "public/images/article-sub-1.png"),
    Buffer.from("changed"),
  );
  await assert.rejects(generateImageBundle(options), /PNG|hash|image/);
});
test("journal recovery rolls back owned assets, rejects divergent edits, finalizes completed commit", async (t) => {
  const options = await setup(t);
  const result = await generateImageBundle(options);
  const journalPath = join(
    options.root,
    "out/image-bundles/article/transaction.json",
  );
  await writeFile(
    journalPath,
    JSON.stringify({ ...result, state: "prepared" }),
  );
  const restored = await generateImageBundle(options);
  assert.equal(restored.idempotent, true);
  await writeFile(
    journalPath,
    JSON.stringify({ ...result, state: "prepared" }),
  );
  await writeFile(options.postPath, post + "\nexternal");
  await assert.rejects(generateImageBundle(options), /recovery post conflict/);
  await writeFile(options.postPath, post);
  let calls = 0;
  await assert.rejects(
    generateImageBundle({
      ...options,
      runImage: async () => {
        calls++;
        throw Error("stop after recovery");
      },
    }),
    /stop after recovery/,
  );
  assert.equal(calls, 1);
  assert.equal(await readFile(options.postPath, "utf8"), post);
  assert.deepEqual(
    (await readdir(join(options.root, "public/images"))).filter((n) =>
      n.endsWith(".png"),
    ),
    [],
  );
});
test("rejects invalid count, missing main/placement, wrong paths and changed receipt contract", async (t) => {
  const options = await setup(t);
  const result = await generateImageBundle(options);
  const text = await readFile(options.postPath, "utf8");
  await assert.rejects(
    generateImageBundle({ ...options, subCount: 3 }),
    /contract/,
  );
  await assert.rejects(
    generateImageBundle({ ...options, imageRoles: ["main", "sub-2", "sub-1"] }),
    /role/,
  );
  await assert.rejects(
    validateImageBundle(result, {
      root: options.root,
      postPath: options.postPath,
      postText: text.replace(
        "image: /images/article-main.png",
        "image: /images/other.png",
      ),
    }),
    /main/,
  );
  await assert.rejects(
    validateImageBundle(result, {
      root: options.root,
      postPath: options.postPath,
      postText: text.replace(
        "](/images/article-sub-1.png)",
        "](/images/other.png)",
      ),
    }),
    /reference/,
  );
  await assert.rejects(
    validateImageBundle(
      {
        ...result,
        images: result.images.map((i) => ({
          ...i,
          path: "/tmp/elsewhere.png",
        })),
      },
      { root: options.root, postPath: options.postPath, postText: text },
    ),
    /path/,
  );
  await assert.rejects(validateImageBundle(result, {}), /bound/);
});
test("image size and pixel bounds and hardlinks are checked", async (t) => {
  const { decodePng, readBounded } = await import("./lib/image-storage.mjs");
  await assert.rejects(decodePng(Buffer.alloc(0)), /bounds/);
  await assert.rejects(
    decodePng(
      await sharp({
        create: { width: 1, height: 1, channels: 3, background: "white" },
      })
        .png()
        .toBuffer(),
    ),
    /bounds/,
  );
  const options = await setup(t);
  await assert.rejects(readBounded(options.postPath, 1), /bounds/);
  const { link } = await import("node:fs/promises");
  await link(options.postPath, join(options.root, "hardlinked.md"));
  await assert.rejects(generateImageBundle(options), /bounds|link/);
});
test("oil report archive is reversible, judged final bytes exclude metadata, failed candidates leave source unchanged", async (t) => {
  const options = await setup(t);
  const oil = await readFile(
    new URL(
      "./test-fixtures/oil-100-breakout-original.md",
      import.meta.url,
    ),
    "utf8",
  );
  const notes = await readFile(
    new URL(
      "../../out/keyword-briefs/economy-business-100달러-돌파.md",
      import.meta.url,
    ),
    "utf8",
  );
  await writeFile(options.postPath, oil);
  await mkdir(join(options.root, "out/keyword-briefs"), { recursive: true });
  const notesPath = "out/keyword-briefs/oil.md";
  await writeFile(join(options.root, notesPath), notes);
  const bound = { ...options, notesPath, notesSha256: hashText(notes) };
  await assert.rejects(
    generateImageBundle({
      ...bound,
      runJudge: async ({ input }) => {
        assert.ok(!input.includes("변경률: 18%"));
        assert.ok(input.includes(notes));
        return "치명적 결함: 없음\n총점: 89/100";
      },
    }),
    /90/,
  );
  assert.equal(await readFile(options.postPath, "utf8"), oil);
  let judged;
  const result = await generateImageBundle({
    ...bound,
    runJudge: async ({ input }) => {
      judged = input.split("심사 대상 본문:\n")[1];
      return judge();
    },
  });
  const installed = await readFile(options.postPath, "utf8");
  assert.equal(
    installed.replace(/^---\n[\s\S]*?\n---/, "").trim(),
    judged,
    "the judge must score the exact installed body bytes, without frontmatter metadata",
  );
  assert.ok(!judged.startsWith("---"));
  assert.equal(result.quality.candidateHash, hashText(installed));
  assert.equal(result.plan.articleText + result.plan.reportArchive.text, oil);
  assert.ok(!installed.includes("변경률: 18%"));
  assert.ok(installed.includes("[직접 확인 필요: 발행 전 NAVER API HUB"));
  const noop = await generateImageBundle({
    ...bound,
    expectedHash: hashText(oil),
    runImage: () => assert.fail("regenerated"),
  });
  assert.equal(noop.idempotent, true);
});
test("rejected raw judge output and candidates survive a later successful attempt", async (t) => {
  const options = await setup(t);
  await assert.rejects(
    generateImageBundle({
      ...options,
      runJudge: async () => "치명적 결함: 없음\n총점: 89/100",
    }),
    /90/,
  );
  const output = join(options.root, "out/image-bundles/article");
  assert.match(await readFile(join(output, "judge.md"), "utf8"), /89/);
  await generateImageBundle(options);
  const history = await readdir(join(output, "history"));
  assert.equal(history.length, 1);
  assert.match(
    await readFile(join(output, "history", history[0], "judge.md"), "utf8"),
    /89/,
  );
  assert.equal(
    await readFile(join(output, "history", history[0], "source.md"), "utf8"),
    post,
  );
});
test("malformed or fatal independent judgements fail closed even at a claimed high score", async (t) => {
  const { judgeImageCandidate } = await import("./lib/image-quality.mjs");
  for (const raw of [
    "총점: 100/100",
    "치명적 결함: 있음\n총점: 99/100",
    "치명적 결함: 없음\n총점: 101/100",
    "치명적 결함: 없음\n총점: 94/100\n총점: 99/100",
  ]) {
    await assert.rejects(
      judgeImageCandidate(post, {
        sourceText: post,
        notes: { text: "", sha256: null },
        runJudge: async () => raw,
        deadline: Date.now() + 10000,
      }),
      /90/,
    );
  }
  const options = await setup(t);
  await generateImageBundle(options);
  const path = join(options.root, "out/image-bundles/article/transaction.json");
  const receipt = JSON.parse(await readFile(path, "utf8"));
  await writeFile(
    path,
    JSON.stringify({
      ...receipt,
      quality: { ...receipt.quality, raw: "치명적 결함: 있음\n총점: 99/100" },
    }),
  );
  await assert.rejects(generateImageBundle(options), /90|receipt/);
});
test("directory swap and failed rollback preserve conflicting third-party bytes", async (t) => {
  const { rename } = await import("node:fs/promises");
  const options = await setup(t);
  await assert.rejects(
    generateImageBundle({
      ...options,
      runJudge: async () => {
        await rename(
          join(options.root, "public/images"),
          join(options.root, "public/old-images"),
        );
        await symlink(
          join(options.root, "public/old-images"),
          join(options.root, "public/images"),
        );
        return judge();
      },
    }),
    /symlink|directory/,
  );
  assert.equal(await readFile(options.postPath, "utf8"), post);
  const other = await setup(t);
  await assert.rejects(
    generateImageBundle({
      ...other,
      installHook: async ({ index, image }) => {
        if (index === 0) {
          await writeFile(image.path, "third-party bytes");
          throw Error("interruption");
        }
      },
    }),
    /rollback requires review/,
  );
  assert.equal(
    await readFile(join(other.root, "public/images/article-main.png"), "utf8"),
    "third-party bytes",
  );
});
test("recovery refuses ownership records for unrelated assets", async (t) => {
  const options = await setup(t);
  const result = await generateImageBundle(options);
  await writeFile(options.postPath, post);
  const unrelated = join(options.root, "public/images/unrelated.png");
  await writeFile(unrelated, png);
  const { stat } = await import("node:fs/promises");
  const identity = await stat(unrelated);
  const record = {
    ...result,
    state: "prepared",
    owned: [
      {
        name: "unrelated.png",
        sha256: hashText(png),
        identity: { dev: identity.dev, ino: identity.ino },
      },
    ],
  };
  await writeFile(
    join(options.root, "out/image-bundles/article/transaction.json"),
    JSON.stringify(record),
  );
  await assert.rejects(generateImageBundle(options), /recovery.*ownership/);
  assert.deepEqual(await readFile(unrelated), png);
});
