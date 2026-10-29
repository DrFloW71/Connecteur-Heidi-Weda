'use strict';
const fs = require('node:fs');
const path = require('node:path');
const start = '  // BEGIN GENERATED BIOLOGY ENHANCEMENTS', end = '  // END GENERATED BIOLOGY ENHANCEMENTS';
const source = fs.readFileSync(path.join(__dirname, 'lib', 'biologie-weda.js'), 'utf8').split("\nif (typeof module !== 'undefined')")[0].trimEnd();
const block = start + '\n' + source.split('\n').map(line => line ? '  ' + line : '').join('\n') + '\n' + end;
let stale = false;
for (const relative of ['LM studio/analyse-biologies-weda-LMstudio.user.js', 'Heidi/analyse-biologies-weda-heidi.user.js']) {
  const file = path.join(__dirname, relative), original = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const first = original.indexOf(start), last = original.indexOf(end, first);
  if (first >= 0 && last < 0) throw new Error('Bloc généré incomplet : ' + relative);
  const updated = first < 0 ? original.replace(/\n\}\)\(\);\s*$/, '\n' + block + '\n})();\n') :
    original.slice(0, first) + block + original.slice(last + end.length);
  if (updated === original) continue;
  stale = true;
  if (process.argv.includes('--write')) fs.writeFileSync(file, updated);
  else console.error('Module de biologie non synchronisé : ' + relative);
}
if (stale && !process.argv.includes('--write')) process.exitCode = 1;
