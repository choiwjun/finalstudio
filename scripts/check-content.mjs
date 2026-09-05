import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validatePost } from './lib/content-contract.mjs';

const dir = join(process.cwd(), 'src', 'content', 'posts');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
const errors = [];

for (const file of files) {
  errors.push(...validatePost(file, readFileSync(join(dir, file), 'utf8')));
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Content contract OK: ${files.length} Markdown file(s)`);
