import fs from 'node:fs';
import path from 'node:path';
import { BwmAsmError, createDiagnostic } from './diagnostics.js';
import { encodeTableText } from './tables.js';
import { activateResource } from './resources.js';
import { buildSymbolTable } from './symbolTable.js';
import { resolveAddressReference, tryResolveAddressReference } from './resolve.js';

const BANK_8K = 8 * 1024;
const BANK_16K = 16 * 1024;
const BANK_32K = 32 * 1024;
const PRG_UNIT = BANK_16K;
const CHR_UNIT = BANK_8K;

const OPCODES = new Map(Object.entries({
  adc: { imm: 0x69, zp: 0x65, zpx: 0x75, abs: 0x6D, absx: 0x7D, absy: 0x79, indx: 0x61, indy: 0x71 },
  and: { imm: 0x29, zp: 0x25, zpx: 0x35, abs: 0x2D, absx: 0x3D, absy: 0x39, indx: 0x21, indy: 0x31 },
  asl: { acc: 0x0A, zp: 0x06, zpx: 0x16, abs: 0x0E, absx: 0x1E },
  bcc: { rel: 0x90 },
  bcs: { rel: 0xB0 },
  beq: { rel: 0xF0 },
  bit: { zp: 0x24, abs: 0x2C },
  bmi: { rel: 0x30 },
  bne: { rel: 0xD0 },
  bpl: { rel: 0x10 },
  brk: { imp: 0x00 },
  bvc: { rel: 0x50 },
  bvs: { rel: 0x70 },
  clc: { imp: 0x18 },
  cld: { imp: 0xD8 },
  cli: { imp: 0x58 },
  clv: { imp: 0xB8 },
  cmp: { imm: 0xC9, zp: 0xC5, zpx: 0xD5, abs: 0xCD, absx: 0xDD, absy: 0xD9, indx: 0xC1, indy: 0xD1 },
  cpx: { imm: 0xE0, zp: 0xE4, abs: 0xEC },
  cpy: { imm: 0xC0, zp: 0xC4, abs: 0xCC },
  dec: { zp: 0xC6, zpx: 0xD6, abs: 0xCE, absx: 0xDE },
  dex: { imp: 0xCA },
  dey: { imp: 0x88 },
  eor: { imm: 0x49, zp: 0x45, zpx: 0x55, abs: 0x4D, absx: 0x5D, absy: 0x59, indx: 0x41, indy: 0x51 },
  inc: { zp: 0xE6, zpx: 0xF6, abs: 0xEE, absx: 0xFE },
  inx: { imp: 0xE8 },
  iny: { imp: 0xC8 },
  jmp: { abs: 0x4C, ind: 0x6C },
  jsr: { abs: 0x20 },
  lda: { imm: 0xA9, zp: 0xA5, zpx: 0xB5, abs: 0xAD, absx: 0xBD, absy: 0xB9, indx: 0xA1, indy: 0xB1 },
  ldx: { imm: 0xA2, zp: 0xA6, zpy: 0xB6, abs: 0xAE, absy: 0xBE },
  ldy: { imm: 0xA0, zp: 0xA4, zpx: 0xB4, abs: 0xAC, absx: 0xBC },
  lsr: { acc: 0x4A, zp: 0x46, zpx: 0x56, abs: 0x4E, absx: 0x5E },
  nop: { imp: 0xEA },
  ora: { imm: 0x09, zp: 0x05, zpx: 0x15, abs: 0x0D, absx: 0x1D, absy: 0x19, indx: 0x01, indy: 0x11 },
  pha: { imp: 0x48 },
  php: { imp: 0x08 },
  pla: { imp: 0x68 },
  plp: { imp: 0x28 },
  rol: { acc: 0x2A, zp: 0x26, zpx: 0x36, abs: 0x2E, absx: 0x3E },
  ror: { acc: 0x6A, zp: 0x66, zpx: 0x76, abs: 0x6E, absx: 0x7E },
  rti: { imp: 0x40 },
  rts: { imp: 0x60 },
  sbc: { imm: 0xE9, zp: 0xE5, zpx: 0xF5, abs: 0xED, absx: 0xFD, absy: 0xF9, indx: 0xE1, indy: 0xF1 },
  sec: { imp: 0x38 },
  sed: { imp: 0xF8 },
  sei: { imp: 0x78 },
  sta: { zp: 0x85, zpx: 0x95, abs: 0x8D, absx: 0x9D, absy: 0x99, indx: 0x81, indy: 0x91 },
  stx: { zp: 0x86, zpy: 0x96, abs: 0x8E },
  sty: { zp: 0x84, zpx: 0x94, abs: 0x8C },
  tax: { imp: 0xAA },
  tay: { imp: 0xA8 },
  tsx: { imp: 0xBA },
  txa: { imp: 0x8A },
  txs: { imp: 0x9A },
  tya: { imp: 0x98 },
}));

const MODE_SIZES = new Map(Object.entries({
  imp: 1,
  acc: 1,
  imm: 2,
  zp: 2,
  zpx: 2,
  zpy: 2,
  rel: 2,
  indx: 2,
  indy: 2,
  abs: 3,
  absx: 3,
  absy: 3,
  ind: 3,
}));

function throwAssemblyError(message, node, code) {
  throw new BwmAsmError(message, {
    code: code || 'BWMASM_ASSEMBLY_ERROR',
    diagnostics: [createDiagnostic(message, { code: code || 'BWMASM_ASSEMBLY_ERROR' })],
  });
}

function textBytes(declaration, activeResources, node) {
  if (declaration.directive === 'ascii') {
    const bytes = [...declaration.text.value].map((character) => character.charCodeAt(0));
    if (bytes.some((byte) => byte > 0x7F)) throwAssemblyError('.ascii accepts only ASCII characters.', node);
    return [...bytes, 0xFF];
  }
  const table = activeResources.get('table');
  if (!table) throwAssemblyError('.text requires an active table selected with .use.', node);
  return encodeTableText(declaration.text.value, table.table, (message) => throwAssemblyError(message, node));
}

