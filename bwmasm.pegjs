{
  function join(chars) {
    return chars.join('');
  }

  function makeNumber(raw, base) {
    const digits = raw.replace(/^#?[$%]?/, '').replace(/_/g, '');
    return { type: 'number', raw, base, value: parseInt(digits, base) };
  }

  function makeBuiltinConstant(name, value) {
    return { type: 'builtinConstant', raw: name, name, value };
  }

  function makeImmediateLiteral(value) {
    return { type: 'immediateLiteral', raw: value.raw, value };
  }

  function makeSize(raw) {
    return { type: 'size', raw, unit: 'k', value: parseInt(raw, 10) * 1024 };
  }

  function makeSymbol(name) {
    return { type: 'symbol', raw: name, name };
  }

  function makeStringArgument(raw) {
    return { type: 'string', raw, value: raw.slice(1, -1) };
  }

  function makeDirective(name, args) {
    return { type: 'directive', name, normalized: name, args };
  }

  function makeConstantValue(valueType, literal) {
    return { type: 'constantValue', valueType, raw: literal.raw, base: literal.base, value: literal.value };
  }

  function makeConstantDefinition(name, value) {
    return { type: 'constantDefinition', name, value };
  }

  function makeResourceDeclaration(resourceType, file, name) {
    return { type: 'resourceDeclaration', resourceType, file, name };
  }

  function makeUseResource(resource) {
    return { type: 'useResource', resource };
  }

  function makeMapperKeyword(name, value) {
    return { type: 'mapperKeyword', raw: name, name, value };
  }

  function makeMirroringKeyword(name, value, fourScreen) {
    return { type: 'mirroringKeyword', raw: name, name, value, fourScreen };
  }

  function makeProgram(lines) {
    return { type: 'program', body: lines.filter(Boolean) };
  }

  function makeRamHeader(placement) {
    return { placement: placement || null };
  }

  function makeRamPlacement(address) {
    return { type: 'absolute', address, raw: address.raw };
  }

  function makeRamEnd() {
    return { type: 'blockEnd', kind: 'ram' };
  }

  function makeComment(comment) {
    return { type: 'comment', comment };
  }

  function makeLine(label, statement) {
    return { type: 'line', label, statement };
  }

  function makeLabel(name) {
    return { type: 'label', name, anonymous: false };
  }

  function makeAnonymousLabel(sign) {
    return { type: 'anonymousLabel', sign, anonymous: true };
  }

  function makeString() {
    return text();
  }

  function makeMnemonic(name) {
    return { type: 'mnemonic', name };
  }

  function makeOperand(addressingMode, parameter) {
    return { type: 'operand', addressingMode, parameter };
  }

  function makeInstruction(mnemonic, operand) {
    return { type: 'instruction', mnemonic, operand };
  }

  function makeDeclaration(space, directive, properties) {
    return Object.assign({ type: 'declaration', space, directive }, properties);
  }


  function makeRamBlock(header, items, end) {
    return Object.assign({
      type: 'block',
      kind: 'ram',
      placement: header.placement,
      items: items.filter(Boolean),
      end,
    });
  }

  function makeCartridgeBlock(items, end) {
    return {
      type: 'block',
      kind: 'cartridge',
      items: items.filter(Boolean),
      end,
    };
  }

  function makeCartridgeDeclaration(name, args) {
    return { type: 'cartridgeDeclaration', name: name.toLowerCase(), args };
  }

  function makeChrInclude(args) {
    return { type: 'includeDeclaration', includeType: 'chr', normalized: 'include chr', args };
  }

  function makeAnonymousReference(signs) {
    const name = join(signs);
    return { type: 'anonymousReference', name, raw: name };
  }

  function makeArgumentList(head, tail) {
    return [head, ...tail.map((entry) => entry[3])];
  }

  function makeBankNumber(number) {
    return { type: 'bankNumber', raw: number.raw, value: number.value };
  }

  function makeBankKeyword(name) {
    return { type: 'bankKeyword', raw: name, name: name.toLowerCase() };
  }

  function makeBankConstantReference(reference) {
    return { type: 'bankConstantReference', raw: reference.raw, name: reference.name };
  }

  function makeBankRange(start, end) {
    return { type: 'bankRange', raw: `${start.raw}-${end.raw}`, start, end };
  }

  function makeBankSelector(base, unitSize, window) {
    return {
      type: 'bankSelector',
      raw: [base.raw, unitSize ? `x ${unitSize.raw}` : null, window ? `at ${window.raw}` : null].filter(Boolean).join(' '),
      base,
      unitSize: unitSize || null,
      window: window || null,
    };
  }

  function makeBankWindowAlias(name, raw) {
    return { type: 'bankWindow', kind: 'alias', raw, name, value: name === 'low' ? 0x8000 : name === 'mid' ? 0xA000 : 0xC000 };
  }

  function makeBankWindowAddress(address) {
    return { type: 'bankWindow', kind: 'address', raw: address.raw, address, value: address.value };
  }

  function makeModeKeyword(name) {
    return { type: 'modeKeyword', raw: name, name: name.toLowerCase() };
  }

  function makeBankSelection(head, tail) {
    return { type: 'bankSelection', selectors: [head, ...tail.map((entry) => entry[3])] };
  }

  function makeIntrinsicCall(namespace, name, args) {
    return { type: 'intrinsicCall', namespace, name, args: args || [] };
  }
}

Program
  = lines:(CartridgeBlock / RamBlock / Line)* _ EndOfInput {
      return makeProgram(lines);
    }

CartridgeBlock
  = _ CARTRIDGE _ Comment? Newline items:CartridgeItemLine* end:CartridgeEnd {
      return makeCartridgeBlock(items, end);
    }

CartridgeEnd
  = _ END _ Comment? Newline? {
      return { type: 'blockEnd', kind: 'cartridge' };
    }

CartridgeItemLine
  = _ Newline {
      return null;
    }
  / _ comment:Comment Newline? {
      return makeComment(comment);
    }
  / _ item:CartridgeDecl _ Comment? Newline? {
      return item;
    }

CartridgeDecl
  = PRG ___ size:SizeLiteral {
      return makeCartridgeDeclaration('prg', [size]);
    }
  / CHR ___ size:SizeLiteral {
      return makeCartridgeDeclaration('chr', [size]);
    }
  / PRGRAM ___ size:SizeLiteral {
      return makeCartridgeDeclaration('prgram', [size]);
    }
  / MAPPER ___ mapper:MapperSpec {
      return makeCartridgeDeclaration('mapper', [mapper]);
    }
  / MIRRORING ___ mirroring:MirroringKeyword {
      return makeCartridgeDeclaration('mirroring', [mirroring]);
    }

RamBlock
  = header:RamHeader items:RamItemLine* end:RamEnd {
      return makeRamBlock(header, items, end);
    }

RamHeader
  = _ RAM placement:RamPlacement? _ Comment? Newline {
      return makeRamHeader(placement);
    }

RamPlacement
  = ___ AT ___ address:AddressLiteral {
      return makeRamPlacement(address);
    }

RamEnd
  = _ END _ Comment? Newline? {
      return makeRamEnd();
    }

RamItemLine
  = _ Newline {
      return null;
    }
  / _ comment:Comment Newline? {
      return makeComment(comment);
    }
  / _ item:RamDecl _ Comment? Newline? {
      return item;
    }

RamDecl
  = DB ___ name:Identifier {
      return makeDeclaration('ram', 'db', { name, width: 1 });
    }
  / DW ___ name:Identifier {
      return makeDeclaration('ram', 'dw', { name, width: 2 });
    }
  / BYTES size:SizeDecl? ___ name:Identifier {
      return makeDeclaration('ram', 'bytes', { name, width: size });
    }

SizeDecl
  = _ X _ size:NumberLiteral {
      return size.value;
    }

NumberLiteral
  = HexNumberLiteral
  / DecimalNumberLiteral

HexNumberLiteral
  = raw:$("$" [0-9a-fA-F]+) { return makeNumber(raw, 16); }

DecimalNumberLiteral
  = raw:$([0-9]+) { return makeNumber(raw, 10); }

ImmediateScalarLiteral
  = raw:$("#$" [0-9a-fA-F]+) { return makeNumber(raw, 16); }
  / raw:$("#%" [01_]+) { return makeNumber(raw, 2); }

ConstantValue
  = literal:ImmediateScalarLiteral { return makeConstantValue('scalar', literal); }
  / literal:DecimalNumberLiteral { return makeConstantValue('scalar', literal); }
  / literal:HexNumberLiteral { return makeConstantValue('address', literal); }

ConstantDefinition
  = name:Identifier _ "=" _ value:ConstantValue {
      return makeConstantDefinition(name, value);
    }

Line
  = _ Newline {
      return null;
    }
  / _ comment:Comment Newline? {
      return makeComment(comment);
    }
  / _ constant:ConstantDefinition _ Comment? Newline? {
      return makeLine(null, constant);
    }
  / _ label:Label _ statement:Statement? _ Comment? Newline? {
      return makeLine(label, statement);
    }
  / _ statement:Statement _ Comment? Newline? {
      return makeLine(null, statement);
    }

Label
  = anon:AnonymousLabel {
      return anon;
    }
  / name:Identifier ":" {
      return makeLabel(name);
    }

AnonymousLabel
  = sign:("+" / "-") ":" {
      return makeAnonymousLabel(sign);
    }

Statement
  = RomDecl
  / Directive
  / Instruction

RomDecl
  = DB ___ args:ArgumentList {
      return makeDeclaration('rom', 'db', { args });
    }
  / DW ___ args:ArgumentList {
      return makeDeclaration('rom', 'dw', { args });
    }
  / TEXT ___ text:StringLiteral {
      return makeDeclaration('rom', 'text', { text });
    }
  / ASCII ___ text:StringLiteral {
      return makeDeclaration('rom', 'ascii', { text });
    }

Directive
  = MODE ___ mode:ModeKeyword { return makeDirective('mode', [mode]); }
  / BANKALIGN ___ selection:BankSelection { return makeDirective('bankalign', [selection]); }
  / BANK ___ selection:BankSelection { return makeDirective('bank', [selection]); }
  / NMI ___ args:ArgumentList { return makeDirective('nmi', args); }
  / RESET ___ args:ArgumentList { return makeDirective('reset', args); }
  / IRQ ___ args:ArgumentList { return makeDirective('irq', args); }
  / INCLUDE ___ CHR ___ args:ArgumentList { return makeChrInclude(args); }
  / INCLUDE ___ TBL ___ file:StringLiteral ___ AS ___ name:Identifier {
      return makeResourceDeclaration('table', file, name);
    }
  / USE ___ resource:SymbolicReference { return makeUseResource(resource); }

Instruction
  = mnemonic:ImpliedMnemonic {
      return makeInstruction(mnemonic, makeOperand('imp', null));
    }
  / mnemonic:AccumulatorMnemonic ___ operand:AccumulatorOperand {
      return makeInstruction(mnemonic, operand);
    }
  / mnemonic:ImmediateMnemonic ___ operand:ImmediateOperand {
      return makeInstruction(mnemonic, operand);
    }
  / mnemonic:RelativeMnemonic ___ operand:RelativeOperand {
      return makeInstruction(mnemonic, operand);
    }
  / mnemonic:IndirectMnemonic ___ operand:IndirectOperand {
      return makeInstruction(mnemonic, operand);
    }
  / mnemonic:IndexedIndirectXMnemonic ___ operand:IndexedIndirectXOperand {
      return makeInstruction(mnemonic, operand);
    }
  / mnemonic:IndirectIndexedYMnemonic ___ operand:IndirectIndexedYOperand {
      return makeInstruction(mnemonic, operand);
    }
  / mnemonic:DirectXMnemonic ___ operand:DirectXOperand {
      return makeInstruction(mnemonic, operand);
    }
  / mnemonic:DirectYMnemonic ___ operand:DirectYOperand {
      return makeInstruction(mnemonic, operand);
    }
  / mnemonic:DirectMnemonic ___ operand:DirectOperand {
      return makeInstruction(mnemonic, operand);
    }

ADC = "ADC"i { return makeString(); }
AND = "AND"i { return makeString(); }
ASL = "ASL"i { return makeString(); }
BCC = "BCC"i { return makeString(); }
BCS = "BCS"i { return makeString(); }
BEQ = "BEQ"i { return makeString(); }
BIT = "BIT"i { return makeString(); }
BMI = "BMI"i { return makeString(); }
BNE = "BNE"i { return makeString(); }
BPL = "BPL"i { return makeString(); }
BRK = "BRK"i { return makeString(); }
BVC = "BVC"i { return makeString(); }
BVS = "BVS"i { return makeString(); }
CLC = "CLC"i { return makeString(); }
CLD = "CLD"i { return makeString(); }
CLI = "CLI"i { return makeString(); }
CLV = "CLV"i { return makeString(); }
CMP = "CMP"i { return makeString(); }
CPX = "CPX"i { return makeString(); }
CPY = "CPY"i { return makeString(); }
DEC = "DEC"i { return makeString(); }
DEX = "DEX"i { return makeString(); }
DEY = "DEY"i { return makeString(); }
EOR = "EOR"i { return makeString(); }
INC = "INC"i { return makeString(); }
INX = "INX"i { return makeString(); }
INY = "INY"i { return makeString(); }
JMP = "JMP"i { return makeString(); }
JSR = "JSR"i { return makeString(); }
LDA = "LDA"i { return makeString(); }
LDX = "LDX"i { return makeString(); }
LDY = "LDY"i { return makeString(); }
LSR = "LSR"i { return makeString(); }
NOP = "NOP"i { return makeString(); }
ORA = "ORA"i { return makeString(); }
PHA = "PHA"i { return makeString(); }
PHP = "PHP"i { return makeString(); }
PLA = "PLA"i { return makeString(); }
PLP = "PLP"i { return makeString(); }
ROL = "ROL"i { return makeString(); }
ROR = "ROR"i { return makeString(); }
RTI = "RTI"i { return makeString(); }
RTS = "RTS"i { return makeString(); }
SBC = "SBC"i { return makeString(); }
SEC = "SEC"i { return makeString(); }
SED = "SED"i { return makeString(); }
SEI = "SEI"i { return makeString(); }
STA = "STA"i { return makeString(); }
STX = "STX"i { return makeString(); }
STY = "STY"i { return makeString(); }
TAX = "TAX"i { return makeString(); }
TAY = "TAY"i { return makeString(); }
TSX = "TSX"i { return makeString(); }
TXA = "TXA"i { return makeString(); }
TXS = "TXS"i { return makeString(); }
TYA = "TYA"i { return makeString(); }

ImpliedMnemonic
  = mnemonic:(BRK / CLC / CLD / CLI / CLV / DEX / DEY / INX / INY / NOP / PHA / PHP / PLA / PLP / RTI / RTS / SEC / SED / SEI / TAX / TAY / TSX / TXA / TXS / TYA) { return makeMnemonic(mnemonic); }
AccumulatorMnemonic
  = mnemonic:(ASL / LSR / ROL / ROR) { return makeMnemonic(mnemonic); }
ImmediateMnemonic
  = mnemonic:(ADC / AND / CMP / CPX / CPY / EOR / LDA / LDX / LDY / ORA / SBC) { return makeMnemonic(mnemonic); }
RelativeMnemonic
  = mnemonic:(BCC / BCS / BEQ / BMI / BNE / BPL / BVC / BVS) { return makeMnemonic(mnemonic); }
IndirectMnemonic
  = mnemonic:JMP { return makeMnemonic(mnemonic); }
IndexedIndirectXMnemonic
  = mnemonic:(ADC / AND / CMP / EOR / LDA / ORA / SBC / STA) { return makeMnemonic(mnemonic); }
IndirectIndexedYMnemonic
  = mnemonic:(ADC / AND / CMP / EOR / LDA / ORA / SBC / STA) { return makeMnemonic(mnemonic); }
DirectXMnemonic
  = mnemonic:(ADC / AND / ASL / CMP / DEC / EOR / INC / LDA / LDY / LSR / ORA / ROL / ROR / SBC / STA / STY) { return makeMnemonic(mnemonic); }
DirectYMnemonic
  = mnemonic:(ADC / AND / CMP / EOR / LDA / LDX / ORA / SBC / STA / STX) { return makeMnemonic(mnemonic); }
DirectMnemonic
  = mnemonic:(ADC / AND / ASL / BIT / CMP / CPX / CPY / DEC / EOR / INC / JMP / JSR / LDA / LDX / LDY / LSR / ORA / ROL / ROR / SBC / STA / STX / STY) { return makeMnemonic(mnemonic); }

AccumulatorOperand
  = A { return makeOperand('acc', null); }
ImmediateOperand
  = literal:ImmediateLiteral { return makeOperand('imm', literal); }
DirectOperand
  = parameter:AddressOperand { return makeOperand('direct', parameter); }
DirectXOperand
  = parameter:AddressOperand _ "," _ X { return makeOperand('directX', parameter); }
DirectYOperand
  = parameter:AddressOperand _ "," _ Y { return makeOperand('directY', parameter); }
IndirectOperand
  = "(" _ parameter:AddressOperand _ ")" { return makeOperand('ind', parameter); }
IndexedIndirectXOperand
  = "(" _ parameter:AddressOperand _ "," _ X _ ")" { return makeOperand('indx', parameter); }
IndirectIndexedYOperand
  = "(" _ parameter:AddressOperand _ ")" _ "," _ Y { return makeOperand('indy', parameter); }

ImmediateLiteral
  = value:ImmediateScalarLiteral { return makeImmediateLiteral(value); }

RelativeOperand
  = parameter:AddressOperand { return makeOperand('rel', parameter); }

AddressOperand
  = AddressLiteral
  / reference:AnonymousReference { return reference; }
  / SymbolReference

AddressLiteral
  = BuiltinConstant
  / NumberLiteral

AnonymousReference
  = signs:[+-]+ {
      return makeAnonymousReference(signs);
    }

BankSelection
  = head:BankSelector tail:(_ "," _ BankSelector)* {
      return makeBankSelection(head, tail);
    }

BankSelector
  = base:BankSelectorBase unit:BankUnitQualifier? window:BankWindowQualifier? {
      return makeBankSelector(base, unit, window);
    }

BankSelectorBase
  = BankAll
  / BankRange
  / BankEndpoint

BankUnitQualifier
  = ___ X ___ size:SizeLiteral { return size; }

BankWindowQualifier
  = ___ AT ___ window:BankWindow { return window; }

BankWindow
  = low:LOW ___ window:WINDOW { return makeBankWindowAlias('low', `${low} ${window}`); }
  / mid:MID ___ window:WINDOW { return makeBankWindowAlias('mid', `${mid} ${window}`); }
  / high:HIGH ___ window:WINDOW { return makeBankWindowAlias('high', `${high} ${window}`); }
  / address:AddressLiteral { return makeBankWindowAddress(address); }

BankRange
  = start:BankEndpoint _ "-" _ end:BankEndpoint {
      return makeBankRange(start, end);
    }

BankEndpoint
  = number:DecimalNumberLiteral { return makeBankNumber(number); }
  / name:(SECOND_LAST / FIRST / LAST) { return makeBankKeyword(name); }
  / reference:SymbolReference { return makeBankConstantReference(reference); }

BankAll
  = name:ALL { return makeBankKeyword(name); }

ModeKeyword
  = name:(SWAP_LOW / SWAP_HIGH) { return makeModeKeyword(name); }

ArgumentList
  = head:Argument tail:(_ "," _ Argument)* {
      return makeArgumentList(head, tail);
    }

Argument
  = BuiltinConstant
  / IntrinsicCall
  / StringLiteral
  / SizeLiteral
  / NumberLiteral
  / SymbolReference

IntrinsicCall
  = namespace:Identifier ":" name:Identifier _ "(" _ args:ArgumentList? _ ")" {
      return makeIntrinsicCall(namespace, name, args);
    }

StringLiteral
  = raw:$('"' ('\\' . / !'"' .)* '"') { return makeStringArgument(raw); }

SizeLiteral
  = raw:$([0-9]+ [kK]) { return makeSize(raw); }

SymbolReference
  = name:Identifier { return makeSymbol(name); }

SymbolicReference
  = BuiltinConstant
  / SymbolReference

MapperSpec
  = MapperKeyword
  / NumberLiteral

MapperKeyword
  = name:NROM { return makeMapperKeyword(name, 0); }
  / name:UNROM512 { return makeMapperKeyword(name, 30); }
  / name:UNROM { return makeMapperKeyword(name, 2); }
  / name:MMC3 { return makeMapperKeyword(name, 4); }
  / name:AXROM { return makeMapperKeyword(name, 7); }
  / name:BNROM { return makeMapperKeyword(name, 34); }

MirroringKeyword
  = name:HORIZONTAL { return makeMirroringKeyword(name, 'horizontal', false); }
  / name:VERTICAL { return makeMirroringKeyword(name, 'vertical', false); }
  / name:FOUR_SCREEN { return makeMirroringKeyword(name, 'horizontal', true); }
  / name:FOURSCREEN { return makeMirroringKeyword(name, 'horizontal', true); }

BuiltinConstant
  = name:PPUCTRL { return makeBuiltinConstant(name, 0x2000); }
  / name:PPUMASK { return makeBuiltinConstant(name, 0x2001); }
  / name:PPUSTATUS { return makeBuiltinConstant(name, 0x2002); }
  / name:OAMADDR { return makeBuiltinConstant(name, 0x2003); }
  / name:OAMDATA { return makeBuiltinConstant(name, 0x2004); }
  / name:PPUSCROLL { return makeBuiltinConstant(name, 0x2005); }
  / name:PPUADDR { return makeBuiltinConstant(name, 0x2006); }
  / name:PPUDATA { return makeBuiltinConstant(name, 0x2007); }
  / name:OAMDMA { return makeBuiltinConstant(name, 0x4014); }
  / name:SQ1_VOL { return makeBuiltinConstant(name, 0x4000); }
  / name:SQ1_SWEEP { return makeBuiltinConstant(name, 0x4001); }
  / name:SQ1_LO { return makeBuiltinConstant(name, 0x4002); }
  / name:SQ1_HI { return makeBuiltinConstant(name, 0x4003); }
  / name:SQ2_VOL { return makeBuiltinConstant(name, 0x4004); }
  / name:SQ2_SWEEP { return makeBuiltinConstant(name, 0x4005); }
  / name:SQ2_LO { return makeBuiltinConstant(name, 0x4006); }
  / name:SQ2_HI { return makeBuiltinConstant(name, 0x4007); }
  / name:TRI_LINEAR { return makeBuiltinConstant(name, 0x4008); }
  / name:TRI_LO { return makeBuiltinConstant(name, 0x400A); }
  / name:TRI_HI { return makeBuiltinConstant(name, 0x400B); }
  / name:NOISE_VOL { return makeBuiltinConstant(name, 0x400C); }
  / name:NOISE_LO { return makeBuiltinConstant(name, 0x400E); }
  / name:NOISE_HI { return makeBuiltinConstant(name, 0x400F); }
  / name:DMC_FREQ { return makeBuiltinConstant(name, 0x4010); }
  / name:DMC_RAW { return makeBuiltinConstant(name, 0x4011); }
  / name:DMC_START { return makeBuiltinConstant(name, 0x4012); }
  / name:DMC_LEN { return makeBuiltinConstant(name, 0x4013); }
  / name:APUSTATUS { return makeBuiltinConstant(name, 0x4015); }
  / name:APUFRAME { return makeBuiltinConstant(name, 0x4017); }
  / name:JOY1 { return makeBuiltinConstant(name, 0x4016); }
  / name:JOY2 { return makeBuiltinConstant(name, 0x4017); }
  / name:MMC1_CONTROL { return makeBuiltinConstant(name, 0x9FFF); }
  / name:MMC1_CHR0 { return makeBuiltinConstant(name, 0xBFFF); }
  / name:MMC1_CHR1 { return makeBuiltinConstant(name, 0xDFFF); }
  / name:MMC1_PRG { return makeBuiltinConstant(name, 0xFFFF); }
  / name:UXROM_BANK { return makeBuiltinConstant(name, 0xFFFF); }
  / name:CNROM_BANK { return makeBuiltinConstant(name, 0xFFFF); }
  / name:MMC3_BANKSEL { return makeBuiltinConstant(name, 0x9FFE); }
  / name:MMC3_BANKDATA { return makeBuiltinConstant(name, 0x9FFF); }
  / name:MMC3_MIRROR { return makeBuiltinConstant(name, 0xBFFE); }
  / name:MMC3_RAMPROTECT { return makeBuiltinConstant(name, 0xBFFF); }
  / name:MMC3_IRQLATCH { return makeBuiltinConstant(name, 0xDFFE); }
  / name:MMC3_IRQRELOAD { return makeBuiltinConstant(name, 0xDFFF); }
  / name:MMC3_IRQDISABLE { return makeBuiltinConstant(name, 0xFFFE); }
  / name:MMC3_IRQENABLE { return makeBuiltinConstant(name, 0xFFFF); }
  / name:AXROM_BANK { return makeBuiltinConstant(name, 0xFFFF); }
  / name:BNROM_BANK { return makeBuiltinConstant(name, 0xFFFF); }
  / name:GXROM_BANK { return makeBuiltinConstant(name, 0xFFFF); }

RAM = ".ram"i { return makeString(); }
CARTRIDGE = ".cartridge"i { return makeString(); }
END = ".end"i { return makeString(); }
DB = ".db"i { return makeString(); }
DW = ".dw"i { return makeString(); }
BYTES = ".bytes"i { return makeString(); }
MODE = ".mode"i { return makeString(); }
BANKALIGN = ".bankalign"i { return makeString(); }
BANK = ".bank"i { return makeString(); }
INCLUDE = ".include"i { return makeString(); }
USE = ".use"i { return makeString(); }
TEXT = ".text"i { return makeString(); }
ASCII = ".ascii"i { return makeString(); }
NMI = ".nmi"i { return makeString(); }
RESET = ".reset"i { return makeString(); }
IRQ = ".irq"i { return makeString(); }
AT = "at"i { return makeString(); }
LOW = "low"i ![A-Za-z0-9_.] { return makeString(); }
MID = "mid"i ![A-Za-z0-9_.] { return makeString(); }
HIGH = "high"i ![A-Za-z0-9_.] { return makeString(); }
WINDOW = "window"i ![A-Za-z0-9_.] { return makeString(); }
SWAP_LOW = "swap-low"i ![A-Za-z0-9_.] { return makeString(); }
SWAP_HIGH = "swap-high"i ![A-Za-z0-9_.] { return makeString(); }
A = "A"i { return makeString(); }
X = "X"i { return makeString(); }
Y = "Y"i { return makeString(); }
PRG = "prg"i ![A-Za-z0-9_.] { return makeString(); }
CHR = "chr"i ![A-Za-z0-9_.] { return makeString(); }
PRGRAM = "prgram"i ![A-Za-z0-9_.] { return makeString(); }
MAPPER = "mapper"i ![A-Za-z0-9_.] { return makeString(); }
MIRRORING = "mirroring"i ![A-Za-z0-9_.] { return makeString(); }
TBL = "tbl"i ![A-Za-z0-9_.] { return makeString(); }
AS = "as"i ![A-Za-z0-9_.] { return makeString(); }
SECOND_LAST = "second-last"i ![A-Za-z0-9_.] { return makeString(); }
FIRST = "first"i ![A-Za-z0-9_.] { return makeString(); }
LAST = "last"i ![A-Za-z0-9_.] { return makeString(); }
ALL = "all"i ![A-Za-z0-9_.] { return makeString(); }
NROM = "nrom"i ![A-Za-z0-9_.] { return makeString(); }
UNROM512 = "unrom512"i ![A-Za-z0-9_.] { return makeString(); }
UNROM = "unrom"i ![A-Za-z0-9_.] { return makeString(); }
MMC3 = "mmc3"i ![A-Za-z0-9_.] { return makeString(); }
AXROM = "axrom"i ![A-Za-z0-9_.] { return makeString(); }
BNROM = "bnrom"i ![A-Za-z0-9_.] { return makeString(); }
HORIZONTAL = "horizontal"i ![A-Za-z0-9_.] { return makeString(); }
VERTICAL = "vertical"i ![A-Za-z0-9_.] { return makeString(); }
FOUR_SCREEN = "four_screen"i ![A-Za-z0-9_.] { return makeString(); }
FOURSCREEN = "fourscreen"i ![A-Za-z0-9_.] { return makeString(); }
PPUCTRL = "PPUCTRL"i ![A-Za-z0-9_.] { return makeString(); }
PPUMASK = "PPUMASK"i ![A-Za-z0-9_.] { return makeString(); }
PPUSTATUS = "PPUSTATUS"i ![A-Za-z0-9_.] { return makeString(); }
OAMADDR = "OAMADDR"i ![A-Za-z0-9_.] { return makeString(); }
OAMDATA = "OAMDATA"i ![A-Za-z0-9_.] { return makeString(); }
PPUSCROLL = "PPUSCROLL"i ![A-Za-z0-9_.] { return makeString(); }
PPUADDR = "PPUADDR"i ![A-Za-z0-9_.] { return makeString(); }
PPUDATA = "PPUDATA"i ![A-Za-z0-9_.] { return makeString(); }
OAMDMA = "OAMDMA"i ![A-Za-z0-9_.] { return makeString(); }
SQ1_VOL = "SQ1_VOL"i ![A-Za-z0-9_.] { return makeString(); }
SQ1_SWEEP = "SQ1_SWEEP"i ![A-Za-z0-9_.] { return makeString(); }
SQ1_LO = "SQ1_LO"i ![A-Za-z0-9_.] { return makeString(); }
SQ1_HI = "SQ1_HI"i ![A-Za-z0-9_.] { return makeString(); }
SQ2_VOL = "SQ2_VOL"i ![A-Za-z0-9_.] { return makeString(); }
SQ2_SWEEP = "SQ2_SWEEP"i ![A-Za-z0-9_.] { return makeString(); }
SQ2_LO = "SQ2_LO"i ![A-Za-z0-9_.] { return makeString(); }
SQ2_HI = "SQ2_HI"i ![A-Za-z0-9_.] { return makeString(); }
TRI_LINEAR = "TRI_LINEAR"i ![A-Za-z0-9_.] { return makeString(); }
TRI_LO = "TRI_LO"i ![A-Za-z0-9_.] { return makeString(); }
TRI_HI = "TRI_HI"i ![A-Za-z0-9_.] { return makeString(); }
NOISE_VOL = "NOISE_VOL"i ![A-Za-z0-9_.] { return makeString(); }
NOISE_LO = "NOISE_LO"i ![A-Za-z0-9_.] { return makeString(); }
NOISE_HI = "NOISE_HI"i ![A-Za-z0-9_.] { return makeString(); }
DMC_FREQ = "DMC_FREQ"i ![A-Za-z0-9_.] { return makeString(); }
DMC_RAW = "DMC_RAW"i ![A-Za-z0-9_.] { return makeString(); }
DMC_START = "DMC_START"i ![A-Za-z0-9_.] { return makeString(); }
DMC_LEN = "DMC_LEN"i ![A-Za-z0-9_.] { return makeString(); }
APUSTATUS = "APUSTATUS"i ![A-Za-z0-9_.] { return makeString(); }
APUFRAME = "APUFRAME"i ![A-Za-z0-9_.] { return makeString(); }
JOY1 = "JOY1"i ![A-Za-z0-9_.] { return makeString(); }
JOY2 = "JOY2"i ![A-Za-z0-9_.] { return makeString(); }
MMC1_CONTROL = "MMC1_CONTROL"i ![A-Za-z0-9_.] { return makeString(); }
MMC1_CHR0 = "MMC1_CHR0"i ![A-Za-z0-9_.] { return makeString(); }
MMC1_CHR1 = "MMC1_CHR1"i ![A-Za-z0-9_.] { return makeString(); }
MMC1_PRG = "MMC1_PRG"i ![A-Za-z0-9_.] { return makeString(); }
UXROM_BANK = "UXROM_BANK"i ![A-Za-z0-9_.] { return makeString(); }
CNROM_BANK = "CNROM_BANK"i ![A-Za-z0-9_.] { return makeString(); }
MMC3_BANKSEL = "MMC3_BANKSEL"i ![A-Za-z0-9_.] { return makeString(); }
MMC3_BANKDATA = "MMC3_BANKDATA"i ![A-Za-z0-9_.] { return makeString(); }
MMC3_MIRROR = "MMC3_MIRROR"i ![A-Za-z0-9_.] { return makeString(); }
MMC3_RAMPROTECT = "MMC3_RAMPROTECT"i ![A-Za-z0-9_.] { return makeString(); }
MMC3_IRQLATCH = "MMC3_IRQLATCH"i ![A-Za-z0-9_.] { return makeString(); }
MMC3_IRQRELOAD = "MMC3_IRQRELOAD"i ![A-Za-z0-9_.] { return makeString(); }
MMC3_IRQDISABLE = "MMC3_IRQDISABLE"i ![A-Za-z0-9_.] { return makeString(); }
MMC3_IRQENABLE = "MMC3_IRQENABLE"i ![A-Za-z0-9_.] { return makeString(); }
AXROM_BANK = "AXROM_BANK"i ![A-Za-z0-9_.] { return makeString(); }
BNROM_BANK = "BNROM_BANK"i ![A-Za-z0-9_.] { return makeString(); }
GXROM_BANK = "GXROM_BANK"i ![A-Za-z0-9_.] { return makeString(); }

Identifier
  = first:[A-Za-z_] rest:[A-Za-z0-9_.]* {
      return first + join(rest);
    }

Comment
  = ";" text:$((!Newline .)*) { return text; }

_ "optional whitespace"
  = [ \t]*

___ "required whitespace"
  = [ \t]+

Newline
  = "\r\n" / "\n" / "\r"

EndOfInput
  = !.
