import { resolveResourceReference } from './resolve.js';
import { loadTable } from './tables.js';

export function collectResources(program, options, fail) {
  const symbols = new Map();
  const baseDir = options.baseDir || process.cwd();

  for (const node of program.body) {
    const statement = node.statement;
    if (statement?.type !== 'resourceDeclaration') continue;
    if (symbols.has(statement.name)) {
      fail(`Duplicate resource name "${statement.name}".`, node);
    }

    if (statement.resourceType === 'table') {
      symbols.set(statement.name, {
        kind: 'resource',
        resourceType: 'table',
        supportsUse: true,
        table: loadTable(statement.file.value, baseDir, (message) => fail(message, node)),
      });
      continue;
    }

    fail(`Unsupported resource type "${statement.resourceType}".`, node);
  }

  return symbols;
}

export function activateResource(reference, symbols, activeResources, fail) {
  const resource = resolveResourceReference(reference, symbols, fail);
  if (!resource.supportsUse) {
    fail(`Resource "${reference.name}" cannot be used here.`);
  }
  activeResources.set(resource.resourceType, resource);
  return resource;
}
