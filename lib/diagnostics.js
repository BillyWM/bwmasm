export class BwmAsmError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'BwmAsmError';
    this.code = options.code || 'BWMASM_ERROR';
    this.diagnostics = options.diagnostics || [];
    this.exitCode = options.exitCode || 1;
  }
}

export function createDiagnostic(message, options = {}) {
  return {
    severity: options.severity || 'error',
    message,
    file: options.file || null,
    line: options.line || null,
    column: options.column || null,
    code: options.code || null,
  };
}

export function formatDiagnostic(diagnostic) {
  const location = [
    diagnostic.file,
    diagnostic.line != null ? diagnostic.line : null,
    diagnostic.column != null ? diagnostic.column : null,
  ].filter((part) => part !== null && part !== '').join(':');

  return `${location ? `${location}: ` : ''}${diagnostic.severity || 'error'}: ${diagnostic.message}`;
}