function firstArg(statement, node) {
  const arg = statement.args[0];
  if (!arg) {
    throwAssemblyError(`.${statement.normalized} expects an argument.`, node);
  }
  return arg;
}

function requireArgCount(statement, count, node) {
  if (statement.args.length !== count) {
    throwAssemblyError(`.${statement.normalized} expects ${count} argument(s).`, node);
  }
}

function requireSymbolReferenceArg(statement, node) {
  const arg = firstArg(statement, node);
  if (arg.type !== 'symbol') {
    throwAssemblyError(`.${statement.normalized} expects a symbol reference.`, node);
  }
  return arg;
}

function littleEndianWord(value) {
  return [value & 0xFF, (value >> 8) & 0xFF];
}

function signedByte(value) {
  return value & 0xFF;
}

function argByteLength(arg, node) {
  if (arg.type === 'string') {
    return arg.value.length;
  }
  if (arg.type === 'number' || arg.type === 'builtinConstant' || arg.type === 'symbol') {
    return 1;
  }
  throwAssemblyError('.db supports numbers, strings, and symbols for now.', node);
}

function romDeclarationPrgSize(declaration, node) {
  switch (declaration.directive) {
    case 'db':
      if (declaration.args.length === 0) {
        throwAssemblyError('.db expects at least one value.', node);
      }
      return declaration.args.reduce((total, arg) => total + argByteLength(arg, node), 0);

    case 'dw':
      if (declaration.args.length === 0) {
        throwAssemblyError('.dw expects at least one value.', node);
      }
      for (const arg of declaration.args) {
        if (arg.type !== 'number' && arg.type !== 'builtinConstant' && arg.type !== 'symbol') {
          throwAssemblyError('.dw supports numbers and symbols for now.', node);
        }
      }
      return declaration.args.length * 2;

    default:
      return null;
  }
}

function walkAst(node, visit) {
  if (!node) return;
  visit(node);

  if (node.type === 'program') {
    for (const child of node.body || []) walkAst(child, visit);
    return;
  }

  if (node.type === 'block') {
    for (const item of node.items || []) walkAst(item, visit);
  }
}

function validateProgram(program) {
  const blockCount = {
    cartridge: 0,
  };

  walkAst(program, (node) => {
    if (node.type === 'block' && node.kind === 'cartridge') {
      blockCount.cartridge += 1;
    }
  });

  if (blockCount.cartridge !== 1) {
    throwAssemblyError(
      blockCount.cartridge === 0
        ? '.cartridge block is required.'
        : 'Only one .cartridge block is allowed.',
      program.body[0] || program,
    );
  }
}

function findCartridgeBlock(program) {
  let cartridgeBlock = null;
  walkAst(program, (node) => {
    if (!cartridgeBlock && node.type === 'block' && node.kind === 'cartridge') {
      cartridgeBlock = node;
    }
  });
  return cartridgeBlock;
}

function firstCartridgeArg(declaration, node) {
  const arg = declaration.args[0];
  if (!arg) {
    throwAssemblyError(`.cartridge ${declaration.name} expects an argument.`, node);
  }
  return arg;
}

function requireCartridgeArgCount(declaration, count, node) {
  if (declaration.args.length !== count) {
    throwAssemblyError(`.cartridge ${declaration.name} expects ${count} argument(s).`, node);
  }
}

function requireCartridgeSizeArg(declaration, node) {
  const arg = firstCartridgeArg(declaration, node);
  if (arg.type !== 'size') {
    throwAssemblyError(`.cartridge ${declaration.name} expects a size like 32k.`, node);
  }
  return arg.value;
}

function buildConfig(program) {
  const cartridgeBlock = findCartridgeBlock(program);
  if (!cartridgeBlock) {
    throwAssemblyError('.cartridge block is required.', program.body[0] || program);
  }

  const config = {
    prgSize: null,
    chrSize: 0,
    mapperName: 'nrom',
    mapper: 0,
    prgRamSize: 0,
    mirroring: 'horizontal',
    fourScreen: false,
    bankCount: 1,
    bankSize: BANK_32K,
    vectors: new Map(),
  };

  const seen = new Set();
  for (const declaration of cartridgeBlock.items) {
    if (declaration.type !== 'cartridgeDeclaration') {
      continue;
    }

    if (seen.has(declaration.name)) {
      throwAssemblyError(`Duplicate .cartridge ${declaration.name} declaration.`, declaration);
    }
    seen.add(declaration.name);

    switch (declaration.name) {
      case 'prg':
        requireCartridgeArgCount(declaration, 1, declaration);
        config.prgSize = requireCartridgeSizeArg(declaration, declaration);
        break;

      case 'chr':
        requireCartridgeArgCount(declaration, 1, declaration);
        config.chrSize = requireCartridgeSizeArg(declaration, declaration);
        break;

      case 'prgram':
        requireCartridgeArgCount(declaration, 1, declaration);
        config.prgRamSize = requireCartridgeSizeArg(declaration, declaration);
        break;

      case 'mapper': {
        requireCartridgeArgCount(declaration, 1, declaration);
        const mapper = firstCartridgeArg(declaration, declaration);
        if (mapper.type === 'mapperKeyword') {
          config.mapperName = mapper.name.toLowerCase();
          config.mapper = mapper.value;
        } else if (mapper.type === 'number') {
          config.mapperName = `mapper${mapper.value}`;
          config.mapper = mapper.value;
        } else {
          throwAssemblyError('.cartridge mapper expects a mapper keyword or number.', declaration);
        }
        break;
      }

      case 'mirroring': {
        requireCartridgeArgCount(declaration, 1, declaration);
        const mirroring = firstCartridgeArg(declaration, declaration);
        if (mirroring.type !== 'mirroringKeyword') {
          throwAssemblyError('.cartridge mirroring expects a mirroring keyword.', declaration);
        }
        config.mirroring = mirroring.value;
        config.fourScreen = mirroring.fourScreen;
        break;
      }

      default:
        throwAssemblyError(`Unsupported .cartridge declaration "${declaration.name}".`, declaration);
    }
  }

  if (!config.prgSize) {
    throwAssemblyError('.cartridge prg is required.', cartridgeBlock);
  }

  if (config.prgSize % PRG_UNIT !== 0) {
    throwAssemblyError('.cartridge prg size must be a multiple of 16k.', cartridgeBlock);
  }

  if (config.chrSize % CHR_UNIT !== 0) {
    throwAssemblyError('.cartridge chr size must be a multiple of 8k.', cartridgeBlock);
  }

  if (config.prgRamSize < 0 || config.prgRamSize % CHR_UNIT !== 0) {
    throwAssemblyError('.cartridge prgram size must be a multiple of 8k.', cartridgeBlock);
  }

  config.mapperFamily = mapperFamilyForConfig(config);

  if (config.mapperFamily === 'nrom') {
    if (config.prgSize !== BANK_16K && config.prgSize !== BANK_32K) {
      throwAssemblyError('NROM .cartridge prg must be 16k or 32k.', cartridgeBlock);
    }
    config.bankSize = config.prgSize;
    config.bankCount = 1;
  } else if (config.mapperFamily === 'unrom') {
    if (config.prgSize % BANK_16K !== 0) {
      throwAssemblyError('UNROM .cartridge prg size must be a multiple of 16k.', cartridgeBlock);
    }
    config.bankSize = BANK_16K;
    config.bankCount = config.prgSize / BANK_16K;
  } else if (config.mapperFamily === 'mmc3') {
    if (config.prgSize % BANK_8K !== 0) {
      throwAssemblyError('MMC3 .cartridge prg size must be a multiple of 8k.', cartridgeBlock);
    }
    config.bankSize = BANK_8K;
    config.bankCount = config.prgSize / BANK_8K;
  } else {
    if (config.prgSize % BANK_32K !== 0) {
      throwAssemblyError('32k switcher .cartridge prg size must be a multiple of 32k.', cartridgeBlock);
    }
    config.bankSize = BANK_32K;
    config.bankCount = config.prgSize / BANK_32K;
  }

  return config;
}

