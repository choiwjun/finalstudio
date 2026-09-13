import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import {
  extractArticleSignals,
  parseVisualBrief,
  buildBriefInput,
} from "./lib/visual-brief.mjs";
import {
  parseVisualJudgeScores,
  parseVisualBundleScore,
} from "./lib/visual-judge.mjs";
import { buildVisualImagePrompts } from "./lib/image-plan.mjs";
import { regenOneBundle, parseImageRegenArgs } from "./image-regen.mjs";
import { generateImageBundle } from "./lib/image-bundle.mjs";
import { hashText } from "./lib/image-plan.mjs";

const post = await readFile(
  new URL("./test-fixtures/image-article.md", import.meta.url),
  "utf8",
);
const png = await sharp({
  create: { width: 32, height: 24, channels: 3, background: "#abcdef" },
})
  .png()
  .toBuffer();
const png2 = await sharp({
  create: { width: 32, height: 24, channels: 3, background: "#123456" },
})
  .png()
  .toBuffer();
const bodyJudge = async () => "치명적 결함: 없음\n총점: 94/100";
const briefJson = JSON.stringify({
  centralMessage: "검색 결과와 추세 지표를 분리해 읽어야 한다",
  mustShow: ["검색 결과 목록", "상대 지표 곡선", "공식 확인 문서"],
  relations: ["세 자료의 역할 분리"],
  imageRoles: {
    main: "세 종류의 자료가 분리되어 놓인 책상 장면",
    "sub-1": "두 개의 다른 서류 더미를 비교하는 장면",
    "sub-2": "체크리스트를 순서대로 확인하는 장면",
  },
  mustAvoid: ["장식용 돋보기", "추상적 점 패턴"],
  factualConstraints: ["실제 가격·수치·UI 상태를 만들지 않음"],
  evidenceMode: "illustration",
});
const visualJudgePass =
  "관찰된 요소: 책상 위 세 서류 더미, 구분선, 체크 표시\n의미 적합도: 93/100\n시각 완성도: 88/100\n치명적 결함: 없음";
const bundleJudgePass =
  "관찰된 요소: 세 장면 모두 서로 다른 소재\n번들 점수: 92/100\n치명적 결함: 없음";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "image-regen-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const postPath = join(root, "src/content/posts/article.md");
  await mkdir(join(root, "src/content/posts"), { recursive: true });
  await mkdir(join(root, "public/images"), { recursive: true });
  await writeFile(postPath, post);
  return {
    root,
    entry: {
      path: "src/content/posts/article.md",
      sha256: hashText(post),
    },
    slug: "article",
  };
}
async function installBaseline(ctx) {
  await generateImageBundle({
    root: ctx.root,
    postPath: join(ctx.root, "src/content/posts/article.md"),
    slug: "article",
    runImage: async ({ path }) => writeFile(path, png),
    runJudge: bodyJudge,
  });
  const installed = await readFile(
    join(ctx.root, "src/content/posts/article.md"),
  );
  return {
    path: "src/content/posts/article.md",
    sha256: hashText(installed.toString("utf8")),
  };
}

test("extractArticleSignals pulls structure, not just a prefix slice", () => {
  const signals = extractArticleSignals(post);
  assert.ok(signals.title);
  assert.ok(signals.headings.length >= 3);
  assert.ok(signals.firstSections.length >= 1);
  const input = buildBriefInput({ signals, notesText: "dossier" });
  for (const needle of [
    signals.title,
    "소제목 목록",
    "첫 3개 주요 섹션",
    "dossier",
  ])
    assert.ok(input.includes(needle), needle);
});

test("parseVisualBrief validates schema strictly", () => {
  const brief = parseVisualBrief(briefJson);
  assert.equal(brief.mustShow.length, 3);
  assert.equal(brief.evidenceMode, "illustration");
  for (const bad of [
    { ...JSON.parse(briefJson), mustShow: ["하나"] },
    { ...JSON.parse(briefJson), evidenceMode: "screenshot" },
    { ...JSON.parse(briefJson), extra: true },
    { ...JSON.parse(briefJson), imageRoles: { main: "x" } },
    "not json",
  ])
    assert.throws(() => parseVisualBrief(JSON.stringify(bad)));
  const numeric = JSON.parse(briefJson);
  numeric.imageRoles.main = "가격 149파운드 표지판";
  assert.throws(() => parseVisualBrief(JSON.stringify(numeric)));
});

