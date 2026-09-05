import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
if (!existsSync(dist)) {
  console.error('dist/ does not exist; run npm run build first');
  process.exit(1);
}
const forbidden = ['.planning/', '.planning\\', 'sourceIds', 'TBD'];
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) walk(full);
    else files.push(full);
  }
}
walk(dist);
const hits = [];
for (const file of files) {
  const text = readFileSync(file);
  for (const token of forbidden) if (text.includes(token)) hits.push(`${file}: ${token}`);
}
if (hits.length) {
  console.error('Build boundary check failed\n' + hits.join('\n'));
  process.exit(1);
}
console.log(`Build boundary OK: ${files.length} output file(s)`);
