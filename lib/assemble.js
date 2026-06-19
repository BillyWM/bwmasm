import fs from 'node:fs';
import path from 'node:path';
import { BwmAsmError, createDiagnostic } from './diagnostics.js';
import { encodeTableText, loadTable } from './tables.js';

const PRG_UNIT = 16 * 1024;
const CHR_UNIT = 8 * 1024;
const BANK_32K = 32 * 1024;
const CPU_RAM_START = 0x0000;
const CPU_RAM_END = 0x07FF;
const PRG_RAM_START = 0x6000;
const PRG_RAM_END = 0x7FFF;

const MAPPERS = new Map([
  ['nrom', 0],
  ['axrom', 7],
  ['bnrom', 34],
]);

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

function collectTables(program, options) {
  const tables = new Map();
  const baseDir = options.baseDir || process.cwd();
  for (const node of program.body) {
    const statement = node.statement;
    if (statement?.type !== 'directive' || statement.normalized !== 'includeTable') continue;
    if (tables.has(statement.args.name)) throwAssemblyError(`Duplicate table name "${statement.args.name}".`, node);
    tables.set(statement.args.name, loadTable(statement.args.file.value, baseDir, (message) => throwAssemblyError(message, node)));
  }
  return tables;
}

function textBytes(declaration, activeTable, tables, node) {
  if (declaration.directive === 'ascii') {
    const bytes = [...declaration.text.value].map((character) => character.charCodeAt(0));
    if (bytes.some((byte) => byte > 0x7F)) throwAssemblyError('.ascii accepts only ASCII characters.', node);
    return [...bytes, 0xFF];
  }
  if (!activeTable) throwAssemblyError('.text requires an active table selected with .use.', node);
  return encodeTableText(declaration.text.value, tables.get(activeTable), (message) => throwAssemblyError(message, node));
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

function requireSizeArg(statement, node) {
  const arg = firstArg(statement, node);
  if (arg.type !== 'size') {
    throwAssemblyError(`.${statement.normalized} expects a size like 32k.`, node);
  }
  return arg.value;
}

function requireNumberArg(statement, node) {
  const arg = firstArg(statement, node);
  if (arg.type !== 'number') {
    throwAssemblyError(`.${statement.normalized} expects a number.`, node);
  }
  return arg.value;
}

function requireSymbolArg(statement, node) {
  const arg = firstArg(statement, node);
  if (arg.type !== 'symbol') {
    throwAssemblyError(`.${statement.normalized} expects a symbol.`, node);
  }
  return arg.name;
}

function requireStringArgs(statement, node) {
  if (statement.args.length === 0) {
    throwAssemblyError(`.${statement.normalized} expects at least one filename.`, node);
  }
  for (const arg of statement.args) {
    if (arg.type !== 'string') {
      throwAssemblyError(`.${statement.normalized} expects quoted filenames.`, node);
    }
  }
  return statement.args.map((arg) => arg.value);
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
  if (arg.type === 'number' || arg.type === 'symbol') {
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
        if (arg.type !== 'number' && arg.type !== 'symbol') {
          throwAssemblyError('.dw supports numbers and symbols for now.', node);
        }
      }
      return declaration.args.length * 2;

    default:
      return null;
  }
}

function mapperNumber(value, node) {
  if (typeof value === 'number') {
    return value;
  }

  const normalized = value.toLowerCase();
  if (!MAPPERS.has(normalized)) {
    throwAssemblyError(`Unsupported mapper "${value}".`, node);
  }
  return MAPPERS.get(normalized);
}

function mapperNameFromArg(arg, node) {
  if (arg.type === 'symbol') {
    return arg.name.toLowerCase();
  }
  if (arg.type === 'number') {
    return arg.value;
  }
  throwAssemblyError('.nesmapper expects a mapper name or number.', node);
}

