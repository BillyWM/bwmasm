import fs from 'node:fs';
import path from 'node:path';

function unescapeTableText(text) {
  return text.replace(/\\([nrt\\"])/g, (_match, escape) => ({ n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"' })[escape]);
}

export function loadTable(fileName, baseDir, fail) {
  let source;
  try {
    source = fs.readFileSync(path.resolve(baseDir, fileName), 'utf8');
  } catch {
    fail(`Could not read table file "${fileName}".`);
  }

  const entries = new Map();
  let eol = null;
  for (const [index, line] of source.split(/\r\n|\n|\r/).entries()) {
    if (line === '') continue;
    const separator = line.indexOf('=');
    if (separator < 0) fail(`Invalid table entry on line ${index + 1} of "${fileName}".`);
    const hex = line.slice(0, separator).trim();
    if (!/^[0-9a-fA-F]{2}$/.test(hex)) fail(`Invalid table byte "${hex}" in "${fileName}".`);
    const byte = parseInt(hex, 16);
    const text = line.slice(separator + 1);
    if (text === '<<eol>>') {
      if (eol !== null) fail(`Multiple <<eol>> entries in "${fileName}".`);
      eol = byte;
    } else if (text !== '') {
      entries.set(unescapeTableText(text), byte);
    }
  }
  if (eol === null) fail(`Table "${fileName}" has no <<eol>> entry.`);
  return { entries, eol };
}

export function encodeTableText(text, table, fail) {
  const keys = [...table.entries.keys()].sort((a, b) => b.length - a.length);
  const bytes = [];
  for (let offset = 0; offset < text.length;) {
    const key = keys.find((candidate) => text.startsWith(candidate, offset));
    if (!key) fail(`No table mapping for "${text[offset]}".`);
    bytes.push(table.entries.get(key));
    offset += key.length;
  }
  return [...bytes, table.eol];
}
