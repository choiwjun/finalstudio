import { createHash } from "node:crypto";

// Deterministic SVG diagrams.
// Every rendered label must be a verbatim substring of the post body — the
// builder refuses any text it cannot verify against the source bytes, so a
// diagram can never state a fact the article does not contain.

const hashText = (value) =>
  createHash("sha256").update(value).digest("hex");

const W = 1200;
const H = 800;

const PALETTE = Object.freeze({
  bg: "#fbf7f0",
  ink: "#2f2a24",
  muted: "#6b6154",
  line: "#d9cfc0",
  a: "#b4530a",
  b: "#1f6f8b",
  c: "#4a7c59",
  accent: "#8a5a2b",
});

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cleanItem(raw) {
  return String(raw)
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[`*_]/gu, "")
    .replace(/^\s*(?:\d+\.|[-*])\s+/u, "")
    .replace(/^["'“”‘’\s,;:]+|["'“”‘’\s,;:]+$/gu, "")
    .trim();
}

function truncateLabel(text, max = 18) {
  const t = String(text).trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > 6 ? cut.slice(0, space) : cut).trim();
}

function verbatim(label, postText) {
  const t = String(label).trim();
  return t.length > 0 && postText.includes(t);
}

// rough glyph-width estimate: hangul/cjk ≈ 1em, ascii ≈ .55em, space ≈ .4em
function estWidth(text, size) {
  let w = 0;
  for (const ch of String(text)) {
    if (/[가-힯ㄱ-ㆎ぀-ヿ一-鿿]/u.test(ch)) w += size;
    else if (/\s/u.test(ch)) w += size * 0.4;
    else w += size * 0.55;
  }
  return w;
}

// Greedy word-wrap. Every output line stays a contiguous substring of the
// original label, so verbatim binding is preserved.
function wrapLabel(label, maxWidth, size, maxLines = 2) {
  const words = String(label).split(/\s+/u).filter(Boolean);
  if (!words.length) return [];
  const lines = [""];
  for (const word of words) {
    const candidate = lines[lines.length - 1]
      ? `${lines[lines.length - 1]} ${word}`
      : word;
    if (estWidth(candidate, size) <= maxWidth || !lines[lines.length - 1])
      lines[lines.length - 1] = candidate;
    else lines.push(word);
  }
  return lines;
}

function pickLabels(candidates, postText, { max = 3, maxLen = 18 } = {}) {
  const out = [];
  const seen = new Set();
  const isMarker = (label) =>
    /\[직접|확인 필요\]|확인 필요:|TODO|TBD/u.test(label);
  const push = (label) => {
    if (!label || seen.has(label) || isMarker(label)) return false;
    if (!verbatim(label, postText)) return false;
    seen.add(label);
    out.push(label);
    return out.length >= max;
  };
  // prefer whole phrases that fit — they read as complete labels
  for (const raw of candidates) {
    const cleaned = cleanItem(raw);
    if (cleaned && cleaned.length <= maxLen && push(cleaned)) return out;
  }
  // fall back to boundary-truncated fragments only if nothing whole fits
  for (const raw of candidates) {
    const cleaned = cleanItem(raw);
    if (cleaned && push(truncateLabel(cleaned, maxLen))) return out;
  }
  return out;
}

function tableCells(sectionBody) {
  const tables =
    sectionBody.match(/^\|.+\|$(?:\r?\n^\|[\s:|-]+\|$)(?:\r?\n^\|.+\|$)*/gmu) ??
    [];
  // data rows only — skip header row and separator row of each table
  return tables.flatMap((table) =>
    table
      .split(/\r?\n/u)
      .slice(2)
      .flatMap((row) =>
        row
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim())
          .filter(Boolean),
      ),
  );
}

function boldPhrases(sectionBody) {
  return [...sectionBody.matchAll(/\*\*([^*]{2,40})\*\*/gu)].map(
    (m) => m[1],
  );
}

function sectionItems(sectionBody) {
  return (
    sectionBody.match(/^(?:\d+\.|[-*])\s+.+$/gmu) ?? []
  ).slice(0, 6);
}

function sectionSentences(sectionBody) {
  return (sectionBody.match(/[^.\n|]{8,60}\./gu) ?? []).map((s) =>
    s.trim(),
  );
}

// Build the per-role diagram spec from the article's own structure.
// Returns { spec, labels } where labels is every string that will be rendered.
export function buildDiagramSpec({ signals, postText }) {
  if (!signals || typeof postText !== "string")
    throw Error("diagram spec requires signals and post text");
  const title = cleanItem(signals.title || "");
  if (!verbatim(title, postText)) throw Error("diagram title not verbatim");

  const sections = signals.firstSections ?? [];
  const roles = {};

  // skip pure summary/misc sections — the flow should mirror the article's
  // actual data→trend→verification structure, not its recap.
  const isSummary = (heading) =>
    /핵심|요약|답변|한눈에|오류|FAQ|자주|판단 기준/u.test(heading);
  const core = sections.filter((s) => !isSummary(s.heading));
  const flowSecs = (core.length >= 2 ? core : sections).slice(0, 3);

  // main — up to 3 columns, one per leading section, connected left→right.
  const mainCols = flowSecs.map((section) => {
    const heading = cleanItem(section.heading);
    if (!verbatim(heading, postText))
      throw Error(`diagram heading not verbatim: ${heading}`);
    const items = pickLabels(
      [
        ...tableCells(section.body),
        ...boldPhrases(section.body),
        ...sectionItems(section.body),
        ...sectionSentences(section.body),
      ],
      postText,
      { max: 3, maxLen: 26 },
    );
    return { heading, items };
  });
  if (mainCols.length < 2)
    throw Error("diagram requires at least two sections");
  roles.main = { kind: "flow", title, cols: mainCols };

  // sub-1 — comparison frame: first two core sections side by side.
  const cmpCols = flowSecs.slice(0, 2).map((section) => {
    const heading = cleanItem(section.heading);
    if (!verbatim(heading, postText))
      throw Error(`diagram heading not verbatim: ${heading}`);
    const items = pickLabels(
      [
        ...tableCells(section.body),
        ...boldPhrases(section.body),
        ...sectionItems(section.body),
        ...sectionSentences(section.body),
      ],
      postText,
      { max: 3, maxLen: 32 },
    );
    return { heading, items };
  });
  roles["sub-1"] = {
    kind: "compare",
    title,
    left: cmpCols[0],
    right: cmpCols[1] ?? cmpCols[0],
  };

  // sub-2 — procedure: prefer the article's own verify/order section, then
  // any numbered steps, in order.
  const stepSecs = sections.filter((s) =>
    /순서|확인|절차|단계|방법/u.test(s.heading),
  );
  const steps = pickLabels(
    [
      ...stepSecs.flatMap((s) => sectionItems(s.body)),
      ...sections.flatMap((s) => sectionItems(s.body)),
    ],
    postText,
    { max: 4, maxLen: 60 },
  );
  if (steps.length < 2) {
    const fall = pickLabels(
      [
        ...stepSecs.flatMap((s) => sectionSentences(s.body)),
        ...sections.flatMap((s) => sectionSentences(s.body)),
      ],
      postText,
      { max: 4, maxLen: 60 },
    );
    if (fall.length < 2) throw Error("diagram requires at least two steps");
    steps.push(...fall);
  }
  roles["sub-2"] = { kind: "steps", title, steps };

  const labels = [
    title,
    ...mainCols.flatMap((c) => [c.heading, ...c.items]),
    ...cmpCols.flatMap((c) => [c.heading, ...c.items]),
    ...steps,
    // ordered-badge digits rendered by compare/steps layouts
    ...["1", "2", "3", "4"].slice(
      0,
      Math.max(
        cmpCols[0]?.items.length ?? 0,
        cmpCols[1]?.items.length ?? 0,
        steps.length,
      ),
    ),
  ];
  for (const label of labels)
    if (!verbatim(label, postText))
      throw Error(`diagram label not verbatim: ${label}`);

  return Object.freeze({
    spec: Object.freeze({ title, roles: Object.freeze(roles) }),
    labels: Object.freeze([...new Set(labels)]),
    specHash: hashText(JSON.stringify(roles)),
  });
}

function panel(x, y, w, h, color) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#fffdf8" stroke="${color}" stroke-width="2.5"/>`;
}

function text(x, y, value, { size = 22, fill = PALETTE.ink, bold = false, anchor = "start" } = {}) {
  return `<text x="${x}" y="${y}" font-family="Malgun Gothic, 맑은 고딕" font-size="${size}" fill="${fill}" font-weight="${bold ? "700" : "400"}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
}

function arrow(x1, y1, x2, y2, color) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const hx = x2 - 14 * Math.cos(a);
  const hy = y2 - 14 * Math.sin(a);
  const p1 = `${hx + 8 * Math.cos(a + 2.4)},${hy + 8 * Math.sin(a + 2.4)}`;
  const p2 = `${hx + 8 * Math.cos(a - 2.4)},${hy + 8 * Math.sin(a - 2.4)}`;
  return `<line x1="${x1}" y1="${y1}" x2="${hx}" y2="${hy}" stroke="${color}" stroke-width="3"/><polygon points="${x2},${y2} ${p1} ${p2}" fill="${color}"/>`;
}

function badge(cx, cy, r, color, label) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/><text x="${cx}" y="${cy + 7}" font-family="Malgun Gothic" font-size="${r}" fill="#fffdf8" font-weight="700" text-anchor="middle">${escapeXml(label)}</text>`;
}

function iconCard(x, y, color) {
  return `<rect x="${x}" y="${y}" width="44" height="30" rx="4" fill="none" stroke="${color}" stroke-width="2.5"/><rect x="${x + 6}" y="${y - 8}" width="44" height="30" rx="4" fill="#fffdf8" stroke="${color}" stroke-width="2.5"/><line x1="${x + 12}" y1="${y + 5}" x2="${x + 44}" y2="${y + 5}" stroke="${color}" stroke-width="2"/><line x1="${x + 12}" y1="${y + 13}" x2="${x + 38}" y2="${y + 13}" stroke="${color}" stroke-width="2"/>`;
}

function iconGauge(x, y, color) {
  return `<path d="M ${x} ${y + 20} A 26 26 0 0 1 ${x + 52} ${y + 20}" fill="none" stroke="${color}" stroke-width="3"/><line x1="${x + 26}" y1="${y + 20}" x2="${x + 40}" y2="${y + 2}" stroke="${color}" stroke-width="3"/><circle cx="${x + 26}" cy="${y + 20}" r="4" fill="${color}"/>`;
}

function iconCheck(x, y, color) {
  return `<circle cx="${x + 16}" cy="${y + 16}" r="16" fill="none" stroke="${color}" stroke-width="3"/><polyline points="${x + 7},${y + 16} ${x + 14},${y + 24} ${x + 26},${y + 9}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round"/>`;
}

function iconList(x, y, color) {
  return `<rect x="${x}" y="${y}" width="34" height="42" rx="4" fill="none" stroke="${color}" stroke-width="2.5"/><line x1="${x + 7}" y1="${y + 11}" x2="${x + 27}" y2="${y + 11}" stroke="${color}" stroke-width="2"/><line x1="${x + 7}" y1="${y + 21}" x2="${x + 27}" y2="${y + 21}" stroke="${color}" stroke-width="2"/><line x1="${x + 7}" y1="${y + 31}" x2="${x + 22}" y2="${y + 31}" stroke="${color}" stroke-width="2"/>`;
}

const ICONS = [iconCard, iconGauge, iconCheck, iconList];

// All three layouts keep every glyph inside the 390px center band
// (x ∈ [405,795]) so even a strict center crop preserves the content.
const CX0 = 405;
const CX1 = 795;
const CX = (CX0 + CX1) / 2;

function titleParts(title) {
  const lines = wrapLabel(title, CX1 - CX0 - 60, 26, 2);
  const size = lines.length === 1 ? 28 : 24;
  const bandH = lines.length === 1 ? 88 : 116;
  return {
    height: bandH,
    parts: [
      `<rect x="0" y="0" width="${W}" height="${bandH}" fill="${PALETTE.accent}"/>`,
      ...lines.map((line, i) =>
        text(CX, (lines.length === 1 ? 56 : 42) + i * 34, line, {
          size,
          fill: "#fffdf8",
          bold: true,
          anchor: "middle",
        }),
      ),
    ],
  };
}

// Vertical timeline/spine flow — heading + item chips hang to the right of
// each node; everything stays inside the center band for crop safety.
function renderFlow({ title, cols }) {
  const colors = [PALETTE.a, PALETTE.b, PALETTE.c];
  const n = cols.length;
  const t = titleParts(title);
  const top = t.height + 30;
  const bandH = (H - top - 40) / n;
  const parts = [
    `<rect width="${W}" height="${H}" fill="${PALETTE.bg}"/>`,
    ...t.parts,
    `<line x1="${CX0 + 30}" y1="${top + 10}" x2="${CX0 + 30}" y2="${top + bandH * n - 10}" stroke="${PALETTE.accent}" stroke-width="3"/>`,
  ];
  cols.forEach((col, i) => {
    const color = colors[i % colors.length];
    const bandTop = top + bandH * i;
    const cy = bandTop + bandH / 2;
    parts.push(`<circle cx="${CX0 + 30}" cy="${cy}" r="16" fill="${color}"/>`);
    const headingLines = wrapLabel(col.heading, CX1 - CX0 - 80, 18);
    headingLines.forEach((line, li) => {
      parts.push(
        text(CX0 + 66, bandTop + 24 + li * 22, line, {
          size: 18,
          fill: color,
          bold: true,
        }),
      );
    });
    // items as compact text lines — higher verbatim-label density than boxed
    // chips, which is what the semantic gate measures
    let iy = bandTop + 30 + headingLines.length * 22;
    col.items.slice(0, 3).forEach((item) => {
      const lines = wrapLabel(item, CX1 - CX0 - 150, 15);
      parts.push(
        `<circle cx="${CX0 + 78}" cy="${iy - 5}" r="3" fill="${color}"/>`,
      );
      lines.forEach((line, li) => {
        parts.push(
          text(CX0 + 90, iy + li * 20, line, { size: 15 }),
        );
      });
      iy += lines.length * 20 + 8;
    });
    if (i < n - 1)
      parts.push(
        arrow(CX0 + 30, cy + 22, CX0 + 30, bandTop + bandH - 22, PALETTE.accent),
      );
  });
  return parts.join("\n");
}

// Vertical stacked compare — keeps every label inside the center band so a
// narrow center crop still shows the content.
function renderCompare({ title, left, right }) {
  const t = titleParts(title);
  const top = t.height + 20;
  const groupH = (H - top - 40) / 2 - 12;
  const groups = [
    { col: left, color: PALETTE.a, top },
    { col: right, color: PALETTE.b, top: top + groupH + 24 },
  ];
  const parts = [
    `<rect width="${W}" height="${H}" fill="${PALETTE.bg}"/>`,
    ...t.parts,
  ];
  groups.forEach(({ col, color, top: gy }) => {
    parts.push(panel(CX0, gy, CX1 - CX0, groupH, color));
    const headingLines = wrapLabel(col.heading, CX1 - CX0 - 50, 19);
    headingLines.forEach((line, li) => {
      parts.push(
        text(CX, gy + 26 + li * 24, line, {
          size: 19,
          fill: color,
          bold: true,
          anchor: "middle",
        }),
      );
    });
    const itemsTop = gy + 34 + headingLines.length * 24;
    const itemH = (gy + groupH - 10 - itemsTop) / 3 - 6;
    col.items.slice(0, 3).forEach((item, j) => {
      const iy = itemsTop + j * (itemH + 6);
      parts.push(
        `<rect x="${CX0 + 20}" y="${iy}" width="${CX1 - CX0 - 40}" height="${itemH}" rx="9" fill="${PALETTE.bg}" stroke="${PALETTE.line}" stroke-width="1.5"/>`,
      );
      parts.push(badge(CX0 + 46, iy + itemH / 2, 13, color, String(j + 1)));
      const lines = wrapLabel(item, CX1 - CX0 - 110, 16, 2);
      const ty = iy + (lines.length === 1 ? itemH / 2 + 5 : itemH / 2 - 4);
      lines.forEach((line, li) => {
        parts.push(text(CX + 14, ty + li * 20, line, { size: 16, anchor: "middle" }));
      });
    });
  });
  return parts.join("\n");
}

function renderSteps({ title, steps }) {
  const t = titleParts(title);
  const top = t.height + 20;
  const rowH = Math.min(130, (H - top - 40) / steps.length - 14);
  const parts = [
    `<rect width="${W}" height="${H}" fill="${PALETTE.bg}"/>`,
    ...t.parts,
  ];
  steps.forEach((step, i) => {
    const y = top + i * (rowH + 14);
    const color = [PALETTE.a, PALETTE.b, PALETTE.c, PALETTE.accent][i % 4];
    parts.push(panel(CX0, y, CX1 - CX0, rowH, color));
    parts.push(badge(CX0 + 44, y + rowH / 2, 21, color, String(i + 1)));
    const lines = wrapLabel(step, CX1 - CX0 - 115, 18);
    const ty = y + rowH / 2 - ((lines.length - 1) * 24) / 2 + 6;
    lines.forEach((line, li) => {
      parts.push(text(CX0 + 85, ty + li * 24, line, { size: 18 }));
    });
    if (i < steps.length - 1)
      parts.push(
        arrow(CX0 + 44, y + rowH + 2, CX0 + 44, y + rowH + 12, PALETTE.accent),
      );
  });
  return parts.join("\n");
}

export function renderDiagramSvg(roleSpec) {
  const body =
    roleSpec.kind === "flow"
      ? renderFlow(roleSpec)
      : roleSpec.kind === "compare"
        ? renderCompare(roleSpec)
        : renderSteps(roleSpec);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n${body}\n</svg>\n`;
}
