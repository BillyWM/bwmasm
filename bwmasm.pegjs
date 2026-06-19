{
  function lineInfo() {
    const start = location().start;
    return {
      line: start.line,
      column: start.column,
      offset: start.offset,
    };
  }

  function join(chars) {
    return chars.join('');
  }

  function trimText(chars) {
    return join(chars).trim();
  }

  function splitArgs(raw) {
    const args = [];
    let current = '';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];

      if (escaped) {
        current += ch;
        escaped = false;
        continue;
      }

      if (ch === '\\') {
        current += ch;
        escaped = true;
        continue;
      }

      if (ch === '"') {
        current += ch;
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (ch === '(') {
          depth++;
        } else if (ch === ')' && depth > 0) {
          depth--;
        } else if (ch === ',' && depth === 0) {
          args.push(parseArg(current.trim()));
          current = '';
          continue;
        }
      }

      current += ch;
    }

    if (current.trim() !== '' || raw.trim().endsWith(',')) {
      args.push(parseArg(current.trim()));
    }

    return args;
  }

  function parseArg(raw) {
    if (raw === '') {
      return { type: 'empty', raw };
    }

    if (/^"(?:\\.|[^"\\])*"$/.test(raw)) {
      return {
        type: 'string',
        raw,
        value: raw.slice(1, -1),
      };
    }

    if (/^\$[0-9a-fA-F]+$/.test(raw)) {
      return {
        type: 'number',
        raw,
        base: 16,
        value: parseInt(raw.slice(1), 16),
      };
    }

    if (/^%[01_]+$/.test(raw)) {
      return {
        type: 'number',
        raw,
        base: 2,
        value: parseInt(raw.slice(1).replace(/_/g, ''), 2),
      };
    }

    if (/^[0-9]+[kK]$/.test(raw)) {
      return {
        type: 'size',
        raw,
        unit: 'k',
        value: parseInt(raw.slice(0, -1), 10) * 1024,
      };
    }

    if (/^[0-9]+$/.test(raw)) {
      return {
        type: 'number',
        raw,
        base: 10,
        value: parseInt(raw, 10),
      };
    }

    const intrinsic = raw.match(/^([A-Za-z_][A-Za-z0-9_]*):([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/);
    if (intrinsic) {
      return {
        type: 'intrinsicCall',
        raw,
        namespace: intrinsic[1],
        name: intrinsic[2],
        args: splitArgs(intrinsic[3]),
      };
    }

    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(raw)) {
      return {
        type: 'symbol',
        raw,
        name: raw,
      };
    }

    return {
      type: 'expression',
      raw,
    };
  }

  function buildDirective(name, rawArgs, meta) {
    const normalized = name.toLowerCase();
    const args = splitArgs(rawArgs || '');

    return Object.assign({
      type: 'directive',
      name,
      normalized,
      args,
      rawArgs: rawArgs || '',
    }, meta);
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

  function buildInstruction(mnemonic, operand, meta) {
    return Object.assign({
      type: 'instruction',
      mnemonic,
      operand,
    }, meta);
  }

  function parseNumberRaw(raw) {
    const parsed = parseArg(raw);
    if (parsed.type !== 'number') {
      throw new Error('Expected a number.');
    }
    return parsed;
  }

  function buildRamBlock(header, items, end) {
    return Object.assign({
      type: 'block',
      kind: 'ram',
      placement: header.placement,
      items: items.filter(Boolean),
      end,
    }, header.meta);
  }
}

Program
  = lines:(RamBlock / Line)* _ EndOfInput {
      return {
        type: 'program',
        body: lines.filter(Boolean),
      };
    }

RamBlock
  = header:RamHeader items:RamItemLine* end:RamEnd {
      return buildRamBlock(header, items, end);
    }

RamHeader
  = meta:Position _ ".ram" placement:RamPlacement? _ Comment? Newline {
      return { meta, placement: placement || null };
    }

RamPlacement
  = ___ "at" ___ address:NumberLiteral {
      return {
        type: 'absolute',
        address: address.value,
        raw: address.raw,
      };
    }

RamEnd
  = meta:Position _ ".end" _ Comment? Newline? {
      return Object.assign({
        type: 'blockEnd',
        kind: 'ram',
      }, meta);
    }

RamItemLine
  = _ Newline {
      return null;
    }
  / _ Comment Newline? {
      return null;
    }
  / meta:Position _ item:RamDecl _ Comment? Newline? {
      return Object.assign(item, meta);
    }

RamDecl
  = ".db" ___ name:Identifier {
      return {
        type: 'ramDecl',
        directive: 'db',
        name,
        width: 1,
      };
    }
  / ".dw" ___ name:Identifier {
      return {
        type: 'ramDecl',
        directive: 'dw',
        name,
        width: 2,
      };
    }
  / ".bytes" size:SizeDecl? ___ name:Identifier {
      return {
        type: 'ramDecl',
        directive: 'bytes',
        name,
        width: size,
      };
    }

