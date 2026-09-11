import { existsSync } from "node:fs";
import { lstat, mkdtemp, rename, rm } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { basename, dirname, join, relative, resolve } from "node:path";
import { buildWriterEnvironment } from "../../auto-publish/writer-env.mjs";
import { parseFrontmatter } from "../../lib/content-contract.mjs";
import {
  assertRegularFileAtDirectory,
  directoryFdPath,
  openVerifiedDirectory,
  readFileAtDirectory,
  writeStableTextAtDirectory,
} from "./file-lock.mjs";

const IMAGE_ROLES = Object.freeze(["main", "sub-1", "sub-2"]);
const IMAGE_PROMPT_LIMIT = 2_000;
const clean = (value) =>
  String(value ?? "")
    .replace(/[\r\n]/gu, " ")
    .trim();

export class ImageBundleError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImageBundleError";
    this.code = "KEYWORD_IMAGE_BUNDLE";
  }
}

const fail = (message) => {
  throw new ImageBundleError(message);
};

const sameIdentity = (left, right) =>
  left?.dev === right?.dev && left?.ino === right?.ino;

export function buildImagePrompts({ title, topic, slug } = {}) {
  const safeTitle = clean(title);
  const safeTopic = clean(topic);
  const safeSlug = clean(slug);
  if (safeTitle === "" || safeTopic === "" || safeSlug === "") {
    fail("image prompts require title, topic, and slug");
  }
  const base = [
    "Original editorial illustration for a Korean personal blog.",
    `Topic: ${JSON.stringify(safeTopic)}. Article: ${JSON.stringify(safeTitle)}.`,
    "The orchestrator supplies a private output path; do not write directly to repository public/images.",
    "No letters, words, numbers, logos, trademarks, watermarks, or readable screens.",
    "Do not create fake UI screenshots or claim a real place/photo was captured.",
    "Warm paper-white palette, one restrained accent color, clean composition, 3:2 landscape, no people.",
  ].join(" ");
  const prompts = {
    main: `${base} Create the primary cover image: one clear visual metaphor for the article's central question.`,
    "sub-1": `${base} Create a supporting image showing the article's first practical decision or comparison.`,
    "sub-2": `${base} Create a supporting image showing the article's conditions, checklist, or next action.`,
  };
  for (const prompt of Object.values(prompts)) {
    if (prompt.length > IMAGE_PROMPT_LIMIT)
      fail("image prompt exceeds the safety limit");
  }
  return Object.freeze(prompts);
}

function codexCommand() {
  const codexJs =
    process.platform === "win32"
      ? join(
          process.env.APPDATA ?? "",
          "npm",
          "node_modules",
          "@openai",
          "codex",
          "bin",
          "codex.js",
        )
      : [
          "/usr/local/lib/node_modules/@openai/codex/bin/codex.js",
          join(
            process.env.HOME ?? "",
            ".npm-global",
            "lib",
            "node_modules",
            "@openai",
            "codex",
            "bin",
            "codex.js",
          ),
        ].find((path) => existsSync(path));
  if (codexJs) return { executable: process.execPath, prefix: [codexJs] };
  try {
    const executable = execFileSync(
      process.platform === "win32" ? "where" : "which",
      ["codex"],
      { encoding: "utf8" },
    )
      .split(/\r?\n/u)[0]
      .trim();
    return executable ? { executable, prefix: [] } : undefined;
  } catch {
    return undefined;
  }
}

function runCodexImage({ prompt, path }) {
  if (typeof path !== "string" || path.trim() === "")
    return Promise.reject(
      new ImageBundleError("private image output path is required"),
    );
  const command = codexCommand();
  if (!command)
    return Promise.reject(
      new ImageBundleError("codex CLI가 없어 이미지를 생성할 수 없습니다."),
    );
  const args = ["exec", "--sandbox", "workspace-write", "--ephemeral"];
  if (process.env.CODEX_MODEL) args.push("-m", process.env.CODEX_MODEL);
  args.push(
    "--",
    [
      "$imagegen",
      prompt,
      `Save exactly one image to ${JSON.stringify(path)}.`,
      "이미지 파일 외에는 어떤 파일도 수정하지 마세요.",
      "저장 후 파일 경로만 답하세요.",
    ].join("\n"),
  );
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command.executable, [...command.prefix, ...args], {
      cwd: dirname(path),
      shell: false,
      env: buildWriterEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else
        rejectPromise(
          new ImageBundleError(
            `codex 이미지 생성 실패 (exit ${code}) ${stderr.slice(-500)}`,
          ),
        );
    });
  });
}

