import assert from "node:assert/strict";
import { test } from "node:test";
import {
 cp,
 mkdir,
 mkdtemp,
 readFile,
 readdir,
 realpath,
 rm,
 symlink,
 writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { generateImageBundle } from "./lib/image-bundle.mjs";
const repository = fileURLToPath(new URL("../../", import.meta.url));

async function linkFixtureDependencies(root) {
 const source = join(repository, "node_modules");
 const destination = join(root, "node_modules");
 await mkdir(destination);
 // Reuse packages, never the mutable dependency root or its hidden caches.
 for (const entry of await readdir(source, { withFileTypes: true })) {
  if (
   entry.name.startsWith(".") ||
   (!entry.isDirectory() && !entry.isSymbolicLink())
  )
   continue;
  await symlink(join(source, entry.name), join(destination, entry.name), "dir");
 }
}

async function assertPrivateDependencyRoot(root) {
 assert.equal(
  await realpath(join(root, "node_modules")),
  join(await realpath(root), "node_modules"),
  "The dependency root must be fixture-local before any build or cache write",
 );
}

test("dependency caches remain fixture-local before a build", async (t) => {
 const root = await mkdtemp(join(tmpdir(), "image-cache-isolation-"));
 t.after(() => rm(root, { recursive: true, force: true }));
 await linkFixtureDependencies(root);
 await assertPrivateDependencyRoot(root);
 for (const name of [".astro", ".vite", ".vite-temp"]) {
  const cache = join(root, "node_modules", name);
  await mkdir(cache, { recursive: true });
  assert.equal(
   await realpath(cache),
   join(await realpath(root), "node_modules", name),
  );
  const marker = join(cache, "fixture-only.txt");
  await writeFile(marker, "private cache");
  assert.equal(await readFile(marker, "utf8"), "private cache");
 }
});

test("isolated actual Astro build renders normalized draft fixture with decoded images and passes build boundary", async (t) => {
 const root = await mkdtemp(join(tmpdir(), "image-build-"));
 t.after(() => rm(root, { recursive: true, force: true }));
 await mkdir(join(root, "src/content/posts"), { recursive: true });
 await mkdir(join(root, "src/pages"), { recursive: true });
 await linkFixtureDependencies(root);
 await assertPrivateDependencyRoot(root);
 await cp(
  join(repository, "src/content.config.ts"),
  join(root, "src/content.config.ts"),
 );
 await writeFile(join(root, "package.json"), '{"type":"module"}\n');
 const cacheDir = join(root, ".build-cache", "astro");
 const viteCacheDir = join(root, ".build-cache", "vite");
 await writeFile(
  join(root, "astro.config.mjs"),
  `export default ${JSON.stringify({
   output: "static",
   cacheDir,
   vite: { cacheDir: viteCacheDir },
  })};\n`,
 );
 await writeFile(
  join(root, "src/pages/index.astro"),
  `---\nimport{getCollection,render}from'astro:content';\nconst entries=await getCollection('posts');const{Content}=await render(entries[0]);\n---\n<html lang="ko"><head><title>Isolated image contract</title></head><body><Content /></body></html>\n`,
 );
 const original = await readFile(
  new URL("./test-fixtures/image-article.md", import.meta.url),
  "utf8",
 );
 const postPath = join(root, "src/content/posts/article.md");
 await writeFile(postPath, original + "\n![실제 화면](placeholder)\n");
 const png = await sharp({
  create: { width: 32, height: 24, channels: 3, background: "#abcdef" },
 })
  .png()
  .toBuffer();
 await generateImageBundle({
  root,
  postPath,
  slug: "article",
  runImage: ({ path }) => writeFile(path, png),
  runJudge: async () => "치명적 결함: 없음\n총점: 94/100",
 });
 const run = promisify(execFile);
 const built = await run(
  process.execPath,
  [join(repository, "node_modules/astro/bin/astro.mjs"), "build"],
  {
   cwd: root,
   timeout: 180000,
   env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
  },
 );
 assert.match(built.stdout, /Complete|built/iu);
 assert.equal(
  await realpath(join(cacheDir, "data-store.json")),
  join(await realpath(root), ".build-cache", "astro", "data-store.json"),
  "The actual content store must be written inside the isolated fixture",
 );
 const html = await readFile(join(root, "dist/index.html"), "utf8");
 assert.ok(html.includes("/images/article-sub-1.png"));
 assert.ok(html.includes("AI 생성 일러스트"));
 assert.ok(html.includes("실제 화면 확보 대기"));
 assert.ok(!html.includes('src="placeholder"'));
 const checked = await run(
  process.execPath,
  [join(repository, "scripts/check-build.mjs")],
  { cwd: root, timeout: 10000 },
 );
 assert.match(checked.stdout, /Build boundary OK/);
});
