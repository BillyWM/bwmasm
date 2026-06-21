import { defineResourceSymbol } from './resources.js';
import { isBuiltinConstantName } from './resolve.js';

const CPU_RAM_START = 0x0000;
const CPU_RAM_END = 0x07FF;
const PRG_RAM_START = 0x6000;
const PRG_RAM_END = 0x7FFF;

function writableRegionForRange(start, width, config) {
  if (!Number.isInteger(start) || !Number.isInteger(width) || width < 1) {
    return null;
  }

  const end = start + width - 1;
  if (start >= CPU_RAM_START && end <= CPU_RAM_END) {
    return { kind: 'cpuRam', start: CPU_RAM_START, end: CPU_RAM_END };
  }

  const visiblePrgRamSize = Math.min(config.prgRamSize, PRG_RAM_END - PRG_RAM_START + 1);
  if (visiblePrgRamSize > 0) {
    const prgRamEnd = PRG_RAM_START + visiblePrgRamSize - 1;
    if (start >= PRG_RAM_START && end <= prgRamEnd) {
      return { kind: 'prgRam', start: PRG_RAM_START, end: prgRamEnd };
    }
  }

  return null;
}

function validateRamRange(name, start, width, config, node, fail) {
  const end = start + width - 1;
  const region = writableRegionForRange(start, width, config);
  if (region) {
    return region;
  }

  if (start >= PRG_RAM_START && start <= PRG_RAM_END && config.prgRamSize === 0) {
    fail(`RAM declaration "${name}" at $${start.toString(16).padStart(4, '0')} requires PRG RAM. Add a prgram declaration to .cartridge if this board has PRG RAM.`, node);
  }

  fail(`RAM declaration "${name}" range $${start.toString(16).padStart(4, '0')}-$${end.toString(16).padStart(4, '0')} is not inside a writable RAM region.`, node);
}

function recordSymbolInputs(program) {
  const inputs = {
    resources: [],
    constants: [],
    ramBlocks: [],
  };

  for (const node of program.body) {
    if (node?.type === 'block') {
      if (node.kind === 'ram') {
        inputs.ramBlocks.push(node);
      }
      continue;
    }

    const statement = node?.statement;
    if (!statement) {
      continue;
    }

    if (statement.type === 'resourceDeclaration') {
      inputs.resources.push({ node, statement });
      continue;
    }

    if (statement.type === 'constantDefinition') {
      inputs.constants.push({ node, statement });
    }
  }

  return inputs;
}

function defineConstantSymbol(symbols, statement, node, fail) {
  if (isBuiltinConstantName(statement.name)) {
    fail(`Constant "${statement.name}" conflicts with a built-in symbol.`, node);
  }

  if (symbols.has(statement.name)) {
    fail(`Duplicate symbol "${statement.name}".`, node);
  }

  symbols.set(statement.name, {
    kind: 'constant',
    valueType: statement.value.valueType,
    addressSpace: statement.value.valueType === 'address' ? 'cpu' : null,
    value: statement.value.value,
    raw: statement.value.raw,
  });
}

function defineRamBlockSymbols(symbols, declarations, block, config, autoAddress, fail) {
  let currentAddress = block.placement?.type === 'absolute'
    ? block.placement.address.value
    : autoAddress;
  const advancesAutoCounter = !block.placement;

  for (const item of block.items) {
    if (item.type !== 'declaration' || item.space !== 'ram') {
      continue;
    }

    if (item.directive === 'bytes' && item.width == null) {
      fail('.bytes requires a size; use .db for one byte.', item);
    }

    const width = item.width;
    if (!Number.isInteger(width) || width < 1) {
      fail(`RAM declaration "${item.name}" has invalid width.`, item);
    }
    if (symbols.has(item.name)) {
      fail(`Duplicate RAM symbol "${item.name}".`, item);
    }

    const region = validateRamRange(item.name, currentAddress, width, config, item, fail);
    const symbol = {
      kind: 'address',
      origin: 'ram',
      addressSpace: 'cpu',
      value: currentAddress,
      space: 'ram',
      ramRegion: region.kind,
      width,
      range: {
        start: currentAddress,
        end: currentAddress + width - 1,
      },
    };
    symbols.set(item.name, symbol);
    declarations.push({
      name: item.name,
      address: currentAddress,
      width,
      range: symbol.range,
      region: region.kind,
    });
    currentAddress += width;
  }

  return advancesAutoCounter ? currentAddress : autoAddress;
}

export function buildSymbolTable(program, config, options = {}, fail) {
  const symbols = new Map();
  const declarations = [];
  const inputs = recordSymbolInputs(program);

  for (const { node, statement } of inputs.resources) {
    defineResourceSymbol(symbols, statement, options, (message, errorNode = node) => fail(message, errorNode));
  }

  for (const { node, statement } of inputs.constants) {
    defineConstantSymbol(symbols, statement, node, fail);
  }

  let autoAddress = CPU_RAM_START;
  for (const block of inputs.ramBlocks) {
    autoAddress = defineRamBlockSymbols(symbols, declarations, block, config, autoAddress, fail);
  }

  return {
    symbols,
    ram: {
      symbols,
      declarations,
    },
  };
}
