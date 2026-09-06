import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const failures = [];

const read = (file) => {
  const full = resolve(ROOT, file);
  if (!existsSync(full)) {
    failures.push(`${file}: 파일이 없습니다.`);
    return '';
  }
  return readFileSync(full, 'utf8');
};

let manifest = {};
try {
  manifest = JSON.parse(read('.editorial/manifest.json'));
} catch (error) {
  failures.push(`.editorial/manifest.json: JSON 형식이 잘못되었습니다 (${error.message})`);
}

if (!manifest.version) failures.push('.editorial/manifest.json: version이 필요합니다.');
if (manifest.selfImprovement?.mode !== 'proposal-only') {
  failures.push('.editorial/manifest.json: selfImprovement.mode은 proposal-only여야 합니다.');
}
if (manifest.selfImprovement?.requiresHumanApproval !== true) {
  failures.push('.editorial/manifest.json: selfImprovement.requiresHumanApproval은 true여야 합니다.');
}

const modules = manifest.modules ?? {};
for (const file of [modules.constitution, modules.styleGuide, ...Object.values(modules.blueprints ?? {}), ...Object.values(modules.personas ?? {}), ...Object.values(modules.exemplars ?? {}), ...Object.values(modules.prompts ?? {})]) {
  if (file) read(file);
}

const blueprintFormats = new Set(Object.keys(modules.blueprints ?? {}));
for (const format of Object.keys(modules.exemplars ?? {})) {
  if (!blueprintFormats.has(format)) failures.push(`exemplars: 블루프린트에 없는 형식 "${format}"의 exemplar가 있습니다.`);
}
for (const format of blueprintFormats) {
  if (!modules.exemplars?.[format]) failures.push(`exemplars: 형식 "${format}"의 exemplar가 필요합니다.`);
}
if (manifest.generationGate?.notesRequiredFormats) {
  for (const format of manifest.generationGate.notesRequiredFormats) {
    if (!blueprintFormats.has(format)) failures.push(`generationGate: 블루프린트에 없는 형식 "${format}"`);
  }
}

const personaPath = modules.personas?.[manifest.defaultPersona];
if (personaPath) {
  try {
    const persona = JSON.parse(read(personaPath));
    for (const key of ['name', 'speech_style', 'style', 'do', 'dont']) {
      if (!persona[key]) failures.push(`${personaPath}: ${key}가 필요합니다.`);
    }
  } catch (error) {
    failures.push(`${personaPath}: JSON 형식이 잘못되었습니다 (${error.message})`);
  }
}

const evalText = read('.editorial/evals/writing-cases.jsonl');
const evalLines = evalText.split(/\r?\n/).filter(Boolean);
if (evalLines.length < 3) failures.push('.editorial/evals/writing-cases.jsonl: 평가 사례가 3개 이상 필요합니다.');
for (const [index, line] of evalLines.entries()) {
  let item;
  try {
    item = JSON.parse(line);
    for (const key of ['id', 'format', 'subject', 'mustInclude', 'mustAvoid']) {
      if (!item[key]) failures.push(`writing-cases.jsonl:${index + 1}: ${key}가 필요합니다.`);
    }
  } catch (error) {
    failures.push(`writing-cases.jsonl:${index + 1}: JSON 형식이 잘못되었습니다 (${error.message})`);
    continue;
  }
  if (item.format && blueprintFormats.size && !blueprintFormats.has(item.format)) {
    failures.push(`writing-cases.jsonl:${index + 1}: 블루프린트에 없는 형식 "${item.format}"`);
  }
}

if (failures.length) {
  console.error(`Prompt contract failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Prompt contract OK: ${manifest.version}, ${evalLines.length} evaluation case(s)`);