test("visual judge parsers enforce observed elements and thresholds", () => {
  const parsed = parseVisualJudgeScores(visualJudgePass);
  assert.equal(parsed.semantic, 93);
  assert.equal(parsed.craft, 88);
  for (const bad of [
    "관찰된 요소: x\n의미 적합도: 89/100\n시각 완성도: 90/100\n치명적 결함: 없음",
    "관찰된 요소: x\n의미 적합도: 95/100\n시각 완성도: 84/100\n치명적 결함: 없음",
    "관찰된 요소: x\n의미 적합도: 95/100\n시각 완성도: 90/100\n치명적 결함: 있음",
    "의미 적합도: 95/100\n시각 완성도: 90/100\n치명적 결함: 없음",
    "관찰된 요소: x\n의미 적합도: 95/100\n치명적 결함: 없음",
  ])
    assert.throws(() => parseVisualJudgeScores(bad));
  const bundle = parseVisualBundleScore(bundleJudgePass);
  assert.equal(bundle.bundle, 92);
  for (const bad of [
    "관찰된 요소: x\n번들 점수: 89/100\n치명적 결함: 없음",
    "관찰된 요소: x\n번들 점수: 92/100\n치명적 결함: 있음",
    "번들 점수: 92/100\n치명적 결함: 없음",
  ])
    assert.throws(() => parseVisualBundleScore(bad));
});

test("visual prompts carry article-specific elements and bans", () => {
  const brief = parseVisualBrief(briefJson);
  const prompts = buildVisualImagePrompts({
    brief,
    roles: ["main", "sub-1", "sub-2"],
  });
  for (const role of ["main", "sub-1", "sub-2"]) {
    const prompt = prompts[role];
    assert.ok(prompt.includes(brief.imageRoles[role]));
    assert.ok(prompt.includes("검색 결과 목록"));
    assert.ok(prompt.includes("장식용 돋보기"));
    assert.ok(prompt.includes("no letters, words, numbers"));
    assert.ok(prompt.includes("80%"));
  }
  assert.notEqual(prompts.main, prompts["sub-1"]);
});

test("regen installs new PNGs only after all visual gates pass", async (t) => {
  const ctx = await setup(t);
  const entry = await installBaseline(ctx);
  const imageCalls = [];
  const judgeCalls = [];
  const result = await regenOneBundle({
    root: ctx.root,
    entry,
    runImage: async ({ path, role }) => {
      imageCalls.push(role);
      await writeFile(path, png2);
    },
    runBrief: async () => briefJson,
    runVisualJudge: async ({ imagePaths }) => {
      judgeCalls.push(imagePaths.length);
      return imagePaths.length === 3 ? bundleJudgePass : visualJudgePass;
    },
  });
  assert.equal(result.bundleResult.bundle, 92);
  assert.deepEqual(imageCalls, ["main", "sub-1", "sub-2"]);
  assert.equal(judgeCalls.filter((n) => n === 1).length, 3);
  assert.equal(judgeCalls.filter((n) => n === 3).length, 1);
  const newBytes = await readFile(
    join(ctx.root, "public/images/article-main.png"),
  );
  assert.equal(hashText(newBytes), hashText(png2));
  const journal = JSON.parse(
    (await readFile(
      join(ctx.root, "out/image-bundles/article/transaction.json"),
    )).toString("utf8"),
  );
  assert.equal(journal.visual.bundleScore, 92);
  assert.equal(journal.visual.images.main.sha256, hashText(png2));
  assert.ok(journal.visual.images.main.previousSha256);
});

test("visual judge failure leaves installed bytes and post untouched", async (t) => {
  const ctx = await setup(t);
  const entry = await installBaseline(ctx);
  const beforePost = await readFile(
    join(ctx.root, "src/content/posts/article.md"),
  );
  const beforePng = await readFile(
    join(ctx.root, "public/images/article-main.png"),
  );
  await assert.rejects(
    regenOneBundle({
      root: ctx.root,
      entry,
      runImage: async ({ path }) => writeFile(path, png2),
      runBrief: async () => briefJson,
      runVisualJudge: async () =>
        "관찰된 요소: x\n의미 적합도: 70/100\n시각 완성도: 60/100\n치명적 결함: 있음",
    }),
  );
  assert.deepEqual(
    await readFile(join(ctx.root, "src/content/posts/article.md")),
    beforePost,
  );
  assert.deepEqual(
    await readFile(join(ctx.root, "public/images/article-main.png")),
    beforePng,
  );
});

test("regen refuses posts without a committed bundle and judges that cannot see PNGs", async (t) => {
  const ctx = await setup(t);
  await assert.rejects(
    regenOneBundle({
      root: ctx.root,
      entry: ctx.entry,
      runImage: async () => {},
      runBrief: async () => briefJson,
      runVisualJudge: async () => visualJudgePass,
    }),
    /committed image bundle/,
  );
  const entry = await installBaseline(ctx);
  await assert.rejects(
    regenOneBundle({
      root: ctx.root,
      entry,
      runImage: async ({ path }) => writeFile(path, png2),
      runBrief: async () => briefJson,
      runVisualJudge: async () => {
        throw Error("codex exec failed (exit 2); no retry");
      },
    }),
  );
});

test("arg parsing requires approved list and validates sub-count", () => {
  assert.throws(() => parseImageRegenArgs([]));
  assert.throws(() => parseImageRegenArgs(["--approved", "x", "--sub-count", "5"]));
  const args = parseImageRegenArgs([
    "--approved",
    "out/keyword-recovery/x.json",
    "--dry-run",
  ]);
  assert.equal(args.dryRun, true);
});
