import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const workflowPath = new URL("../../.github/workflows/keyword-auto-draft.yml", import.meta.url);

test("keyword auto-draft workflow runs writing checks against generated Markdown files", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.doesNotMatch(workflow, /npm run check:writing\s*$/mu);
  assert.match(workflow, /git status --porcelain=v1 --untracked-files=all/);
  assert.match(workflow, /scripts\/check-writing\.mjs/);
});

test("keyword auto-draft workflow fails fast without an authenticated Codex runner", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, /codex login status/);
  assert.match(workflow, /command -v codex/);
});

test("keyword auto-draft workflow pins third-party actions", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.doesNotMatch(workflow, /uses:\s*actions\/(?:checkout|setup-node)@v\d+/u);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/u);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/u);
  assert.match(workflow, /runs-on:\s*\[self-hosted, linux, x64, wjblog-ai\]/u);
});
