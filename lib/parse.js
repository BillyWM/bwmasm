import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import peg from 'pegjs';
import { BwmAsmError, createDiagnostic } from './diagnostics.js';

export const DEFAULT_SYNTAX = 'bwm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let bwmParser = null;

function getBwmParser() {
  if (!bwmParser) {
    const grammar = fs.readFileSync(path.join(__dirname, '..', 'bwmasm.pegjs'), 'utf8');
    bwmParser = peg.generate(grammar);
  }
  return bwmParser;
}

export function parseBwmSyntax(source, options = {}) {
  try {
    const ast = getBwmParser().parse(source);
    return { ...ast, syntax: DEFAULT_SYNTAX };
  } catch (error) {
    if (!error.location) throw error;
    throw new BwmAsmError(error.message, {
      code: 'BWMASM_PARSE_ERROR',
      diagnostics: [createDiagnostic(error.message, {
        file: options.fileName || null,
        line: error.location.start.line,
        column: error.location.start.column,
        code: 'BWMASM_PARSE_ERROR',
      })],
    });
  }
}