async function readVerifiedPost(postsRoot, postPath) {
  const relativePath = relative(resolve(postsRoot), resolve(postPath));
  if (relativePath === ".." || relativePath.startsWith(".."))
    fail("post path must remain inside posts root");
  const directory = await openVerifiedDirectory(dirname(postPath), {
    create: false,
  });
  try {
    return await readFileAtDirectory(directory, basename(postPath), "utf8");
  } finally {
    await directory.close().catch(() => {});
  }
}

async function writeVerifiedPost(postsRoot, postPath, text) {
  const relativePath = relative(resolve(postsRoot), resolve(postPath));
  if (relativePath === ".." || relativePath.startsWith(".."))
    fail("post path must remain inside posts root");
  const directory = await openVerifiedDirectory(dirname(postPath), {
    create: false,
  });
  try {
    await writeStableTextAtDirectory(directory, basename(postPath), text);
  } finally {
    await directory.close().catch(() => {});
  }
}

export function attachSubImages(text, { slug, images } = {}) {
  const parsed = parseFrontmatter(text);
  if (!parsed) fail("post is missing frontmatter");
  const safeSlug = clean(slug);
  const subImages = (images ?? []).filter((image) => image.role !== "main");
  if (safeSlug === "" || subImages.length < 1 || subImages.length > 2)
    fail("one or two sub-images are required");
  const marker = `<!-- wj-auto-images:${safeSlug} -->`;
  if (text.includes(marker)) return text;
  const block = [
    marker,
    ...subImages.map(
      (image, index) =>
        `![${safeSlug} 관련 이미지 ${index + 1}](${image.publicPath})`,
    ),
  ].join("\n");
  const updatedFrontmatter = parsed.set(
    "image",
    images.find((image) => image.role === "main")?.publicPath ?? "",
  );
  const header = updatedFrontmatter.match(/^---\n[\s\S]*?\n---/u)?.[0];
  if (!header) fail("post frontmatter could not be updated");
  const body = text
    .slice(parsed.raw.match(/^---\n[\s\S]*?\n---/u)?.[0].length ?? 0)
    .trimStart();
  const paragraphEnd = body.search(/\n\s*\n/u);
  const insertAt = paragraphEnd === -1 ? body.length : paragraphEnd + 2;
  const nextBody =
    `${body.slice(0, insertAt)}\n${block}\n\n${body.slice(insertAt)}`.replace(
      /\n{4,}/gu,
      "\n\n\n",
    );
  return `${header}\n\n${nextBody.trim()}\n`;
}

export async function validateImageBundle(
  bundle,
  { root = process.cwd(), postPath, postText } = {},
) {
  const images = Array.isArray(bundle?.images) ? bundle.images : [];
  const roles = images.map((image) => image?.role);
  const subImages = images.filter((image) => image?.role !== "main");
  const safePostPath = postPath ? resolve(postPath) : undefined;
  const slug = safePostPath ? basename(safePostPath, ".md") : "";
  if (
    roles.filter((role) => role === "main").length !== 1 ||
    subImages.length < 1 ||
    subImages.length > 2 ||
    new Set(roles).size !== roles.length ||
    new Set(images.map((image) => resolve(image?.path ?? ""))).size !==
      images.length ||
    roles.some((role) => !IMAGE_ROLES.includes(role)) ||
    (postPath !== undefined &&
      resolve(bundle?.postPath ?? "") !== safePostPath) ||
    (postText !== undefined && slug === "")
  ) {
    fail("image bundle must contain one main and one or two unique sub-images");
  }
  if (postText === undefined || postPath === undefined)
    fail("image bundle must be bound to the published post");
  const parsed = parseFrontmatter(postText);
  if (!parsed) fail("published post is missing frontmatter");
  const imagesRoot = resolve(root, "public/images");
  const directory = await openVerifiedDirectory(imagesRoot, { create: false });
  try {
    for (const image of images) {
      const fileName = basename(image?.path ?? "");
      const expectedPath = join(imagesRoot, fileName);
      const expectedFileName = `${slug}-${image.role}.png`;
      if (
        fileName === "" ||
        fileName !== expectedFileName ||
        resolve(image.path) !== resolve(expectedPath) ||
        image.publicPath !== `/images/${fileName}`
      ) {
        fail("image bundle path is not bound to the published post");
      }
      const file = await assertRegularFileAtDirectory(directory, fileName);
      if (file.size <= 0 || file.nlink > 1) {
        fail(`image is not a stable regular file: ${fileName}`);
      }
    }
    const main = images.find((image) => image.role === "main");
    if (parsed.get("image") !== main.publicPath)
      fail("published post frontmatter does not reference the main image");
    for (const image of subImages) {
      if (!postText.includes(`](${image.publicPath})`))
        fail("published post body does not reference every sub-image");
    }
  } finally {
    await directory.close().catch(() => {});
  }
  return true;
}