function mapperFamilyForConfig(config) {
  switch (config.mapper) {
    case 0:
      return 'nrom';
    case 2:
    case 30:
      return 'unrom';
    case 4:
      return 'mmc3';
    case 7:
    case 34:
      return '32kSwitcher';
    default:
      return '32kSwitcher';
  }
}

function getMapperFamily(config) {
  return config.mapperFamily || mapperFamilyForConfig(config);
}

function getVectorSet(config, descriptor) {
  if (!config.vectors.has(descriptor.key)) {
    config.vectors.set(descriptor.key, {});
  }
  return config.vectors.get(descriptor.key);
}

const DIRECT_MODE_VARIANTS = {
  direct: ['zp', 'abs'],
  directX: ['zpx', 'absx'],
  directY: ['zpy', 'absy'],
};

function requireBankSelectionArg(statement, node) {
  requireArgCount(statement, 1, node);
  const arg = firstArg(statement, node);
  if (arg.type !== 'bankSelection') {
    throwAssemblyError(`.${statement.normalized} expects a bank selection.`, node);
  }
  return arg;
}

function requireModeArg(statement, node) {
  requireArgCount(statement, 1, node);
  const arg = firstArg(statement, node);
  if (arg.type !== 'modeKeyword') {
    throwAssemblyError('.mode expects a mode keyword.', node);
  }
  return arg.name;
}

function setPlacementMode(statement, node, config) {
  const mode = requireModeArg(statement, node);
  if (getMapperFamily(config) !== 'mmc3') {
    throwAssemblyError('.mode is currently only supported for MMC3.', node);
  }
  return mode;
}

function bankUnitName(unitSize) {
  return `${unitSize / 1024}k`;
}

function bankKey(unitSize, index) {
  return `${bankUnitName(unitSize)}:${index}`;
}

function bankCountForUnit(config, unitSize) {
  return config.prgSize / unitSize;
}

function nativeBankSizes(config) {
  switch (getMapperFamily(config)) {
    case 'nrom':
      return [config.prgSize];
    case 'unrom':
      return [BANK_16K];
    case 'mmc3':
      return [BANK_8K];
    case '32kSwitcher':
    default:
      return [BANK_32K];
  }
}

function defaultBankUnitSize(config) {
  return nativeBankSizes(config)[0];
}

function validateBankUnitSize(config, unitSize, node) {
  const allowed = nativeBankSizes(config);
  if (!allowed.includes(unitSize)) {
    throwAssemblyError(`Mapper ${config.mapperName} does not support ${bankUnitName(unitSize)} PRG banks.`, node);
  }
  if (config.prgSize % unitSize !== 0) {
    throwAssemblyError(`PRG size is not a multiple of ${bankUnitName(unitSize)}.`, node);
  }
}

function resolveBankConstant(endpoint, symbols, node) {
  const symbol = symbols.get(endpoint.name);
  if (!symbol) {
    throwAssemblyError(`Undefined bank constant "${endpoint.name}".`, node);
  }
  if (symbol.kind !== 'constant') {
    throwAssemblyError(`Symbol "${endpoint.name}" is not a constant.`, node);
  }
  if (symbol.valueType !== 'scalar') {
    throwAssemblyError(`Symbol "${endpoint.name}" is an address constant, not a scalar bank number.`, node);
  }
  if (!Number.isInteger(symbol.value)) {
    throwAssemblyError(`Bank constant "${endpoint.name}" is not an integer.`, node);
  }
  return symbol.value;
}

function resolveBankEndpoint(endpoint, unitSize, config, symbols, node) {
  const count = bankCountForUnit(config, unitSize);
  if (endpoint.type === 'bankNumber') {
    return { index: endpoint.value, role: null, raw: endpoint.raw };
  }
  if (endpoint.type === 'bankConstantReference') {
    return { index: resolveBankConstant(endpoint, symbols, node), role: null, raw: endpoint.raw };
  }
  if (endpoint.type === 'bankKeyword') {
    switch (endpoint.name) {
      case 'first':
        return { index: 0, role: 'first', raw: endpoint.raw };
      case 'last':
        return { index: count - 1, role: 'last', raw: endpoint.raw };
      case 'second-last':
        if (count < 2) {
          throwAssemblyError(`Bank keyword "${endpoint.raw}" requires at least two ${bankUnitName(unitSize)} banks.`, node);
        }
        return { index: count - 2, role: 'second-last', raw: endpoint.raw };
      default:
        throwAssemblyError(`Bank keyword "${endpoint.raw}" is not valid in a range endpoint.`, node);
    }
  }
  throwAssemblyError(`Invalid bank selector "${endpoint.raw || endpoint.type}".`, node);
}

