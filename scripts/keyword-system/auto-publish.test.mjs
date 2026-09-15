import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { main, parseAutoPublishArgs, preparePublishedPost } from "./auto-publish.mjs";

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

test("accepts an exact category and keyword selection for dashboard generation", () => {
  const args = parseAutoPublishArgs([
    "--category",
    "ai",
    "--keyword",
    "AI 데이터센터",
  ]);

  assert.equal(args.category, "ai");
  assert.equal(args.headKeyword, "AI 데이터센터");
  assert.equal(args.publish, false);
});

test("requires category and keyword together for one-click generation", () => {
  assert.throws(
    () => parseAutoPublishArgs(["--category", "ai"]),
    /--category requires --keyword/iu,
  );
  assert.throws(
    () => parseAutoPublishArgs(["--keyword", "AI"]),
    /--keyword requires --category/iu,
  );
});

test("dry-run selects exactly the requested ready candidate", async (t) => {
  const outDir = join(process.cwd(), "out");
  await mkdir(outDir, { recursive: true });
  const briefDir = await mkdtemp(join(outDir, "wj-test-briefs-"));
  t.after(() => rm(briefDir, { recursive: true, force: true }));
  await writeFile(
    join(briefDir, "ai-AI-데이터센터.json"),
    JSON.stringify({
      schema_version: 1,
      category: "ai",
      head_keyword: "AI 데이터센터",
      related_keywords: ["데이터센터 전력", "국가 AI 컴퓨팅센터"],
      search_intent: "개념",
      content_angle: "테스트용 브리프",
      collected_at: "2026-09-14T07:23:07.953Z",
      freshness: "fresh",
      source: ["naver-api-hub-blog", "naver-api-hub-trend"],
      outline: ["개요"],
      review_gate: "사람 검토 필요; 자동 작성·예약·발행 금지",
      evidence: {
        blog: [
          {
            title: "테스트 블로그",
            description: "설명",
            link: "https://blog.naver.com/test/1",
            postdate: "20260914",
            collected_at: "2026-09-14T07:23:07.953Z",
          },
        ],
        trend: [
          {
            group_name: "AI 데이터센터",
            keywords: ["AI 데이터센터"],
            latest_period: "2026-09-13",
            latest_ratio: 44.16666,
            max_ratio: 100,
            ratio_note: "상대 지표이며 절대 검색량이 아님",
            collected_at: "2026-09-14T07:23:07.953Z",
          },
        ],
      },
    }),
    "utf8",
  );
  const result = await main(
    ["--dry-run", "--category", "ai", "--keyword", "AI 데이터센터"],
    { briefDir },
  );
  assert.equal(result.manifest.candidates.length, 1);
  assert.equal(result.manifest.candidates[0].category, "ai");
  assert.equal(result.manifest.candidates[0].head_keyword, "AI 데이터센터");
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
    `---\ntitle: "자동 게시 테스트"\ndescription: "충분한 설명입니다."\npubDate: 2026-09-11\nstatus: draft\ntopic: ai\nangle: "검증 기준"\nauthor: TBD\nimage: /images/post-main.png\n---\n\n![첫 이미지](/images/post-sub-1.png)\n\n![두번째 이미지](/images/post-sub-2.png)\n\n${body}`,
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
      {
        role: "sub-2",
        path: join(root, "public/images/post-sub-2.png"),
        publicPath: "/images/post-sub-2.png",
      },
    ],
  };
  const png = await sharp({
    create: { width: 32, height: 24, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  for (const image of imageBundle.images) await writeFile(image.path, png);
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