async function generateImageFile({
  imagesDirectory,
  imagesRoot,
  fileName,
  repositoryRoot,
  prompt,
  role,
  runImage,
}) {
  const directoryIdentity = await imagesDirectory.stat();
  const rootBefore = await lstat(imagesRoot);
  if (!sameIdentity(rootBefore, directoryIdentity))
    fail("image root changed before generation");
  const tempPath = await mkdtemp(join(imagesRoot, ".wj-image-"));
  const tempFileName = "output.png";
  let temporaryDirectory;
  try {
    temporaryDirectory = await openVerifiedDirectory(tempPath, {
      create: false,
    });
    const rootAfterOpen = await lstat(imagesRoot);
    if (!sameIdentity(rootAfterOpen, directoryIdentity))
      fail("image root changed during generation setup");
    await runImage({
      root: repositoryRoot,
      prompt,
      role,
      path: join(tempPath, tempFileName),
    });
    const generated = await assertRegularFileAtDirectory(
      temporaryDirectory,
      tempFileName,
    );
    if (generated.size === 0 || generated.nlink > 1)
      fail(`image was not a stable regular file: ${fileName}`);
    const rootBeforeInstall = await lstat(imagesRoot);
    if (!sameIdentity(rootBeforeInstall, directoryIdentity))
      fail("image root changed before install");
    await rename(
      join(directoryFdPath(temporaryDirectory), tempFileName),
      join(directoryFdPath(imagesDirectory), fileName),
    );
    return await assertRegularFileAtDirectory(imagesDirectory, fileName);
  } finally {
    await temporaryDirectory?.close().catch(() => {});
    await rm(tempPath, { recursive: true, force: true }).catch(() => {});
  }
}

export async function generateImageBundle({
  root,
  postPath,
  slug,
  title,
  topic,
  runImage = runCodexImage,
  imageRoles = IMAGE_ROLES,
} = {}) {
  const repositoryRoot = resolve(root ?? process.cwd());
  const postsRoot = resolve(repositoryRoot, "src/content/posts");
  const imagesRoot = resolve(repositoryRoot, "public/images");
  const safeSlug = clean(slug);
  if (safeSlug === "" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(safeSlug))
    fail("slug must be lowercase kebab-case");
  const roles = Object.freeze([...imageRoles]);
  const subRoles = roles.filter((role) => role !== "main");
  if (
    roles.filter((role) => role === "main").length !== 1 ||
    subRoles.length < 1 ||
    subRoles.length > 2 ||
    new Set(roles).size !== roles.length
  ) {
    fail("image generation requires one main and one or two unique sub-images");
  }
  const prompts = buildImagePrompts({ title, topic, slug: safeSlug });
  const imagesDirectory = await openVerifiedDirectory(imagesRoot, {
    create: true,
  });
  try {
    const images = [];
    for (const role of roles) {
      if (!IMAGE_ROLES.includes(role)) fail(`unsupported image role: ${role}`);
      const fileName = `${safeSlug}-${role}.png`;
      const absolutePath = join(imagesRoot, fileName);
      const publicPath = `/images/${fileName}`;
      const target = join(directoryFdPath(imagesDirectory), fileName);
      const existing = await lstat(target).catch((error) => {
        if (error?.code === "ENOENT") return undefined;
        throw error;
      });
      if (existing && (existing.isSymbolicLink() || !existing.isFile()))
        fail(`image target is not a regular file: ${fileName}`);
      if (!existing || existing.size === 0) {
        await generateImageFile({
          imagesDirectory,
          imagesRoot,
          fileName,
          repositoryRoot,
          prompt: prompts[role],
          role,
          runImage,
        });
      }
      const generated = await assertRegularFileAtDirectory(
        imagesDirectory,
        fileName,
      );
      if (generated.size === 0 || generated.nlink > 1)
        fail(`image was not a stable regular file: ${fileName}`);
      images.push(Object.freeze({ role, path: absolutePath, publicPath }));
    }
    const postText = await readVerifiedPost(postsRoot, postPath);
    const parsed = parseFrontmatter(postText);
    const nextText = attachSubImages(postText, { slug: safeSlug, images });
    await writeVerifiedPost(postsRoot, postPath, nextText);
    return Object.freeze({
      postPath,
      images,
      title: parsed?.get("title") ?? title,
    });
  } finally {
    await imagesDirectory.close().catch(() => {});
  }
}

export { IMAGE_ROLES };
