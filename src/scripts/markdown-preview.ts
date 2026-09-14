const INTERNAL_IMAGE_MARKER_RE =
  /^\s*<!--\s*wj-(?:image-section|auto-images):.*?-->\s*$/u;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeUrl(value: string, kind: "link" | "image") {
  const candidate = value.trim();
  if (!candidate || /[\u0000-\u0020]/u.test(candidate)) return null;
  if (candidate.startsWith("/") && !candidate.startsWith("//")) {
    return candidate;
  }
  try {
    const url = new URL(
      candidate,
      typeof window === "undefined" ? "https://preview.invalid" : window.location.origin,
    );
    if (url.protocol === "http:" || url.protocol === "https:")
      return url.href;
  } catch {
    return null;
  }
  return kind === "link" && candidate.startsWith("#") ? candidate : null;
}

function renderInline(value: string) {
  const tokenRe =
    /(`[^`\n]+`|!\[[^\]\n]*\]\([^\)\n]+\)|\[[^\]\n]+\]\([^\)\n]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/gu;
  let result = "";
  let cursor = 0;
  for (const match of value.matchAll(tokenRe)) {
    const token = match[0];
    const start = match.index ?? 0;
    result += escapeHtml(value.slice(cursor, start));
    if (token.startsWith("`")) {
      result += `<code>${escapeHtml(token.slice(1, -1))}</code>`;
    } else if (token.startsWith("![")) {
      const image = token.match(/^!\[([^\]]*)\]\(([^)]+)\)$/u);
      const url = image && safeUrl(image[2], "image");
      result += url
        ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(image[1])}" loading="lazy">`
        : escapeHtml(token);
    } else if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/u);
      const url = link && safeUrl(link[2], "link");
      result += url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${renderInline(link[1])}</a>`
        : escapeHtml(token);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      result += `<strong>${renderInline(token.slice(2, -2))}</strong>`;
    } else {
      result += `<em>${renderInline(token.slice(1, -1))}</em>`;
    }
    cursor = start + token.length;
  }
  return result + escapeHtml(value.slice(cursor));
}

function tableCells(line: string) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const content = trimmed.replace(/^\|/u, "").replace(/\|$/u, "");
  return content.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line: string) {
  const cells = tableCells(line);
  return Boolean(cells?.length && cells.every((cell) => /^:?-{3,}:?$/u.test(cell)));
}

function isListLine(line: string) {
  return /^\s*(?:[-*+]\s+|\d+[.)]\s+)/u.test(line);
}

function isBlockStart(lines: string[], index: number) {
  const line = lines[index];
  return (
    /^#{1,6}\s+/u.test(line) ||
    /^```/u.test(line) ||
    /^>\s?/u.test(line) ||
    isListLine(line) ||
    (Boolean(tableCells(line)) && isTableSeparator(lines[index + 1] ?? "")) ||
    /^(?:---|\*\*\*|___)\s*$/u.test(line)
  );
}

export function renderMarkdownPreview(markdown: string) {
  const lines = String(markdown ?? "")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .filter((line) => !INTERNAL_IMAGE_MARKER_RE.test(line));
  if (!lines.some((line) => line.trim()))
    return '<p class="admin-preview-empty">본문을 입력하면 여기에 표시됩니다.</p>';

  const blocks: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = line.match(/^\s*```([^`]*)$/u);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/u.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/u);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (Boolean(tableCells(line)) && isTableSeparator(lines[index + 1] ?? "")) {
      const header = tableCells(line) ?? [];
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && tableCells(lines[index])) {
        rows.push(tableCells(lines[index]) ?? []);
        index += 1;
      }
      blocks.push(
        `<div class="admin-markdown-table-wrap"><table><thead><tr>${header
          .map((cell) => `<th>${renderInline(cell)}</th>`)
          .join("")}</tr></thead><tbody>${rows
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`,
          )
          .join("")}</tbody></table></div>`,
      );
      continue;
    }
    if (isListLine(line)) {
      const ordered = /^\s*\d+[.)]\s+/u.test(line);
      const items: string[] = [];
      while (index < lines.length && isListLine(lines[index])) {
        items.push(
          lines[index].replace(
            ordered ? /^\s*\d+[.)]\s+/u : /^\s*[-*+]\s+/u,
            "",
          ),
        );
        index += 1;
      }
      const tag = ordered ? "ol" : "ul";
      blocks.push(`<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`);
      continue;
    }
    if (/^>\s?/u.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/u.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/u, ""));
        index += 1;
      }
      blocks.push(`<blockquote><p>${renderInline(quote.join(" "))}</p></blockquote>`);
      continue;
    }
    if (/^(?:---|\*\*\*|___)\s*$/u.test(line)) {
      blocks.push("<hr>");
      index += 1;
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    if (paragraph.length) {
      blocks.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    } else {
      blocks.push(`<p>${renderInline(line.trim())}</p>`);
      index += 1;
    }
  }
  return blocks.join("\n");
}
