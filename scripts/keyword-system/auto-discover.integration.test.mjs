import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "./auto-discover.mjs";
import { fixturePath } from "./test-helpers.mjs";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("automatically discovers category topics and collects canonical evidence without writing posts", async () => {
  const root = await mkdtemp("/tmp/wj-keyword-auto-");
  const outDir = join(root, "data", "keywords");
  await mkdir(outDir, { recursive: true });

  try {
    const result = await main([
      "--fixture",
      fixturePath("blog-success.json"),
      "--out-dir",
      outDir,
      "--max-candidates",
      "2",
    ]);
    const manifest = await readJson(join(outDir, "automatic-discovery.json"));
    const collection = await readJson(join(outDir, "collection.json"));
    const records = await readJson(join(outDir, "records.json"));

    assert.equal(result.seedDocument.inputs.length, 6);
    assert.equal(manifest.schema_version, 1);
    assert.equal(manifest.categories.length, 3);
    assert.equal(manifest.categories[0].response.items.length, 2);
    const discoveryResponseHash = createHash("sha256")
      .update(JSON.stringify(manifest.categories[0].response))
      .digest("hex");
    assert.equal(
      manifest.categories[0].discovery_response_sha256,
      discoveryResponseHash,
    );
    assert.equal(
      manifest.categories[0].candidates[0].discovery_response_sha256,
      manifest.categories[0].discovery_response_sha256,
    );
    assert.equal(collection.candidates.length, 6);
    assert.equal(
      records.every((record) => record.status === "researching"),
      true,
    );
    assert.equal(
      records.some((record) => record.status === "written"),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
