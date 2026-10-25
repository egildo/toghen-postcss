// Copied from house 0.1.0. Change it in house, then copy it out again.
//
// Fails when a tracked file names something Toghen must never name: a specific
// consumer, or a private identifier. The names live outside the repository, one
// per line, in the file TOGHEN_PURITY_NAMES points to, or else in
// ~/.config/toghen/purity-names. With neither, it says so and passes: the
// repository holds the check, never the names.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const file = process.env.TOGHEN_PURITY_NAMES || join(homedir(), '.config', 'toghen', 'purity-names');
if (!existsSync(file)) {
  console.log(`purity: no names file at ${file}; nothing checked.`);
  process.exit(0);
}
const names = readFileSync(file, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));
if (names.length === 0) {
  console.log(`purity: ${file} lists no names; nothing checked.`);
  process.exit(0);
}
const escape = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = new RegExp(`\\b(${names.map(escape).join('|')})\\b`, 'i');
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const hits = [];
for (const path of tracked) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\0')) continue;
  text.split('\n').forEach((line, index) => {
    if (pattern.test(line)) hits.push(`${path}:${index + 1}`);
  });
}
if (hits.length > 0) {
  console.error(`purity: ${hits.length} line(s) name what Toghen must not name (the names are in ${file}):`);
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}
console.log(`purity: ${tracked.length} files, none names what ${file} lists.`);
