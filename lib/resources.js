import { resolveResourceReference } from './resolve.js';
import { loadTable } from './tables.js';

export function defineResourceSymbol(symbols, statement, options, fail) {
  const baseDir = options.baseDir || process.cwd();

  if (symbols.has(statement.name)) {
    fail(`Duplicate resource name "${statement.name}".`);
  }

  if (statement.resourceType === 'table') {
    symbols.set(statement.name, {
      kind: 'resource',
      resourceType: 'table',
      supportsUse: true,
      table: loadTable(statement.file.value, baseDir, fail),
    });
    return;
  }

  fail(`Unsupported resource type "${statement.resourceType}".`);
}

export function activateResource(reference, symbols, activeResources, fail) {
  const resource = resolveResourceReference(reference, symbols, fail);
  if (!resource.supportsUse) {
    fail(`Resource "${reference.name}" cannot be used here.`);
  }
  activeResources.set(resource.resourceType, resource);
  return resource;
}