function validateBankIndex(index, unitSize, config, node) {
  const count = bankCountForUnit(config, unitSize);
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throwAssemblyError(`Bank ${index} x ${bankUnitName(unitSize)} is out of range.`, node);
  }
}

function windowAliasNameForBase(cpuBase) {
  switch (cpuBase) {
    case 0x8000:
      return 'low window';
    case 0xA000:
      return 'mid window';
    case 0xC000:
      return 'high window';
    default:
      return `$${cpuBase.toString(16).padStart(4, '0')}`;
  }
}

function makeBankDescriptor(config, index, unitSize, cpuBase, node) {
  validateBankIndex(index, unitSize, config, node);
  if (!Number.isInteger(cpuBase) || cpuBase < 0x8000 || cpuBase + unitSize > 0x10000) {
    throwAssemblyError(`CPU window $${String(cpuBase?.toString?.(16) || cpuBase).padStart(4, '0')} cannot hold a ${bankUnitName(unitSize)} bank.`, node);
  }
  return {
    index,
    unitSize,
    cpuBase,
    romOffset: index * unitSize,
    key: bankKey(unitSize, index),
    displayName: `${index} x ${bankUnitName(unitSize)}`,
    windowName: windowAliasNameForBase(cpuBase),
  };
}

function vectorTailReserve(descriptor) {
  return descriptor.cpuBase + descriptor.unitSize === 0x10000 ? 6 : 0;
}

function usableBankSize(descriptor) {
  return descriptor.unitSize - vectorTailReserve(descriptor);
}

function isLastBank(index, unitSize, config) {
  return index === bankCountForUnit(config, unitSize) - 1;
}

function isSecondLastBank(index, unitSize, config) {
  return bankCountForUnit(config, unitSize) >= 2 && index === bankCountForUnit(config, unitSize) - 2;
}

function requireMmc3Mode(activeMode, node, cpuBase) {
  if (!activeMode) {
    throwAssemblyError(`MMC3 window ${windowAliasNameForBase(cpuBase)} requires .mode swap-low or .mode swap-high.`, node);
  }
}

function inferBankCpuBase(config, item, unitSize, activeMode, node) {
  switch (getMapperFamily(config)) {
    case 'nrom':
      return config.prgSize === BANK_16K ? 0xC000 : 0x8000;

    case 'unrom':
      return item.role === 'last' ? 0xC000 : 0x8000;

    case 'mmc3':
      if (item.role === 'last') {
        return 0xE000;
      }
      if (item.role === 'second-last') {
        if (!activeMode) {
          throwAssemblyError('MMC3 .bank second-last requires .mode swap-low or .mode swap-high.', node);
        }
        return activeMode === 'swap-low' ? 0xC000 : 0x8000;
      }
      throwAssemblyError('MMC3 switchable banks require an explicit CPU window with at low window, at mid window, or at high window.', node);
      break;

    case '32kSwitcher':
    default:
      return 0x8000;
  }
}

function validateExplicitCpuBase(config, index, unitSize, cpuBase, activeMode, node) {
  switch (getMapperFamily(config)) {
    case 'nrom': {
      const expected = config.prgSize === BANK_16K ? 0xC000 : 0x8000;
      if (cpuBase !== expected) {
        throwAssemblyError(`NROM ${bankUnitName(unitSize)} bank must be assembled at $${expected.toString(16).padStart(4, '0')}.`, node);
      }
      return;
    }

    case 'unrom':
      if (cpuBase === 0x8000) return;
      if (cpuBase === 0xC000 && isLastBank(index, unitSize, config)) return;
      throwAssemblyError('UNROM 16k banks can be assembled at $8000, or the last bank at $C000.', node);

    case 'mmc3':
      if (unitSize !== BANK_8K) {
        throwAssemblyError('MMC3 PRG banks must use 8k granularity.', node);
      }
      if (cpuBase === 0xE000) {
        if (!isLastBank(index, unitSize, config)) {
          throwAssemblyError('MMC3 $E000 window is fixed to the last 8k bank.', node);
        }
        return;
      }
      if (cpuBase === 0xA000) return;
      if (cpuBase === 0x8000) {
        requireMmc3Mode(activeMode, node, cpuBase);
        if (activeMode === 'swap-high' && !isSecondLastBank(index, unitSize, config)) {
          throwAssemblyError('MMC3 low window is fixed to second-last in swap-high mode.', node);
        }
        return;
      }
      if (cpuBase === 0xC000) {
        requireMmc3Mode(activeMode, node, cpuBase);
        if (activeMode === 'swap-low' && !isSecondLastBank(index, unitSize, config)) {
          throwAssemblyError('MMC3 high window is fixed to second-last in swap-low mode.', node);
        }
        return;
      }
      throwAssemblyError('MMC3 8k banks must be assembled at low window, mid window, high window, or $E000.', node);

    case '32kSwitcher':
    default:
      if (cpuBase !== 0x8000) {
        throwAssemblyError(`${config.mapperName} 32k banks must be assembled at $8000.`, node);
      }
  }
}

function resolveBankDescriptor(config, item, unitSize, window, activeMode, node) {
  validateBankUnitSize(config, unitSize, node);
  validateBankIndex(item.index, unitSize, config, node);
  const cpuBase = window ? window.value : inferBankCpuBase(config, item, unitSize, activeMode, node);
  validateExplicitCpuBase(config, item.index, unitSize, cpuBase, activeMode, node);
  return makeBankDescriptor(config, item.index, unitSize, cpuBase, node);
}

