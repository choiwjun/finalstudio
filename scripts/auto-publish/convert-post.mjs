#!/usr/bin/env node
/**
 * AI 글 초안 → WJ Blog 콘텐츠 스키마 변환기
 *
 * 사용법:
 *   node scripts/auto-publish/convert-post.mjs <입력.md> --topic 카테고리 --angle "관점 한 문장"
 *   옵션: --slug 파일명(영어 소문자-하이픈)  --author 이름  --out 출력 경로(기본 src/content/posts)
 *         --pub-date YYYY-MM-DD 운영 메타데이터 날짜 (모델 날짜보다 우선, status는 draft 유지)
 *
 * 규칙:
 *   - status는 항상 draft로 저장 (사람 검토 전까지 공개 불가 — CEO_PLAN 게이트)
 *   - aiAssisted는 항상 true (AI 초안 사실 고지)
 *   - claude-blog의 coverImage/ogImage/tags 등 스키마 밖 필드는 제거
 *     (실제 테스트 스크린샷만 사용한다는 편집 규칙 때문)
 *   - 기존 파일은 덮어쓰지 않음
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { detectContentRisks } from "../lib/content-risk.mjs";
import {
 openVerifiedDirectory,
 openVerifiedFileAtDirectory,
} from "../keyword-system/lib/file-lock.mjs";

const args = process.argv.slice(2);
const input = args[0];
const getArg = (name) => {
 const i = args.indexOf(`--${name}`);
 return i === -1 ? undefined : args[i + 1];
};

const topic = getArg("topic");
const angle = getArg("angle");
const slug = (getArg("slug") ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "");
const author = getArg("author") ?? "TBD";

const fail = (msg) => {
 console.error(`[convert-post] 오류: ${msg}`);
 process.exit(1);
};

if (args.includes("--pub-date") && getArg("pub-date") === undefined)
 fail("--pub-date에는 YYYY-MM-DD 날짜 값이 필요합니다.");
if (!input)
 fail(
  '입력 파일 경로가 필요합니다. 예: node scripts/auto-publish/convert-post.mjs draft.md --topic 카테고리 --angle "..."',
 );
if (!topic || topic.trim().length === 0 || topic.includes("\n"))
 fail("--topic에는 비어 있지 않은 카테고리 이름을 지정하세요.");
if (!angle)
 fail(
  "--angle이 필요합니다. 이 글이 기존 글과 다르게 채택한 관점을 한 문장으로 적어주세요.",
 );

const inputPath = resolve(input);
if (!existsSync(inputPath)) fail(`입력 파일이 없습니다: ${inputPath}`);

const raw = readFileSync(inputPath, "utf8");
const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/);
if (!fmMatch)
 fail(
  "입력 파일에 frontmatter가 없습니다. claude-blog /blog write 출력인지 확인하세요.",
 );

const parseSimple = (front, key) => {
 const m = front.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
 if (!m) return undefined;
 return m[1].trim().replace(/^["']|["']$/g, "");
};

const title = parseSimple(fmMatch[1], "title");
const description = parseSimple(fmMatch[1], "description");
// 자동작성 프롬프트의 계약은 pubDate다. 예전 claude-blog 출력물의 date도
// 호환하되, pubDate가 있으면 그것을 우선한다.
const pubDateFromFrontmatter =
 parseSimple(fmMatch[1], "pubDate") ?? parseSimple(fmMatch[1], "date");
if (!title || !description) fail("frontmatter에 title/description이 없습니다.");
if (title.length > 40)
 console.warn(
  `[convert-post] 경고: 제목이 ${title.length}자입니다. 25자 내외(잘림 방지)를 권장합니다.`,
 );
if (description.length < 50 || description.length > 110)
 console.warn(
  `[convert-post] 경고: description ${description.length}자 — 70~80자를 권장합니다.`,
 );

const body = raw.slice(fmMatch[0].length).trimStart();
const warnings = [];
// "안 될 때"·FAQ는 how-to(사용법) 형식의 필수 구조다. 다른 형식에는 억지로 요구하지 않는다.
const format = (getArg("format") ?? "how-to").toLowerCase();
if (format === "how-to") {
 if (!/안\s*될\s*때/.test(body))
  warnings.push(
   '"안 될 때"(오류 해결) 섹션이 없습니다. 발행 전 반드시 추가하세요.',
  );
 if (!/FAQ|자주.{0,4}질문/.test(body))
  warnings.push("FAQ 섹션이 없습니다. AEO 규칙상 필수입니다 (3~5개 질문).");
}
if (/Key Takeaways/.test(body))
 warnings.push(
  '요약 박스 라벨이 영어(Key Takeaways)입니다. "핵심 요약"으로 교체하세요.',
 );
if (/\[(?:스크린샷|직접 확인 필요|테스트 필요|출처 URL 확인 필요)/.test(body)) {
 console.log(
  "[convert-post] 확인: 검증 마커가 있습니다 — 사람 테스트 후 모두 채워야 합니다.",
 );
}

const contentRisks = detectContentRisks(`${title}\n${description}\n${body}`);
if (contentRisks.length) {
 console.warn(
  `[convert-post] 추가 사람 검토 필요: ${contentRisks.map((risk) => risk.label).join(", ")}`,
 );
}

const suggestedSlug =
 body.match(
  /^슬러그\s*(?:제안|추천)\s*:\s*[`'"]?([a-z0-9]+(?:-[a-z0-9]+)*)[`'"]?\s*$/im,
 )?.[1] ?? "";

// 자동 엔진의 실행 날짜는 신뢰 가능한 운영 메타데이터다. 본문과 검증 마커는 바꾸지 않는다.
const pubDate =
 getArg("pub-date") ??
 pubDateFromFrontmatter ??
 new Date().toISOString().slice(0, 10);
const parsedDate = new Date(`${pubDate}T00:00:00.000Z`);
if (
 !/^\d{4}-\d{2}-\d{2}$/.test(pubDate) ||
 Number.isNaN(parsedDate.getTime()) ||
 parsedDate.toISOString().slice(0, 10) !== pubDate
) {
 fail("pubDate/date는 실제 존재하는 YYYY-MM-DD 날짜여야 합니다.");
}
const baseSlug = slug || suggestedSlug || `post-${pubDate}`;
let finalSlug = baseSlug;
const outDir = resolve(
 getArg("out") ?? join(process.cwd(), "src", "content", "posts"),
);
let outPath;

const front = [
 "---",
 `title: "${title.replace(/"/g, '\\"')}"`,
 `description: "${description.replace(/"/g, '\\"')}"`,
 `pubDate: ${pubDate}`,
 "status: draft",
 `topic: ${topic}`,
 `angle: "${angle.replace(/"/g, '\\"')}"`,
 `author: ${author}`,
 "sourceIds: []",
 "toolVersions: {}",
 `manualReview: ${contentRisks.length ? "required" : "none"}`,
 `manualReviewReasons: [${contentRisks.map((risk) => `"${risk.label}"`).join(", ")}]`,
 "aiAssisted: true",
 "---",
 "",
].join("\n");

// 날짜·슬러그를 신뢰하지 않고 쓰기 전에 경로를 검증한다.
// 검증된 디렉터리 FD에서 배타적으로 생성해 경합·심볼릭 링크 덮어쓰기도 막는다.
try {
 const directory = await openVerifiedDirectory(outDir, { create: false });
 try {
  let suffix = 2;
  while (true) {
   outPath = resolve(outDir, `${finalSlug}.md`);
   if (dirname(outPath) !== outDir)
    throw new Error("글 파일은 출력 폴더 바로 아래에만 저장할 수 있습니다.");
   let file;
   try {
    file = await openVerifiedFileAtDirectory(directory, `${finalSlug}.md`, {
     create: true,
     exclusive: true,
    });
   } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (slug)
     throw new Error(
      `같은 이름의 글이 이미 있습니다: ${outPath} (--slug로 다른 이름 사용)`,
     );
    finalSlug = `${baseSlug}-${suffix++}`;
    continue;
   }
   try {
    await file.handle.writeFile(`${front}${body}\n`, "utf8");
    await file.handle.sync();
   } finally {
    await file.handle.close();
   }
   break;
  }
 } finally {
  await directory.close();
 }
} catch (error) {
 fail(`안전한 글 저장 실패: ${error.message}`);
}

// 개발 서버는 콘텐츠 변경을 감시하지 않으므로 `astro sync`로 데이터 스토어를 갱신한다.
// (관리 서버가 개발 서버를 감독 중이면 관리 서버가 재시작까지 담당하므로 여기선 스토어만 갱신)
try {
 execFileSync(
  "node",
  [join(process.cwd(), "node_modules", "astro", "bin", "astro.mjs"), "sync"],
  { cwd: process.cwd(), stdio: "ignore", timeout: 120_000 },
 );
} catch {
 /* dev 서버 없으면 무시 */
}

console.log(`[convert-post] 저장 완료: ${outPath}`);
console.log("[convert-post] 상태: draft (사람 검토 전까지 공개되지 않습니다)");
if (suggestedSlug && !slug)
 console.log(`[convert-post] AI 제안 slug 사용: ${finalSlug}`);
warnings.forEach((w) => console.warn(`[convert-post] 경고: ${w}`));
console.log(
 "[convert-post] 다음 단계: 실제 테스트 → 마커 채우기 → npm run check:content → 사람 승인",
);