SizeDecl
  = _ "x" _ size:NumberLiteral {
      return size.value;
    }

NumberLiteral
  = raw:("$" digits:[0-9a-fA-F]+ { return "$" + join(digits); }
        / "%" digits:[01_]+ { return "%" + join(digits); }
        / digits:[0-9]+ { return join(digits); }) {
      return parseNumberRaw(raw);
    }

Line
  = _ Newline {
      return null;
    }
  / meta:Position _ comment:Comment Newline? {
      return Object.assign({ type: 'comment', comment }, meta);
    }
  / meta:Position _ label:Label _ statement:Statement? _ Comment? Newline? {
      return Object.assign({
        type: 'line',
        label,
        statement,
      }, meta);
    }
  / meta:Position _ statement:Statement _ Comment? Newline? {
      return Object.assign({
        type: 'line',
        label: null,
        statement,
      }, meta);
    }

Position
  = &. {
      return lineInfo();
    }

Label
  = anon:AnonymousLabel {
      return anon;
    }
  / name:Identifier ":" {
      return Object.assign({
        type: 'label',
        name,
        anonymous: false,
      }, lineInfo());
    }

AnonymousLabel
  = sign:("+" / "-") ":" {
      return Object.assign({
        type: 'anonymousLabel',
        sign,
        anonymous: true,
      }, lineInfo());
    }

Statement
  = Directive
  / Instruction

Directive
  = "." name:Identifier raw:DirectiveArgumentText {
      return buildDirective(name, raw, lineInfo());
    }

Instruction
  = mnemonic:ImpliedMnemonic {
      return buildInstruction(mnemonic, makeOperand('imp', null), lineInfo());
    }
  / mnemonic:AccumulatorMnemonic ___ operand:AccumulatorOperand {
      return buildInstruction(mnemonic, operand, lineInfo());
    }
  / mnemonic:ImmediateMnemonic ___ operand:ImmediateOperand {
      return buildInstruction(mnemonic, operand, lineInfo());
    }
  / mnemonic:RelativeMnemonic ___ operand:DirectOperand {
      return buildInstruction(mnemonic, operand, lineInfo());
    }
  / mnemonic:IndirectMnemonic ___ operand:IndirectOperand {
      return buildInstruction(mnemonic, operand, lineInfo());
    }
  / mnemonic:IndexedIndirectXMnemonic ___ operand:IndexedIndirectXOperand {
      return buildInstruction(mnemonic, operand, lineInfo());
    }
  / mnemonic:IndirectIndexedYMnemonic ___ operand:IndirectIndexedYOperand {
      return buildInstruction(mnemonic, operand, lineInfo());
    }
  / mnemonic:DirectXMnemonic ___ operand:DirectXOperand {
      return buildInstruction(mnemonic, operand, lineInfo());
    }
  / mnemonic:DirectYMnemonic ___ operand:DirectYOperand {
      return buildInstruction(mnemonic, operand, lineInfo());
    }
  / mnemonic:DirectMnemonic ___ operand:DirectOperand {
      return buildInstruction(mnemonic, operand, lineInfo());
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
  = "A"i { return makeOperand('acc', null); }
ImmediateOperand
  = "#" _ parameter:Parameter { return makeOperand('imm', parameter); }
DirectOperand
  = parameter:Parameter { return makeOperand('direct', parameter); }
DirectXOperand
  = parameter:Parameter _ "," _ "X"i { return makeOperand('directX', parameter); }
DirectYOperand
  = parameter:Parameter _ "," _ "Y"i { return makeOperand('directY', parameter); }
IndirectOperand
  = "(" _ parameter:Parameter _ ")" { return makeOperand('ind', parameter); }
IndexedIndirectXOperand
  = "(" _ parameter:Parameter _ "," _ "X"i _ ")" { return makeOperand('indx', parameter); }
IndirectIndexedYOperand
  = "(" _ parameter:Parameter _ ")" _ "," _ "Y"i { return makeOperand('indy', parameter); }

Parameter
  = number:NumberLiteral { return number; }
  / reference:AnonymousReference { return reference; }
  / name:Identifier { return parseArg(name); }

AnonymousReference
  = signs:[+-]+ {
      const name = join(signs);
      return { type: 'anonymousReference', name, raw: name };
    }

DirectiveArgumentText
  = raw:$((DirectiveString / (!Comment !Newline .))*) {
      return raw.trim();
    }

DirectiveString
  = '"' ('\\' . / !'"' .)* '"'

Identifier
  = first:[A-Za-z_] rest:[A-Za-z0-9_.]* {
      return first + join(rest);
    }

Comment
  = ";" (!Newline .)*

_ "optional whitespace"
  = [ \t]*

___ "required whitespace"
  = [ \t]+

Newline
  = "\r\n" / "\n" / "\r"

EndOfInput
  = !.