function itemRoleForRangeIndex(index, start, end) {
  if (index === start.index && start.role) return start.role;
  if (index === end.index && end.role) return end.role;
  return null;
}

function expandBankSelectorBase(base, unitSize, config, symbols, node) {
  if (base.type === 'bankKeyword' && base.name === 'all') {
    return Array.from({ length: bankCountForUnit(config, unitSize) }, (_, index) => ({ index, role: null, raw: String(index) }));
  }

  if (base.type === 'bankRange') {
    const start = resolveBankEndpoint(base.start, unitSize, config, symbols, node);
    const end = resolveBankEndpoint(base.end, unitSize, config, symbols, node);
    validateBankIndex(start.index, unitSize, config, node);
    validateBankIndex(end.index, unitSize, config, node);
    if (end.index < start.index) {
      throwAssemblyError(`Bank range ${base.raw} is descending.`, node);
    }
    return Array.from({ length: end.index - start.index + 1 }, (_, offset) => {
      const index = start.index + offset;
      return { index, role: itemRoleForRangeIndex(index, start, end), raw: String(index) };
    });
  }

  const endpoint = resolveBankEndpoint(base, unitSize, config, symbols, node);
  validateBankIndex(endpoint.index, unitSize, config, node);
  return [endpoint];
}

function expandBankSelector(selector, config, symbols, node, activeMode) {
  if (selector.type !== 'bankSelector') {
    throwAssemblyError(`Invalid bank selector "${selector.raw || selector.type}".`, node);
  }
  const unitSize = selector.unitSize?.value || defaultBankUnitSize(config);
  const items = expandBankSelectorBase(selector.base, unitSize, config, symbols, node);
  return items.map((item) => resolveBankDescriptor(config, item, unitSize, selector.window, activeMode, node));
}

function expandBankSelection(selection, config, symbols, node, activeMode, directiveName = 'bank') {
  const descriptors = [];
  const seen = new Set();

  for (const selector of selection.selectors) {
    for (const descriptor of expandBankSelector(selector, config, symbols, node, activeMode)) {
      if (seen.has(descriptor.key)) {
        throwAssemblyError(`Bank ${descriptor.displayName} appears more than once in .${directiveName} selection.`, node);
      }
      seen.add(descriptor.key);
      descriptors.push(descriptor);
    }
  }

  if (descriptors.length === 0) {
    throwAssemblyError(`.${directiveName} selection cannot be empty.`, node);
  }
  return descriptors;
}

function ensureBankOffset(bankOffsets, descriptor) {
  if (!bankOffsets.has(descriptor.key)) bankOffsets.set(descriptor.key, 0);
  return bankOffsets.get(descriptor.key);
}

function alignBankOffsets(bankOffsets, descriptors, node) {
  const targetOffset = Math.max(...descriptors.map((descriptor) => ensureBankOffset(bankOffsets, descriptor)));

  for (const descriptor of descriptors) {
    const usable = usableBankSize(descriptor);
    if (targetOffset > usable) {
      throwAssemblyError(`Cannot align bank ${descriptor.displayName} past usable ${bankUnitName(descriptor.unitSize)} space.`, node);
    }
  }

  for (const descriptor of descriptors) {
    bankOffsets.set(descriptor.key, targetOffset);
  }

  return targetOffset;
}

function currentPlacements(activeDescriptors, bankOffsets, node) {
  if (!activeDescriptors?.length) {
    throwAssemblyError('No active PRG bank; use .bank before emitting code or data.', node);
  }
  return activeDescriptors.map((descriptor) => {
    const bankOffset = ensureBankOffset(bankOffsets, descriptor);
    return {
      bank: descriptor.key,
      bankKey: descriptor.key,
      bankDisplay: descriptor.displayName,
      bankDescriptor: descriptor,
      bankOffset,
      cpuAddress: descriptor.cpuBase + bankOffset,
      size: 0,
    };
  });
}

function assertBankCapacity(config, placement, size, node) {
  const usable = usableBankSize(placement.bankDescriptor);
  if (placement.bankOffset + size > usable) {
    const available = Math.max(0, usable - placement.bankOffset);
    throwAssemblyError(`PRG bank ${placement.bankDisplay} overflow while emitting ${describeNodeForError(node)}; needed ${size} byte(s), only ${available} byte(s) available.`, node);
  }
}

function describeNodeForError(node) {
  if (node?.label && !node.label.anonymous) return node.label.name;
  const statement = node?.statement;
  if (!statement) return 'line';
  if (statement.type === 'instruction') return statement.mnemonic.name;
  if (statement.type === 'declaration') return `.${statement.directive}`;
  if (statement.type === 'directive') return `.${statement.normalized}`;
  if (statement.type === 'constantDefinition') return statement.name;
  return statement.type || 'line';
}

function definePrgLabel(symbols, name, placement, node) {
  let symbol = symbols.get(name);
  if (!symbol) {
    symbol = {
      kind: 'address',
      origin: 'prg',
      addressSpace: 'cpu',
      space: 'prg',
      definitions: new Map(),
    };
    symbols.set(name, symbol);
  } else if (symbol.kind !== 'address' || symbol.origin !== 'prg') {
    throwAssemblyError(`Symbol "${name}" is already defined as ${symbol.origin || symbol.kind}.`, node);
  }

  if (symbol.definitions.has(placement.bankKey)) {
    throwAssemblyError(`Duplicate label "${name}" in bank ${placement.bankDisplay}.`, node);
  }

  symbol.definitions.set(placement.bankKey, {
    bank: placement.bankKey,
    bankDisplay: placement.bankDisplay,
    descriptor: placement.bankDescriptor,
    value: placement.cpuAddress,
    offset: placement.bankOffset,
    node,
  });
}

function parameterValueIfKnown(parameter, symbols, bank) {
  if (parameter.type === 'number') return parameter.value;
  const resolved = tryResolveAddressReference(parameter, symbols, { bank });
  if (resolved) return resolved.value;
  return null;
}