function buildConfig(program) {
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

  for (const node of program.body) {
    const statement = node.statement;
    if (!statement || statement.type !== 'directive') {
      continue;
    }

    switch (statement.normalized) {
      case 'nesprg':
        requireArgCount(statement, 1, node);
        config.prgSize = requireSizeArg(statement, node);
        break;

      case 'neschr':
        requireArgCount(statement, 1, node);
        config.chrSize = requireSizeArg(statement, node);
        break;

      case 'nesprgram':
        requireArgCount(statement, 1, node);
        config.prgRamSize = requireSizeArg(statement, node);
        break;

      case 'nesmapper': {
        requireArgCount(statement, 1, node);
        const mapperArg = mapperNameFromArg(firstArg(statement, node), node);
        config.mapperName = typeof mapperArg === 'string' ? mapperArg : `mapper${mapperArg}`;
        config.mapper = mapperNumber(mapperArg, node);
        break;
      }

      case 'nesmirroring': {
        requireArgCount(statement, 1, node);
        const mode = requireSymbolArg(statement, node).toLowerCase();
        if (mode === 'horizontal' || mode === 'vertical') {
          config.mirroring = mode;
          config.fourScreen = false;
        } else if (mode === 'four_screen' || mode === 'fourscreen') {
          config.mirroring = 'horizontal';
          config.fourScreen = true;
        } else {
          throwAssemblyError(`Unsupported mirroring mode "${mode}".`, node);
        }
        break;
      }

      default:
        break;
    }
  }

  if (!config.prgSize) {
    throwAssemblyError('.nesprg is required.', program.body[0] || program);
  }

  if (config.prgSize % PRG_UNIT !== 0) {
    throwAssemblyError('.nesprg size must be a multiple of 16k.', program.body[0] || program);
  }

  if (config.chrSize % CHR_UNIT !== 0) {
    throwAssemblyError('.neschr size must be a multiple of 8k.', program.body[0] || program);
  }

  if (config.prgRamSize < 0 || config.prgRamSize % CHR_UNIT !== 0) {
    throwAssemblyError('.nesprgram size must be a multiple of 8k.', program.body[0] || program);
  }

  if (config.mapper === 0) {
    if (config.prgSize !== 16 * 1024 && config.prgSize !== BANK_32K) {
      throwAssemblyError('NROM .nesprg must be 16k or 32k.', program.body[0] || program);
    }
    config.bankSize = config.prgSize;
    config.bankCount = 1;
  } else {
    if (config.prgSize % BANK_32K !== 0) {
      throwAssemblyError('32k switcher .nesprg size must be a multiple of 32k.', program.body[0] || program);
    }
    config.bankSize = BANK_32K;
    config.bankCount = config.prgSize / BANK_32K;
  }

  return config;
}

function bankCpuBase(config) {
  if (config.mapper === 0 && config.prgSize === 16 * 1024) {
    return 0xC000;
  }
  return 0x8000;
}

function bankOffsetFromNumber(config, bank, node) {
  if (!Number.isInteger(bank) || bank < 0 || bank >= config.bankCount) {
    throwAssemblyError(`Bank ${bank} is out of range.`, node);
  }
  return bank * config.bankSize;
}

function getVectorSet(config, bank) {
  if (!config.vectors.has(bank)) {
    config.vectors.set(bank, {});
  }
  return config.vectors.get(bank);
}

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

function validateRamRange(name, start, width, config, node) {
  const end = start + width - 1;
  const region = writableRegionForRange(start, width, config);
  if (region) {
    return region;
  }

  if (start >= PRG_RAM_START && start <= PRG_RAM_END && config.prgRamSize === 0) {
    throwAssemblyError(`RAM declaration "${name}" at $${start.toString(16).padStart(4, '0')} requires PRG RAM. Add .nesprgram if this board has PRG RAM.`, node);
  }

  throwAssemblyError(`RAM declaration "${name}" range $${start.toString(16).padStart(4, '0')}-$${end.toString(16).padStart(4, '0')} is not inside a writable RAM region.`, node);
}

