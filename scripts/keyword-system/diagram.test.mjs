import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildDiagramSpec, renderDiagramSvg } from "./lib/diagram.mjs";
import { extractArticleSignals } from "./lib/visual-brief.mjs";

const post = await readFile(
  new URL("./test-fixtures/image-article.md", import.meta.url),
  "utf8",
);
const signals = extractArticleSignals(post);

test("diagram labels stay verbatim with no markdown or url residue", () => {
  const { labels } = buildDiagramSpec({ signals, postText: post });
  assert.ok(labels.length > 0);
  for (const label of labels) {
    assert.ok(post.includes(label), `label not verbatim: ${label}`);
    assert.ok(!/[\[\]]/u.test(label), `bracket residue in label: ${label}`);
    assert.ok(
      !/https?:|www\.|[a-z0-9-]+\.(?:com|net|kr)\b/iu.test(label),
      `url residue in label: ${label}`,
    );
    assert.equal(
      (label.match(/\(/gu) ?? []).length,
      (label.match(/\)/gu) ?? []).length,
      `unbalanced parens in label: ${label}`,
    );
  }
});

test("link table cells reduce to link text, not truncated link syntax", () => {
  const { labels } = buildDiagramSpec({ signals, postText: post });
  assert.ok(!labels.some((label) => label.includes("](")));
  assert.ok(!labels.some((label) => label.includes("blog.")));
});

test("every role spec renders an svg without raw markdown syntax", () => {
  const { spec } = buildDiagramSpec({ signals, postText: post });
  for (const role of ["main", "sub-1", "sub-2"]) {
    const svg = renderDiagramSvg(spec.roles[role]);
    assert.ok(svg.includes("<svg"), `${role} did not render`);
    assert.ok(!svg.includes("]("), `${role} rendered markdown link syntax`);
    assert.ok(!svg.includes("https://"), `${role} rendered a raw url`);
  }
});