function instructionEncoding(statement, node, symbols, bank) {
  const mnemonic = statement.mnemonic.name.toLowerCase();
  const opcodes = OPCODES.get(mnemonic);
  if (!opcodes) throwAssemblyError(`Unsupported instruction "${statement.mnemonic.name}".`, node);

  const operand = statement.operand;
  let mode = operand.addressingMode;
  if (mode === 'direct' && 'rel' in opcodes) mode = 'rel';

  const variants = DIRECT_MODE_VARIANTS[mode];
  if (variants) {
    const value = parameterValueIfKnown(operand.parameter, symbols, bank);
    mode = variants.find((candidate) => candidate.startsWith('zp') && value !== null && value >= 0 && value <= 0xFF)
      || variants.find((candidate) => candidate.startsWith('abs'))
      || variants[0];
  }

  const opcode = opcodes[mode];
  if (opcode === undefined) {
    throwAssemblyError(`${statement.mnemonic.name} does not support ${operand.addressingMode} addressing.`, node);
  }
  return { mnemonic, mode, opcode };
}

function instructionLayoutPlan(statement, node, symbols, bank) {
  const encoding = instructionEncoding(statement, node, symbols, bank);
  const size = MODE_SIZES.get(encoding.mode);
  if (!Number.isInteger(size)) {
    throwAssemblyError(`Unsupported instruction mode "${encoding.mnemonic}/${encoding.mode}".`, node);
  }
  return {
    kind: 'instruction',
    ...encoding,
    size,
    operandSize: size - 1,
  };
}

function romDeclarationLayoutPlan(declaration, activeResources, node) {
  if (declaration.directive === 'text' || declaration.directive === 'ascii') {
    const bytes = textBytes(declaration, activeResources, node);
    return {
      kind: 'romDeclaration',
      directive: declaration.directive,
      bytes,
      size: bytes.length,
    };
  }

  const size = romDeclarationPrgSize(declaration, node);
  if (size === null) {
    return null;
  }

  return {
    kind: 'romDeclaration',
    directive: declaration.directive,
    size,
  };
}

function defaultActiveDescriptors(config) {
  if (getMapperFamily(config) === 'mmc3') {
    return null;
  }
  const unitSize = defaultBankUnitSize(config);
  return [resolveBankDescriptor(config, { index: 0, role: 'first', raw: '0' }, unitSize, null, null, { line: null, column: null })];
}

function layoutProgram(program, config, initialSymbols = new Map()) {
  const symbols = new Map(initialSymbols);
  const anonymousLabels = [];
  const bankOffsets = new Map();
  let activeBanks = defaultActiveDescriptors(config);
  let activeMode = null;
  const activeResources = new Map();

  for (let lineIndex = 0; lineIndex < program.body.length; lineIndex++) {
    const node = program.body[lineIndex];
    node.lineIndex = lineIndex;

    if (node.type === 'block') {
      continue;
    }

    if (node.statement?.type === 'constantDefinition') {
      node.placements = [];
      continue;
    }

    if (node.statement?.type === 'directive' && node.statement.normalized === 'mode') {
      activeMode = setPlacementMode(node.statement, node, config);
      node.placements = [];
      continue;
    }

    if (node.statement?.type === 'directive' && node.statement.normalized === 'bank') {
      activeBanks = expandBankSelection(requireBankSelectionArg(node.statement, node), config, symbols, node, activeMode, 'bank');
      node.placements = currentPlacements(activeBanks, bankOffsets, node);
      continue;
    }

    if (node.statement?.type === 'directive' && node.statement.normalized === 'bankalign') {
      const banks = expandBankSelection(requireBankSelectionArg(node.statement, node), config, symbols, node, activeMode, 'bankalign');
      if (banks.length < 2) {
        throwAssemblyError('.bankalign requires at least two banks.', node);
      }
      alignBankOffsets(bankOffsets, banks, node);
      node.placements = currentPlacements(banks, bankOffsets, node);
      continue;
    }

    node.placements = currentPlacements(activeBanks, bankOffsets, node);

    if (node.label) {
      for (const placement of node.placements) {
        if (node.label.type === 'anonymousLabel') {
          anonymousLabels.push({
            sign: node.label.sign,
            address: placement.cpuAddress,
            bank: placement.bankKey,
            bankDisplay: placement.bankDisplay,
            lineIndex,
            node,
          });
        } else {
          definePrgLabel(symbols, node.label.name, placement, node);
        }
      }
    }

    if (!node.statement) {
      continue;
    }

    if (node.statement.type === 'useResource') {
      activateResource(node.statement.resource, symbols, activeResources, (message) => throwAssemblyError(message, node));
      continue;
    }

    if (node.statement.type === 'resourceDeclaration' || node.statement.type === 'includeDeclaration') {
      continue;
    }

    if (node.statement.type === 'declaration') {
      if (node.statement.space !== 'rom') {
        throwAssemblyError('RAM declarations are only valid inside .ram blocks.', node);
      }
      const plan = romDeclarationLayoutPlan(node.statement, activeResources, node);
      if (!plan) {
        continue;
      }
      for (const placement of node.placements) {
        assertBankCapacity(config, placement, plan.size, node);
        placement.size = plan.size;
        placement.emitPlan = plan;
        bankOffsets.set(placement.bankKey, placement.bankOffset + plan.size);
      }
      continue;
    }

    if (node.statement.type === 'directive') {
      handleLayoutDirective(node.statement, node, config, activeBanks);
      continue;
    }

    for (const placement of node.placements) {
      const plan = instructionLayoutPlan(node.statement, node, symbols, placement.bankKey);
      assertBankCapacity(config, placement, plan.size, node);
      placement.size = plan.size;
      placement.emitPlan = plan;
      bankOffsets.set(placement.bankKey, placement.bankOffset + plan.size);
    }
  }

  return { symbols, anonymousLabels };
}

function handleLayoutDirective(statement, node, config, activeBanks) {
  switch (statement.normalized) {
    case 'nmi':
    case 'reset':
    case 'irq':
      requireArgCount(statement, 1, node);
      for (const descriptor of activeBanks || []) {
        if (vectorTailReserve(descriptor) !== 6) {
          throwAssemblyError(`.${statement.normalized} vector is only valid in a bank/window that contains $FFFA-$FFFF.`, node);
        }
        getVectorSet(config, descriptor)[statement.normalized] = requireSymbolReferenceArg(statement, node);
      }
      return;

    default:
      throwAssemblyError(`Unsupported directive ".${statement.name}".`, node);
  }
}

