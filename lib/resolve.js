const BUILTIN_CONSTANT_NAMES = new Set([
  'PPUCTRL',
  'PPUMASK',
  'PPUSTATUS',
  'OAMADDR',
  'OAMDATA',
  'PPUSCROLL',
  'PPUADDR',
  'PPUDATA',
  'OAMDMA',
  'SQ1_VOL',
  'SQ1_SWEEP',
  'SQ1_LO',
  'SQ1_HI',
  'SQ2_VOL',
  'SQ2_SWEEP',
  'SQ2_LO',
  'SQ2_HI',
  'TRI_LINEAR',
  'TRI_LO',
  'TRI_HI',
  'NOISE_VOL',
  'NOISE_LO',
  'NOISE_HI',
  'DMC_FREQ',
  'DMC_RAW',
  'DMC_START',
  'DMC_LEN',
  'APUSTATUS',
  'APUFRAME',
  'JOY1',
  'JOY2',
  'MMC1_CONTROL',
  'MMC1_CHR0',
  'MMC1_CHR1',
  'MMC1_PRG',
  'UXROM_BANK',
  'CNROM_BANK',
  'MMC3_BANKSEL',
  'MMC3_BANKDATA',
  'MMC3_MIRROR',
  'MMC3_RAMPROTECT',
  'MMC3_IRQLATCH',
  'MMC3_IRQRELOAD',
  'MMC3_IRQDISABLE',
  'MMC3_IRQENABLE',
  'AXROM_BANK',
  'BNROM_BANK',
  'GXROM_BANK',
]);

export function isBuiltinConstantName(name) {
  return BUILTIN_CONSTANT_NAMES.has(String(name).toUpperCase());
}

function resolveAddressConstant(symbol) {
  if (symbol.kind !== 'constant' || symbol.valueType !== 'address') return null;
  return {
    kind: 'address',
    origin: 'constant',
    addressSpace: symbol.addressSpace || 'cpu',
    value: symbol.value,
    constant: symbol,
  };
}

function resolveBuiltinConstant(reference) {
  return {
    kind: 'address',
    origin: 'builtin',
    addressSpace: 'cpu',
    value: reference.value,
  };
}

function resolvePrgAddress(symbol, bank) {
  if (bank === undefined || bank === null) return null;
  const definition = symbol.definitions?.get(bank);
  if (!definition) return null;
  return {
    ...symbol,
    value: definition.value,
    bank: definition.bank,
    offset: definition.offset,
    definition,
  };
}

export function tryResolveSymbolicReference(reference, symbols) {
  if (reference.type === 'builtinConstant') {
    return resolveBuiltinConstant(reference);
  }
  if (reference.type === 'symbol') {
    return symbols.get(reference.name) || null;
  }
  return null;
}

export function tryResolveAddressReference(reference, symbols, options = {}) {
  const resolved = tryResolveSymbolicReference(reference, symbols);
  if (resolved?.kind === 'constant') return resolveAddressConstant(resolved);
  if (resolved?.kind !== 'address') return null;
  if (resolved.origin === 'prg') return resolvePrgAddress(resolved, options.bank);
  return resolved;
}

export function resolveAddressReference(reference, symbols, fail, options = {}) {
  const resolved = tryResolveSymbolicReference(reference, symbols);
  if (!resolved) {
    fail(`Undefined symbol "${reference.name}".`);
  }
  if (resolved.kind === 'constant') {
    const addressConstant = resolveAddressConstant(resolved);
    if (!addressConstant) {
      fail(`Symbol "${reference.name}" is not an address.`);
    }
    return addressConstant;
  }
  if (resolved.kind !== 'address') {
    fail(`Symbol "${reference.name}" is not an address.`);
  }
  if (resolved.origin !== 'prg') {
    return resolved;
  }

  if (options.bank === undefined || options.bank === null) {
    fail(`Cannot resolve PRG symbol "${reference.name}" without a bank context.`);
  }

  const bankResolved = resolvePrgAddress(resolved, options.bank);
  if (!bankResolved) {
    fail(`Undefined symbol "${reference.name}" in bank ${options.bank}.`);
  }
  return bankResolved;
}

export function resolveResourceReference(reference, symbols, fail) {
  const resolved = tryResolveSymbolicReference(reference, symbols);
  if (!resolved) {
    fail(`Undefined symbol "${reference.name}".`);
  }
  if (resolved.kind !== 'resource') {
    fail(`Symbol "${reference.name}" is not a resource.`);
  }
  return resolved;
}