function collectRamSymbols(program, config) {
  const symbols = new Map();
  const declarations = [];
  let autoAddress = CPU_RAM_START;

  for (const block of program.body) {
    if (!block || block.type !== 'block' || block.kind !== 'ram') {
      continue;
    }

    let currentAddress = block.placement?.type === 'absolute'
      ? block.placement.address
      : autoAddress;
    const advancesAutoCounter = !block.placement;

    for (const item of block.items) {
      if (item.type !== 'declaration' || item.space !== 'ram') {
        continue;
      }

      if (item.directive === 'bytes' && item.width == null) {
        throwAssemblyError('.bytes requires a size; use .db for one byte.', item);
      }

      const width = item.width;
      if (!Number.isInteger(width) || width < 1) {
        throwAssemblyError(`RAM declaration "${item.name}" has invalid width.`, item);
      }
      if (symbols.has(item.name)) {
        throwAssemblyError(`Duplicate RAM symbol "${item.name}".`, item);
      }

      const region = validateRamRange(item.name, currentAddress, width, config, item);
      const symbol = {
        kind: 'cpuAddress',
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

    if (advancesAutoCounter) {
      autoAddress = currentAddress;
    }
  }

  return { symbols, declarations };
}

const DIRECT_MODE_VARIANTS = {
  direct: ['zp', 'abs'],
  directX: ['zpx', 'absx'],
  directY: ['zpy', 'absy'],
};

function parameterValueIfKnown(parameter, symbols) {
  if (parameter.type === 'number') return parameter.value;
  if (parameter.type === 'symbol') return symbols.get(parameter.name)?.value ?? null;
  return null;
}

function instructionEncoding(statement, node, symbols) {
  const mnemonic = statement.mnemonic.name.toLowerCase();
  const opcodes = OPCODES.get(mnemonic);
  if (!opcodes) throwAssemblyError(`Unsupported instruction "${statement.mnemonic.name}".`, node);

  const operand = statement.operand;
  let mode = operand.addressingMode;
  if (mode === 'direct' && 'rel' in opcodes) mode = 'rel';

  const variants = DIRECT_MODE_VARIANTS[mode];
  if (variants) {
    const value = parameterValueIfKnown(operand.parameter, symbols);
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

function instructionSize(statement, node, symbols) {
  return MODE_SIZES.get(instructionEncoding(statement, node, symbols).mode);
}

function collectLayout(program, config, tables, initialSymbols = new Map()) {
  const symbols = new Map(initialSymbols);
  const anonymousLabels = [];
  const bankOffsets = new Map();
  let currentBank = 0;
  let activeTable = null;

  bankOffsets.set(0, 0);

  for (let lineIndex = 0; lineIndex < program.body.length; lineIndex++) {
    const node = program.body[lineIndex];
    node.lineIndex = lineIndex;

    if (node.type === 'block') {
      continue;
    }

    if (node.statement?.type === 'directive' && node.statement.normalized === 'bank') {
      requireArgCount(node.statement, 1, node);
      currentBank = requireNumberArg(node.statement, node);
      bankOffsetFromNumber(config, currentBank, node);
      if (!bankOffsets.has(currentBank)) {
        bankOffsets.set(currentBank, 0);
      }
      node.bank = currentBank;
      node.bankOffset = bankOffsets.get(currentBank);
      continue;
    }

    const bankOffset = bankOffsets.get(currentBank) || 0;
    const cpuAddress = bankCpuBase(config) + bankOffset;
    node.bank = currentBank;
    node.bankOffset = bankOffset;
    node.cpuAddress = cpuAddress;

    if (node.label) {
      if (node.label.type === 'anonymousLabel') {
        anonymousLabels.push({
          sign: node.label.sign,
          address: cpuAddress,
          bank: currentBank,
          lineIndex,
          node,
        });
      } else {
        if (symbols.has(node.label.name)) {
          throwAssemblyError(`Duplicate label "${node.label.name}".`, node);
        }
        symbols.set(node.label.name, {
          kind: 'cpuAddress',
          value: cpuAddress,
          space: 'prg',
          bank: currentBank,
          offset: bankOffset,
        });
      }
    }

    if (!node.statement) {
      continue;
    }

    if (node.statement.type === 'directive' && node.statement.normalized === 'useTable') {
      if (!tables.has(node.statement.args.name)) throwAssemblyError(`Unknown table "${node.statement.args.name}".`, node);
      activeTable = node.statement.args.name;
      continue;
    }

    if (node.statement.type === 'declaration') {
      if (node.statement.space !== 'rom') {
        throwAssemblyError('RAM declarations are only valid inside .ram blocks.', node);
      }
      const size = node.statement.directive === 'text' || node.statement.directive === 'ascii'
        ? textBytes(node.statement, activeTable, tables, node).length
        : romDeclarationPrgSize(node.statement, node);
      if (bankOffset + size > config.bankSize - 6) {
        throwAssemblyError('PRG bank overflow.', node);
      }
      bankOffsets.set(currentBank, bankOffset + size);
      continue;
    }

    if (node.statement.type === 'directive') {
      handleLayoutDirective(node.statement, node, config, currentBank);
      continue;
    }

    const size = instructionSize(node.statement, node, symbols);
    if (bankOffset + size > config.bankSize - 6) {
      throwAssemblyError('PRG bank overflow.', node);
    }
    bankOffsets.set(currentBank, bankOffset + size);
  }

  return { symbols, anonymousLabels };
}

function handleLayoutDirective(statement, node, config, currentBank) {
  switch (statement.normalized) {
    case 'nesprg':
    case 'neschr':
    case 'nesmapper':
    case 'nesmirroring':
    case 'nesprgram':
    case 'incchr':
    case 'includeTable':
    case 'useTable':
      return;

    case 'nmi':
    case 'reset':
    case 'irq':
      requireArgCount(statement, 1, node);
      getVectorSet(config, currentBank)[statement.normalized] = requireSymbolArg(statement, node);
      return;

    default:
      throwAssemblyError(`Unsupported directive ".${statement.name}".`, node);
  }
}

function resolveSymbol(symbols, name, node) {
  const symbol = symbols.get(name);
  if (!symbol) {
    throwAssemblyError(`Undefined symbol "${name}".`, node);
  }
  return symbol.value;
}

function resolveAnonymous(anonymousLabels, raw, node) {
  if (!/^[+-]+$/.test(raw)) {
    return null;
  }

  const sign = raw[0];
  if (![...raw].every((ch) => ch === sign)) {
    throwAssemblyError(`Invalid anonymous label reference "${raw}".`, node);
  }

  const count = raw.length;
  const candidates = anonymousLabels
    .filter((label) => label.sign === sign && label.bank === node.bank)
    .sort((a, b) => a.lineIndex - b.lineIndex);

  const usable = sign === '-'
    ? candidates.filter((label) => label.lineIndex < node.lineIndex).reverse()
    : candidates.filter((label) => label.lineIndex > node.lineIndex);

  if (usable.length < count) {
    throwAssemblyError(`Cannot resolve anonymous label reference "${raw}".`, node);
  }

  return usable[count - 1].address;
}

function resolveAddressParameter(parameter, symbols, anonymousLabels, node) {
  if (parameter.type === 'anonymousReference') {
    return resolveAnonymous(anonymousLabels, parameter.name, node);
  }
  if (parameter.type === 'number') return parameter.value;
  if (parameter.type === 'symbol') return resolveSymbol(symbols, parameter.name, node);
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
  if (parameter.type !== 'number') {
    throwAssemblyError(`Unsupported immediate parameter "${parameter.raw}".`, node);
  }
  if (parameter.value < 0 || parameter.value > 0xFF) {
    throwAssemblyError(`Immediate value ${parameter.raw} is out of byte range.`, node);
  }
  return parameter.value;
}

function emitInstruction(statement, node, symbols, anonymousLabels) {
  const { mnemonic, mode, opcode } = instructionEncoding(statement, node, symbols);
  const parameter = statement.operand.parameter;

  if (mode === 'imp' || mode === 'acc') {
    return [opcode];
  }

  if (mode === 'imm') {
    return [
      opcode,
      resolveImmediateParameter(parameter, node),
    ];
  }

  if (['zp', 'zpx', 'zpy', 'abs', 'absx', 'absy', 'ind', 'indx', 'indy'].includes(mode)) {
    const address = resolveAddressParameter(parameter, symbols, anonymousLabels, node);
    assertAddressFitsMode(address, mode, parameter.raw, node);
    if (MODE_SIZES.get(mode) === 2) {
      return [opcode, address & 0xFF];
    }
    return [
      opcode,
      ...littleEndianWord(address),
    ];
  }

  if (mode === 'rel') {
    const target = resolveAddressParameter(parameter, symbols, anonymousLabels, node);
    const displacement = target - (node.cpuAddress + 2);
    if (displacement < -128 || displacement > 127) {
      throwAssemblyError(`Branch target "${parameter.raw}" is out of range.`, node);
    }
    return [
      opcode,
      signedByte(displacement),
    ];
  }

  throwAssemblyError(`Unsupported instruction mode "${mnemonic}/${mode}".`, node);
}

function resolveDataValue(arg, symbols, node) {
  if (arg.type === 'number') {
    return arg.value;
  }
  if (arg.type === 'symbol') {
    return resolveSymbol(symbols, arg.name, node);
  }
  throwAssemblyError(`Unsupported data value "${arg.raw}".`, node);
}

function emitRomDeclaration(declaration, node, symbols, activeTable, tables) {
  if (declaration.directive === 'text' || declaration.directive === 'ascii') {
    return textBytes(declaration, activeTable, tables, node);
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

      const value = resolveDataValue(arg, symbols, node);
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
      const value = resolveDataValue(arg, symbols, node);
      if (value < 0 || value > 0xFFFF) {
        throwAssemblyError(`.dw value "${arg.raw}" is out of word range.`, node);
      }
      bytes.push(...littleEndianWord(value));
    }
    return bytes;
  }

  return null;
}

function emitPrg(program, config, symbols, anonymousLabels, tables) {
  const prg = Buffer.alloc(config.prgSize, 0xFF);
  let activeTable = null;

  for (const node of program.body) {
    if (!node.statement) {
      continue;
    }

    if (node.statement.type === 'directive' && node.statement.normalized === 'useTable') {
      activeTable = node.statement.args.name;
      continue;
    }

    let bytes = null;
    if (node.statement.type === 'instruction') {
      bytes = emitInstruction(node.statement, node, symbols, anonymousLabels);
    } else if (node.statement.type === 'declaration' && node.statement.space === 'rom') {
      bytes = emitRomDeclaration(node.statement, node, symbols, activeTable, tables);
    }

    if (!bytes) {
      continue;
    }

    const physical = bankOffsetFromNumber(config, node.bank, node) + node.bankOffset;

    for (let i = 0; i < bytes.length; i++) {
      prg[physical + i] = bytes[i];
    }
  }

  return prg;
}

function emitChr(program, config, options) {
  const chr = Buffer.alloc(config.chrSize, 0x00);
  let chrOffset = 0;
  const baseDir = options.baseDir || process.cwd();

  for (const node of program.body) {
    const statement = node.statement;
    if (!statement || statement.type !== 'directive' || statement.normalized !== 'incchr') {
      continue;
    }

    for (const fileName of requireStringArgs(statement, node)) {
      const resolvedPath = path.resolve(baseDir, fileName);
      let data;
      try {
        data = fs.readFileSync(resolvedPath);
      } catch (error) {
        throwAssemblyError(`Could not read CHR file "${fileName}".`, node);
      }

      const writable = Math.max(0, Math.min(data.length, chr.length - chrOffset));
      if (writable > 0) {
        data.copy(chr, chrOffset, 0, writable);
        chrOffset += writable;
      }
    }
  }

  return chr;
}

function writeVectors(prg, config, symbols) {
  for (let bank = 0; bank < config.bankCount; bank++) {
    const vectors = config.vectors.get(bank) || {};
    for (const name of ['nmi', 'reset', 'irq']) {
      if (!vectors[name]) {
        throwAssemblyError(`.${name} vector is required for bank ${bank}.`, { line: null, column: null });
      }
    }

    const base = bankOffsetFromNumber(config, bank, null) + config.bankSize - 6;
    const ordered = [vectors.nmi, vectors.reset, vectors.irq];

    for (let i = 0; i < ordered.length; i++) {
      const address = resolveSymbol(symbols, ordered[i], { line: null, column: null });
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
  const config = buildConfig(program);
  const tables = collectTables(program, options);
  const ram = collectRamSymbols(program, config);
  const { symbols, anonymousLabels } = collectLayout(program, config, tables, ram.symbols);
  const prg = emitPrg(program, config, symbols, anonymousLabels, tables);
  writeVectors(prg, config, symbols);

  const header = buildHeader(config);
  const chr = emitChr(program, config, options);
  const output = Buffer.concat([header, prg, chr]);

  return {
    ok: true,
    output,
    diagnostics: [],
    ast: program,
    symbols,
    ram,
    sourceMap: null,
  };
}
