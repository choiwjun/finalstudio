import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseAutoPublishArgs, preparePublishedPost } from "./auto-publish.mjs";

test("auto-publish defaults to all ready candidates and separates dry-run from publish", () => {
  const args = parseAutoPublishArgs(["--publish"]);

  assert.equal(args.publish, true);
  assert.equal(args.dryRun, false);
  assert.equal(args.limitPerCategory, Number.MAX_SAFE_INTEGER);
  assert.throws(
    () => parseAutoPublishArgs(["--dry-run", "--publish"]),
    /cannot be combined/iu,
  );
});

test("blocks publication when the image bundle is incomplete", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "wj-auto-publish-images-"));
  const postPath = join(root, "post.md");
  await writeFile(
    postPath,
    '---\ntitle: "이미지 누락"\nstatus: draft\n---\n\n본문\n',
    "utf8",
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await preparePublishedPost(postPath, "WJ Blog", undefined, {
    root,
  });
  assert.equal(result.published, false);
  assert.match(result.blocked.join(" "), /image bundle/iu);
});

test("promotes a complete safe article only after content validation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "wj-auto-publish-"));
  const postPath = join(root, "post.md");
  const body = `${"자동 게시 검사를 통과하는 본문입니다. 조건과 근거를 분리해 설명합니다. ".repeat(60)}\n`;
  await writeFile(
    postPath,
    `---\ntitle: "자동 게시 테스트"\ndescription: "충분한 설명입니다."\npubDate: 2026-09-11\nstatus: draft\ntopic: ai\nangle: "검증 기준"\nauthor: TBD\nimage: /images/post-main.png\n---\n\n![첫 이미지](/images/post-sub-1.png)\n\n${body}`,
    "utf8",
  );
  await mkdir(join(root, "public/images"), { recursive: true });
  const imageBundle = {
    images: [
      {
        role: "main",
        path: join(root, "public/images/post-main.png"),
        publicPath: "/images/post-main.png",
      },
      {
        role: "sub-1",
        path: join(root, "public/images/post-sub-1.png"),
        publicPath: "/images/post-sub-1.png",
      },
    ],
  };
  for (const image of imageBundle.images) await writeFile(image.path, "png");
  t.after(() => rm(root, { recursive: true, force: true }));

  imageBundle.postPath = postPath;
  const result = await preparePublishedPost(postPath, "WJ Blog", imageBundle, {
    root,
  });

  assert.equal(result.published, true);
  assert.match(result.text, /^status: published$/mu);
  assert.match(result.text, /^author: WJ Blog$/mu);
  assert.match(result.text, /^testedAt: /mu);
  assert.match(await readFile(postPath, "utf8"), /^status: draft$/mu);
});