function resolveAnonymous(anonymousLabels, raw, node, bank) {
  if (!/^[+-]+$/.test(raw)) {
    return null;
  }

  const sign = raw[0];
  if (![...raw].every((ch) => ch === sign)) {
    throwAssemblyError(`Invalid anonymous label reference "${raw}".`, node);
  }

  const count = raw.length;
  const candidates = anonymousLabels
    .filter((label) => label.sign === sign && label.bank === bank)
    .sort((a, b) => a.lineIndex - b.lineIndex);

  const usable = sign === '-'
    ? candidates.filter((label) => label.lineIndex < node.lineIndex).reverse()
    : candidates.filter((label) => label.lineIndex > node.lineIndex);

  if (usable.length < count) {
    throwAssemblyError(`Cannot resolve anonymous label reference "${raw}" in bank ${bank}.`, node);
  }

  return usable[count - 1].address;
}

function resolveAddressParameter(parameter, symbols, anonymousLabels, node, bank) {
  if (parameter.type === 'anonymousReference') {
    return resolveAnonymous(anonymousLabels, parameter.name, node, bank);
  }
  if (parameter.type === 'number') return parameter.value;
  if (parameter.type === 'builtinConstant' || parameter.type === 'symbol') {
    return resolveAddressReference(parameter, symbols, (message) => throwAssemblyError(message, node), { bank }).value;
  }
  throwAssemblyError(`Unsupported address parameter "${parameter.raw}".`, node);
}

function assertAddressFitsMode(address, mode, raw, node) {
  if (['zp', 'zpx', 'zpy', 'indx', 'indy'].includes(mode) && (address < 0 || address > 0xFF)) {
    throwAssemblyError(`Address ${raw} is out of zero-page range.`, node);
  }
  if (['abs', 'absx', 'absy', 'ind'].includes(mode) && (address < 0 || address > 0xFFFF)) {
    throwAssemblyError(`Address ${raw} is out of range.`, node);
  }
}

function resolveImmediateParameter(parameter, node) {
  if (parameter.type !== 'immediateLiteral') {
    throwAssemblyError(`Unsupported immediate parameter "${parameter.raw}".`, node);
  }
  if (parameter.value.value < 0 || parameter.value.value > 0xFF) {
    throwAssemblyError(`Immediate value ${parameter.raw} is out of byte range.`, node);
  }
  return parameter.value.value;
}

function emitInstruction(statement, node, symbols, anonymousLabels, placement) {
  const { mnemonic, mode, opcode } = placement.emitPlan;

  if (mode === 'imp' || mode === 'acc') {
    return [opcode];
  }

  const parameter = statement.operand.parameter;

  if (mode === 'imm') {
    return [
      opcode,
      resolveImmediateParameter(parameter, node),
    ];
  }

  if (['zp', 'zpx', 'zpy', 'abs', 'absx', 'absy', 'ind', 'indx', 'indy'].includes(mode)) {
    const address = resolveAddressParameter(parameter, symbols, anonymousLabels, node, placement.bankKey);
    assertAddressFitsMode(address, mode, parameter.raw, node);
    if (placement.emitPlan.operandSize === 1) {
      return [opcode, address & 0xFF];
    }
    if (placement.emitPlan.operandSize === 2) {
      return [
        opcode,
        ...littleEndianWord(address),
      ];
    }
    throwAssemblyError(`Unsupported operand size ${placement.emitPlan.operandSize} for ${mnemonic}/${mode}.`, node);
  }

  if (mode === 'rel') {
    const target = resolveAddressParameter(parameter, symbols, anonymousLabels, node, placement.bankKey);
    const displacement = target - (placement.cpuAddress + 2);
    if (displacement < -128 || displacement > 127) {
      throwAssemblyError(`Branch target "${parameter.raw}" is out of range in bank ${placement.bankDisplay}.`, node);
    }
    return [
      opcode,
      signedByte(displacement),
    ];
  }

  throwAssemblyError(`Unsupported instruction mode "${mnemonic}/${mode}".`, node);
}

function resolveDataValue(arg, symbols, node, bank) {
  if (arg.type === 'number') {
    return arg.value;
  }
  if (arg.type === 'builtinConstant' || arg.type === 'symbol') {
    return resolveAddressReference(arg, symbols, (message) => throwAssemblyError(message, node), { bank }).value;
  }
  throwAssemblyError(`Unsupported data value "${arg.raw}".`, node);
}

function emitRomDeclaration(declaration, node, symbols, placement, bank) {
  if (declaration.directive === 'text' || declaration.directive === 'ascii') {
    return placement.emitPlan.bytes;
  }
  if (declaration.directive === 'db') {
    const bytes = [];
    for (const arg of declaration.args) {
      if (arg.type === 'string') {
        for (let i = 0; i < arg.value.length; i++) {
          bytes.push(arg.value.charCodeAt(i) & 0xFF);
        }
        continue;
      }

      const value = resolveDataValue(arg, symbols, node, bank);
      if (value < 0 || value > 0xFF) {
        throwAssemblyError(`.db value "${arg.raw}" is out of byte range.`, node);
      }
      bytes.push(value & 0xFF);
    }
    return bytes;
  }

  if (declaration.directive === 'dw') {
    const bytes = [];
    for (const arg of declaration.args) {
      const value = resolveDataValue(arg, symbols, node, bank);
      if (value < 0 || value > 0xFFFF) {
        throwAssemblyError(`.dw value "${arg.raw}" is out of word range.`, node);
      }
      bytes.push(...littleEndianWord(value));
    }
    return bytes;
  }

  return null;
}

