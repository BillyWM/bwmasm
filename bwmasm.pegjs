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

  function stripComment(text) {
    let inString = false;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === '\\') {
        escaped = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (ch === ';' && !inString) {
        return text.slice(0, i).trim();
      }
    }

    return text.trim();
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
    const args = splitArgs(stripComment(rawArgs || ''));

    return Object.assign({
      type: 'directive',
      name,
      normalized,
      args,
      rawArgs: stripComment(rawArgs || ''),
    }, meta);
  }

  function buildInstruction(mnemonic, rawOperand, meta) {
    const operand = stripComment(rawOperand || '');

    return Object.assign({
      type: 'instruction',
      mnemonic,
      normalized: mnemonic.toLowerCase(),
      operand: operand || null,
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
  = lines:(RamBlock / Line)* Whitespace EndOfInput {
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
  = meta:Position Whitespace ".ram" placement:RamPlacement? Whitespace Comment? Newline {
      return { meta, placement: placement || null };
    }

RamPlacement
  = RequiredWhitespace "at" RequiredWhitespace address:NumberLiteral {
      return {
        type: 'absolute',
        address: address.value,
        raw: address.raw,
      };
    }

RamEnd
  = meta:Position Whitespace ".end" Whitespace Comment? Newline? {
      return Object.assign({
        type: 'blockEnd',
        kind: 'ram',
      }, meta);
    }

RamItemLine
  = Whitespace Newline {
      return null;
    }
  / Whitespace Comment Newline? {
      return null;
    }
  / meta:Position Whitespace item:RamDecl Whitespace Comment? Newline? {
      return Object.assign(item, meta);
    }

RamDecl
  = ".db" RequiredWhitespace name:Identifier {
      return {
        type: 'ramDecl',
        directive: 'db',
        name,
        width: 1,
      };
    }
  / ".dw" RequiredWhitespace name:Identifier {
      return {
        type: 'ramDecl',
        directive: 'dw',
        name,
        width: 2,
      };
    }
  / ".bytes" size:SizeDecl? RequiredWhitespace name:Identifier {
      return {
        type: 'ramDecl',
        directive: 'bytes',
        name,
        width: size,
      };
    }

SizeDecl
  = Whitespace "x" Whitespace size:NumberLiteral {
      return size.value;
    }

NumberLiteral
  = raw:("$" digits:[0-9a-fA-F]+ { return "$" + join(digits); }
        / "%" digits:[01_]+ { return "%" + join(digits); }
        / digits:[0-9]+ { return join(digits); }) {
      return parseNumberRaw(raw);
    }

Line
  = Whitespace Newline {
      return null;
    }
  / Whitespace Comment Newline? {
      return null;
    }
  / meta:Position Whitespace label:Label Whitespace statement:Statement? Whitespace Comment? Newline? {
      return Object.assign({
        type: 'line',
        label,
        statement,
      }, meta);
    }
  / meta:Position Whitespace statement:Statement Whitespace Comment? Newline? {
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
  = "." name:Identifier raw:RestOfLine {
      return buildDirective(name, raw, lineInfo());
    }

Instruction
  = mnemonic:Identifier raw:RestOfLine {
      return buildInstruction(mnemonic, raw, lineInfo());
    }

RestOfLine
  = chars:NonNewlineChar* {
      return trimText(chars);
    }

NonNewlineChar
  = !Newline ch:. {
      return ch;
    }

Identifier
  = first:[A-Za-z_] rest:[A-Za-z0-9_.]* {
      return first + join(rest);
    }

Comment
  = ";" (!Newline .)*

Whitespace "whitespace"
  = [ \t]*

RequiredWhitespace "whitespace"
  = [ \t]+

Newline
  = "\r\n" / "\n" / "\r"

EndOfInput
  = !.
