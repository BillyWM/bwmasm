# Nesasm Behavior

This is based on the `nesasmsrc.zip` source, with a few tiny assemblies run against a native build of that same source to confirm suspicious paths.

## Overall Parser Shape

Nesasm is a column-sensitive, line-buffer assembler. Source text is copied into `prlnbuf` starting at a fixed source field, then each line is processed by scanning an optional label, then a macro name, then an opcode/directive. This matters a lot: a symbol-looking token at true column start is treated as a possible colonless label before it is treated as an instruction or directive.

Instructions and directives are case-insensitive. Labels and macro names are case-sensitive. Directives generally exist in both dotted and undotted forms, such as `DB` and `.DB`, but a dotted directive at column start is first parsed as a local label. In practice, instruction/directive lines need leading whitespace unless a label is intentionally being defined at column start.

## NES Target Behavior

The program chooses NES mode unless the executable name starts with `PCE`. In NES mode it installs the common base 6502 instruction/directive table plus NES-specific directives. It does not install the PCE instruction table.

NES-specific directives are `INESPRG`, `INESCHR`, `INESMAP`, `INESMIR`, and `DEFCHR`, with dotted aliases. `INESPRG` and `INESCHR` accept values 0..64, `INESMAP` accepts 0..255, and `INESMIR` accepts 0..15. The iNES mapper bits are split into header byte 6 low/high nibble behavior in the old iNES way.

The NES machine settings are: zero page limit `$100`, RAM limit `$800`, RAM base `0`, default code/data page `7`, and output extension `.nes`. The output writer emits a 16-byte iNES header unless `-raw` is used.

## Labels And Columns

Global labels are normal symbols. A label at column start may omit the colon:

```asm
foo
  lda #1
```

Indented labels require a colon:

```asm
  foo:
  lda #1
```

Local labels start with `.` and attach to the most recent global label. A local label before any global label errors with `Local symbol not allowed here!`. Because dotted directives also start with `.`, `.db 1` at column start is parsed as a local label attempt and errors unless there is an active global label. Indented `.db 1` is parsed as a directive.

Single-letter symbols `A`, `X`, and `Y` are reserved and cannot be labels. Built-in expression function names such as `HIGH`, `LOW`, `DEFINED`, `PAGE`, `BANK`, and `SIZEOF` are also reserved as labels.

Symbol names accept letters, digits after the first character, `_`, and `.`. The symbol buffer is 31 characters plus length byte; longer labels are silently truncated by the collector rather than rejected.

## Comments And Continuations

`;` starts a comment. A line whose first source character is `;`, `*`, or NUL is a comment/blank line.

Expression parsing supports continuation with `\` only when the backslash is followed by optional whitespace and then comment/end-of-line. Macro argument parsing has a similar continuation path. This is not a general free-form line continuation system.

## Numeric And String Syntax

Numbers support decimal, `$` hex, `0x` hex, and `%` binary. Binary numbers may contain underscores. Character constants use single quotes and are exactly one raw character, like `'A'`; there is no escape handling in character constants.

`.db` accepts double-quoted strings. String escapes are very small: `\r`, `\n`, and `\t` are special; any other backslash sequence drops the backslash and emits the following character. Confirmed examples: `\"` emits `"`, `\\` emits `\`, and `\q` emits `q`.

`.db` string parsing does not skip whitespace around commas. `db "A",1` works; `db "A" ,1` errors. After a comma, `db "A", "B"` also errors because the string branch is only selected if the next character is immediately `"`.

## Expressions

The expression parser is stack-based with these operators:

`+`, `-`, `*`, `/`, `%`, `&`, `^`, `|`, `~`, `!`, `=`, `!=`, `<>`, `<`, `<=`, `>`, `>=`, `<<`, `>>`, and parentheses.

`*` is current PC when a value is expected, and multiplication when an operator is expected. `%` is binary literal prefix when a value is expected, and modulo when an operator is expected.

Built-in expression functions are `DEFINED`, `HIGH`, `LOW`, `PAGE`, `BANK`, and `SIZEOF` in NES mode. `VRAM` and `PAL` exist only for PCE mode in `check_keyword`.

There are also user expression functions via `.func`. The function name must be the label on the `.func` line, function names cannot contain `.`, arguments are referenced as `\1` through `\9`, and function calls require parentheses.

Division or modulo by zero produces an assembler error, not a crash, in the evaluated path.

## Addressing Syntax

Nesasm uses square brackets for 6502 indirect addressing. Confirmed:

```asm
  jmp [$1234]   ; emits 6C 34 12
  jmp ($1234)   ; emits absolute JMP 4C 34 12
```

Parentheses are expression grouping, not indirect-addressing delimiters.

Bare memory operands are absolute. Nesasm does not auto-shrink to zero page:

```asm
  lda $20       ; emits AD 20 00
  lda <$20      ; emits A5 20
```

The `<` prefix forces zero-page addressing. If the value is not in zero page, the assembler errors instead of falling back to absolute.