function emitBytesIntoPrg(prg, config, placement, bytes, node) {
  if (bytes.length !== placement.emitPlan.size) {
    throwAssemblyError(`Internal emit mismatch in bank ${placement.bankDisplay}: planned ${placement.emitPlan.size} byte(s), emitted ${bytes.length}.`, node);
  }

  const physical = placement.bankDescriptor.romOffset + placement.bankOffset;

  for (let i = 0; i < bytes.length; i++) {
    prg[physical + i] = bytes[i];
  }
}

function emitPrgPlacement(prg, config, symbols, anonymousLabels, node, placement) {
  if (!placement.emitPlan) {
    return;
  }

  let bytes = null;
  if (placement.emitPlan.kind === 'instruction') {
    bytes = emitInstruction(node.statement, node, symbols, anonymousLabels, placement);
  } else if (placement.emitPlan.kind === 'romDeclaration') {
    bytes = emitRomDeclaration(node.statement, node, symbols, placement, placement.bankKey);
  } else {
    throwAssemblyError(`Unknown emit plan kind "${placement.emitPlan.kind}".`, node);
  }

  emitBytesIntoPrg(prg, config, placement, bytes, node);
}

function emitChrInclude(statement, node, state) {
  if (statement.includeType !== 'chr') {
    return;
  }

  if (statement.args.length === 0) {
    throwAssemblyError('.include chr expects at least one filename.', node);
  }

  for (const arg of statement.args) {
    if (arg.type !== 'string') {
      throwAssemblyError('.include chr expects quoted filenames.', node);
    }

    const fileName = arg.value;
    const resolvedPath = path.resolve(state.baseDir, fileName);
    let data;
    try {
      data = fs.readFileSync(resolvedPath);
    } catch (error) {
      throwAssemblyError(`Could not read CHR file "${fileName}".`, node);
    }

    const writable = Math.max(0, Math.min(data.length, state.chr.length - state.chrOffset));
    if (writable > 0) {
      data.copy(state.chr, state.chrOffset, 0, writable);
      state.chrOffset += writable;
    }
  }
}

function emitNode(node, state, config) {
  const statement = node.statement;

  if (statement?.type === 'includeDeclaration' && statement.includeType === 'chr') {
    emitChrInclude(statement, node, state);
  }

  if (!statement || !node.placements?.length) {
    return;
  }

  for (const placement of node.placements) {
    emitPrgPlacement(state.prg, config, state.symbols, state.anonymousLabels, node, placement);
  }
}

function emitProgram(program, config, symbols, anonymousLabels, options) {
  const header = buildHeader(config);
  const state = {
    prg: Buffer.alloc(config.prgSize, 0xFF),
    chr: Buffer.alloc(config.chrSize, 0x00),
    chrOffset: 0,
    baseDir: options.baseDir || process.cwd(),
    symbols,
    anonymousLabels,
  };

  for (const node of program.body) {
    emitNode(node, state, config);
  }

  writeVectors(state.prg, config, symbols);

  return {
    header,
    prg: state.prg,
    chr: state.chr,
    output: Buffer.concat([header, state.prg, state.chr]),
  };
}

function vectorBankDescriptors(config) {
  switch (getMapperFamily(config)) {
    case 'nrom':
      return [makeBankDescriptor(config, 0, config.prgSize, config.prgSize === BANK_16K ? 0xC000 : 0x8000, { line: null, column: null })];

    case 'unrom': {
      const last = bankCountForUnit(config, BANK_16K) - 1;
      return [makeBankDescriptor(config, last, BANK_16K, 0xC000, { line: null, column: null })];
    }

    case 'mmc3': {
      const last = bankCountForUnit(config, BANK_8K) - 1;
      return [makeBankDescriptor(config, last, BANK_8K, 0xE000, { line: null, column: null })];
    }

    case '32kSwitcher':
    default:
      return Array.from({ length: bankCountForUnit(config, BANK_32K) }, (_, index) => makeBankDescriptor(config, index, BANK_32K, 0x8000, { line: null, column: null }));
  }
}

function writeVectors(prg, config, symbols) {
  for (const descriptor of vectorBankDescriptors(config)) {
    const vectors = config.vectors.get(descriptor.key) || {};
    for (const name of ['nmi', 'reset', 'irq']) {
      if (!vectors[name]) {
        throwAssemblyError(`.${name} vector is required for bank ${descriptor.displayName}.`, { line: null, column: null });
      }
    }

    const base = descriptor.romOffset + descriptor.unitSize - 6;
    const ordered = [vectors.nmi, vectors.reset, vectors.irq];

    for (let i = 0; i < ordered.length; i++) {
      const address = resolveAddressReference(ordered[i], symbols, (message) => throwAssemblyError(message, { line: null, column: null }), { bank: descriptor.key }).value;
      const [lo, hi] = littleEndianWord(address);
      prg[base + (i * 2)] = lo;
      prg[base + (i * 2) + 1] = hi;
    }
  }
}

function buildHeader(config) {
  const header = Buffer.alloc(16, 0);
  header[0] = 0x4E;
  header[1] = 0x45;
  header[2] = 0x53;
  header[3] = 0x1A;
  header[4] = config.prgSize / PRG_UNIT;
  header[5] = config.chrSize / CHR_UNIT;

  const mapperLow = (config.mapper & 0x0F) << 4;
  const mapperHigh = config.mapper & 0xF0;
  const mirroring = config.mirroring === 'vertical' ? 0x01 : 0x00;
  const fourScreen = config.fourScreen ? 0x08 : 0x00;

  header[6] = mapperLow | mirroring | fourScreen;
  header[7] = mapperHigh;
  header[8] = config.prgRamSize > 0 ? Math.ceil(config.prgRamSize / CHR_UNIT) : 0;
  return header;
}

export function assembleProgram(program, options = {}) {
  validateProgram(program);
  const config = buildConfig(program);
  const symbolTable = buildSymbolTable(program, config, options, (message, node) => throwAssemblyError(message, node));
  const { symbols, anonymousLabels } = layoutProgram(program, config, symbolTable.symbols);
  const emitted = emitProgram(program, config, symbols, anonymousLabels, options);

  return {
    ok: true,
    output: emitted.output,
    diagnostics: [],
    ast: program,
    symbols,
    ram: symbolTable.ram,
    sourceMap: null,
  };
}
