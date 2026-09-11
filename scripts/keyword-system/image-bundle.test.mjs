import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  attachSubImages,
  buildImagePrompts,
  generateImageBundle,
} from "./lib/image-bundle.mjs";

const post = `---
title: "제주 애월 동선"
description: "여행 동선과 현장 조건을 확인하는 글입니다."
pubDate: 2026-09-11
status: draft
topic: travel
angle: "현장 조건 중심"
author: TBD
---

제주 애월에서 무엇을 먼저 확인할지 정리합니다.

## 이동 기준

교통 조건을 확인합니다.
`;

test("builds three image prompts without fake screenshots or readable text", () => {
  const prompts = buildImagePrompts({
    title: "제주 애월 동선",
    topic: "travel",
    slug: "jeju-aewol",
  });

  assert.deepEqual(Object.keys(prompts), ["main", "sub-1", "sub-2"]);
  assert.match(prompts.main, /private output path/iu);
  assert.match(prompts["sub-1"], /readable screens/iu);
  assert.match(prompts["sub-2"], /no people/iu);
});

test("attaches one cover and two body images without duplicating a bundle", () => {
  const images = [
    { role: "main", publicPath: "/images/jeju-aewol-main.png" },
    { role: "sub-1", publicPath: "/images/jeju-aewol-sub-1.png" },
    { role: "sub-2", publicPath: "/images/jeju-aewol-sub-2.png" },
  ];
  const attached = attachSubImages(post, { slug: "jeju-aewol", images });

  assert.match(attached, /^image: \/images\/jeju-aewol-main\.png$/mu);
  assert.equal((attached.match(/wj-auto-images:jeju-aewol/gu) ?? []).length, 1);
  assert.equal(
    (attached.match(/!\[[^\]]+\]\(\/images\/jeju-aewol-sub-/gu) ?? []).length,
    2,
  );
  assert.equal(
    attachSubImages(attached, { slug: "jeju-aewol", images }),
    attached,
  );
  const oneSubImage = attachSubImages(post, {
    slug: "jeju-aewol",
    images: images.slice(0, 2),
  });
  assert.match(oneSubImage, /jeju-aewol-sub-1\.png/u);
  assert.doesNotMatch(oneSubImage, /jeju-aewol-sub-2\.png/u);
});

test("rejects a pre-existing image symlink before invoking the image runner", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "wj-image-symlink-"));
  await mkdir(join(root, "src/content/posts"), { recursive: true });
  await mkdir(join(root, "public/images"), { recursive: true });
  await writeFile(join(root, "src/content/posts/jeju-aewol.md"), post, "utf8");
  await writeFile(join(root, "outside.png"), "outside", "utf8");
  await symlink(
    join(root, "outside.png"),
    join(root, "public/images/jeju-aewol-main.png"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    () =>
      generateImageBundle({
        root,
        postPath: join(root, "src/content/posts/jeju-aewol.md"),
        slug: "jeju-aewol",
        title: "제주 애월 동선",
        topic: "travel",
        runImage: async () => {
          throw new Error("image runner must not be called");
        },
      }),
    /regular file/iu,
  );
});

test("generates the required image bundle through the injected image runner", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "wj-image-bundle-"));
  await mkdir(join(root, "src/content/posts"), { recursive: true });
  await writeFile(join(root, "src/content/posts/jeju-aewol.md"), post, "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));

  const calls = [];
  const result = await generateImageBundle({
    root,
    postPath: join(root, "src/content/posts/jeju-aewol.md"),
    slug: "jeju-aewol",
    title: "제주 애월 동선",
    topic: "travel",
    runImage: async ({ path, role }) => {
      calls.push(role);
      await mkdir(join(root, "public/images"), { recursive: true });
      await writeFile(path, Buffer.from("png-placeholder"));
    },
  });

  assert.deepEqual(calls, ["main", "sub-1", "sub-2"]);
  assert.equal(result.images.length, 3);
  assert.match(
    await readFile(join(root, "src/content/posts/jeju-aewol.md"), "utf8"),
    /jeju-aewol-sub-2\.png/u,
  );
});