Supported base NES opcodes are the normal 6502 set in `base_inst`. The NES build does not add PCE-only opcodes. Some opcode table comments mention removed `ZP_IND` modes; those are not accepted for ordinary 6502 `LDA/STA/ADC/...`.

Mnemonic suffixes `.l` and `.h` are accepted for instructions that allow immediate or memory operands. For immediates, `.l` and `.h` select the low or high byte. For memory operands, `.h` increments the address by one, while `.l` leaves it unchanged. The textual prefixes `low_byte` and `high_byte` before an operand set the same internal extension flag.

Post-increment syntaxes exist in the generic operand parser, such as `,X++`, `,Y++`, and `],Y++`; on the base NES table they are mostly irrelevant because the generated extra increment opcode is a parser feature inherited from MagicKit/PCE-style behavior.

## Directives

Common base directives include `DB/BYTE`, `DW/WORD`, `DS`, `EQU` and `=`, `ORG`, `PAGE`, `BANK`, `INCBIN`, `INCLUDE`, `INCCHR`, `LIST`, `NOLIST`, `MLIST`, `NOMLIST`, `MAC/MACRO`, `ENDM`, `RSSET`, `RS`, `IF`, `IFDEF`, `IFNDEF`, `ELSE`, `ENDIF`, `FAIL`, `ZP`, `BSS`, `CODE`, `DATA`, `FUNC`, `OPT`, `PROC`, `PROCGROUP`, `ENDP`, `ENDPROCGROUP`, and `CALL`.

`ORG` in code/data sets `page = (value >> 13) & 7` and `loccnt = value & $1FFF`. `BANK` switches 8KB banks. `PAGE` is a separate page selector and is not allowed inside procs. `ZP`, `BSS`, `CODE`, and `DATA` switch sections and restore that section's saved bank/page/location state.

`RSSET` and `RS` implement reserve-structure style offsets: `RSSET` sets `rsbase`; `RS` defines the current label to `rsbase` and advances it by the requested size.

`OPT` recognizes final `+`/`-` flags for `l`, `m`, `w`, and `o` options: listing, macro listing, warnings, and optimize.

## Macros

Macros are defined with `MACRO`/`MAC` and ended with `ENDM`. Macro definitions cannot nest. The macro name may be supplied as the label on the macro line or as the token after `.macro`. Macro names cannot contain `.`.

Macro calls are positional and do not declare parameters. Arguments are referenced in the macro body as `\1` through `\9`. `\@` expands to a five-digit expansion counter. `\#` expands to the highest non-empty argument count. `\?1` through `\?9` expand to an argument-type code: no arg, register, immediate, absolute, indirect, string, or label.

Macro calls can nest up to 7 levels. Arguments are limited to 80 characters. Braces can group string-like macro arguments. The macro argument parser specially glues `,x`, `,y`, `,x++`, and `,y++` back onto the previous argument so addressing operands can be passed as one macro argument.

Macro lookup is case-sensitive, unlike opcode/directive lookup.

## Conditionals

Supported conditionals are only `IF`, `IFDEF`, `IFNDEF`, `ELSE`, and `ENDIF`. There is no `ELSEIF`.

Nested conditionals inside skipped blocks are not evaluated; the assembler pushes dummy conditional stack entries while skipping. `IF` expressions in active code are evaluated normally.

Duplicate `ELSE` is not detected. Confirmed behavior: if the original `IF` condition is false, every subsequent `ELSE` body is assembled. For example, `if 0 / else db 2 / else db 3 / endif` emits both `02` and `03`.

## Parsing Bugs And Quirks

* Column-start instruction/directive ambiguity: `lda #1` at column start is parsed as a label named `lda`, then `#1` is treated as the would-be opcode and errors. Instructions and directives need leading whitespace unless a label is being defined.
* Column-start dotted directives are especially hazardous: `.inesprg 1` at column start is parsed as a local label and errors before it can be recognized as a directive.
* Duplicate `ELSE` is accepted and may assemble multiple else bodies when the original condition was false.
* There is no `ELSEIF`; an indented `elseif` is just an unknown instruction.
* Parentheses do not mean indirect addressing. `JMP ($1234)` assembles as absolute `JMP $1234`; indirect requires `JMP [$1234]`.
* No automatic zero-page selection. Bare `$20` uses absolute addressing; `<$20` is required for zero page.
* `.db` string items cannot have spaces around commas, unlike numeric expression items.
* `getstring` does not explicitly detect missing closing quotes; unterminated strings in directives like `INCLUDE` tend to run until the fixed output buffer limit and report `String too long!` rather than a clean unterminated-string error.
* Symbol collection silently truncates labels beyond the symbol buffer size instead of rejecting them.
* `.opt` silently ignores a recognized option if the final flag character is neither `+` nor `-`.
* `INESPRG`, `INESCHR`, `INESMAP`, and `INESMIR` check `value < 0`, but `value` is effectively unsigned in the expression path, so the negative side of those range checks is dead.
