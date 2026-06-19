#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SYNTAX, parseBwmSyntax } from './lib/parse.js';
import { assembleProgram } from './lib/assemble.js';
import { BwmAsmError, createDiagnostic, formatDiagnostic } from './lib/diagnostics.js';

export { DEFAULT_SYNTAX, parseBwmSyntax, assembleProgram, BwmAsmError, createDiagnostic, formatDiagnostic };

function failedAssembly(error, ast, fileName) {
  return {
    ok: false,
    output: Buffer.alloc(0),
    diagnostics: error.diagnostics?.length ? error.diagnostics : [createDiagnostic(error.message, {
      file: fileName || null,
      code: error.code || 'BWMASM_ERROR',
    })],
    ast,
    symbols: new Map(),
    sourceMap: null,
  };
}

export function assemble(source, options = {}) {
  if (typeof source !== 'string') throw new TypeError('assemble(source, options) expects source to be a string.');
  if ((options.syntax || DEFAULT_SYNTAX) !== DEFAULT_SYNTAX) {
    return failedAssembly(new BwmAsmError(`Unsupported syntax "${options.syntax}".`, {
      code: 'BWMASM_UNSUPPORTED_SYNTAX',
    }), null, options.fileName);
  }

  let ast;
  try {
    ast = parseBwmSyntax(source, { fileName: options.fileName });
    return assembleProgram(ast, options);
  } catch (error) {
    if (error instanceof BwmAsmError) return failedAssembly(error, ast || null, options.fileName);
    throw error;
  }
}

export function printUsage(stream = process.stdout) {
  stream.write([
    'Usage: index.js source.asm -o game.nes',
    '',
    'Options:',
    '  -o, --output <file>   Write assembled iNES output',
    '  --syntax <name>       Assembly syntax to use; currently only "bwm"',
    '  --ast                 Parse and print the AST without assembling',
    '  -h, --help            Show this help',
    '  --version             Show package version',
    '',
  ].join('\n'));
}

export function parseCliArgs(argv) {
  const args = { input: null, output: null, syntax: DEFAULT_SYNTAX, ast: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') args.help = true;
    else if (arg === '--ast') args.ast = true;
    else if (arg === '--version') args.version = true;
    else if (arg === '-o' || arg === '--output' || arg === '--syntax') {
      const value = argv[++i];
      if (!value) throw new BwmAsmError(`Missing value for ${arg}.`, { code: 'BWMASM_CLI_USAGE', exitCode: 2 });
      if (arg === '--syntax') args.syntax = value;
      else args.output = value;
    } else if (arg.startsWith('-')) throw new BwmAsmError(`Unknown option ${arg}.`, { code: 'BWMASM_CLI_USAGE', exitCode: 2 });
    else if (!args.input) args.input = arg;
    else throw new BwmAsmError(`Unexpected argument ${arg}.`, { code: 'BWMASM_CLI_USAGE', exitCode: 2 });
  }
  return args;
}

function packageVersion() {
  return JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
}

export function runCli(argv = process.argv.slice(2), streams = {}) {
  const stdout = streams.stdout || process.stdout;
  const stderr = streams.stderr || process.stderr;
  try {
    const args = parseCliArgs(argv);
    if (args.help) return printUsage(stdout), 0;
    if (args.version) return stdout.write(`${packageVersion()}\n`), 0;
    if (!args.input) throw new BwmAsmError('Missing input file.', { code: 'BWMASM_CLI_USAGE', exitCode: 2 });

    const source = fs.readFileSync(args.input, 'utf8');
    const ast = parseBwmSyntax(source, { fileName: args.input });
    if (args.ast) return stdout.write(`${JSON.stringify(ast, null, 2)}\n`), 0;
    if (!args.output) throw new BwmAsmError('Missing output file. Use -o <file>.', { code: 'BWMASM_CLI_USAGE', exitCode: 2 });

    const result = assembleProgram(ast, { baseDir: path.dirname(args.input) });
    fs.writeFileSync(args.output, result.output);
    return 0;
  } catch (error) {
    if (error instanceof BwmAsmError) {
      for (const diagnostic of error.diagnostics) stderr.write(`${formatDiagnostic(diagnostic)}\n`);
      if (error.code === 'BWMASM_CLI_USAGE') {
        stderr.write('\n');
        printUsage(stderr);
      }
      return error.exitCode;
    }
    stderr.write(`${error.stack || error.message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = runCli();
}
