I inspected the ca65 source and assembled probe files with the built `ca65` binary to verify the sketchy parts.

**NES Target**

* `-t nes` sets CPU to plain `6502`, binary output format, no charset translation, and defines `__NES__ = 1`.
* It does not enable unofficial opcodes. For NES projects using illegal opcodes, ca65 requires `.P02X`, `.SETCPU "6502X"`, or `--cpu 6502x`.
* NES-specific include/config files mostly provide linker memory layout and register constants; they do not substantially change parser behavior.

**Core Syntax**

* Labels use `label:`. With `.feature labels_without_colons`, a colonless label is accepted only when the label starts at column/start-of-line position; indented colonless labels fail.
* Scopes use `::`, `.scope`, `.proc`, `.endscope`, `.endproc`.
* Cheap locals use `@name` by default. `.localchar` can switch the cheap-local starter to `?`.
* Unnamed labels are real syntax: `:` definitions and references like `:+`, `:++`, `:-`, `:--`, also angle variants like `:>` / `:<`.
* Dot directives and dot functions are tokenized as keywords. Unknown `.foo` is an error unless `.feature leading_dot_in_identifiers` is enabled.
* Numbers support `$hex`, `%binary`, decimal, and `h`-suffix hex. With `.feature underline_in_numbers`, underscores are allowed inside numbers but not at the end.
* Strings are double-quoted. Single quotes are char constants unless loose string/char features are enabled.
* Comments are `;` by default. C-style `/* */` comments require `.feature c_comments`.
* Backslash line continuation requires `.feature line_continuations`.

**Macros / Repeats**

* Classic macros: `.macro name args...` through `.endmacro`.
* One-line macros: `.define name[(args)] body`.
* Macro parameters are token lists. Classic macro calls can group arguments with braces so commas survive inside an argument.
* `.local` inside a classic macro body creates per-expansion generated labels.
* Macro names normally cannot collide with instruction names. `.feature ubiquitous_idents` changes lookup so macros can override mnemonic-looking identifiers.
* `.repeat count[, counter]` repeats raw token bodies until `.endrepeat`; negative counts error and clamp to zero.

**Conditionals**

* Supports `.if`, `.elseif`, `.else`, `.endif`, plus `.ifdef`, `.ifndef`, `.ifblank`, `.ifconst`, `.ifref`, CPU conditionals like `.ifp02x`, etc.
* Multiple `.else` is an error, not “evaluate all elses.”
* `.elseif` behaves sanely: if a prior branch was already taken, its expression is not evaluated. Probe confirmed `.if 1 / .elseif 1/0` succeeds and emits only the first branch.
* If prior branches were false, `.elseif` condition is evaluated. Probe confirmed `.if 0 / .elseif 1/0` errors with division by zero.

**Expressions**

* Unary selectors: `<expr` low byte, `>expr` high byte, `^expr` bank byte.
* PC is `*`; `$` is PC only with `.feature dollar_is_pc`.
* Boolean operators include `.and`, `.or`, `.xor`, `.not`, plus `&&`, `||`, `!`.
* Important quirk: boolean operators do not short-circuit in active expressions. Probe confirmed `.if 1 .or (1/0)` still reports division by zero.
* Built-in expression functions include `.defined`, `.definedmacro`, `.sizeof`, `.strlen`, `.bank`, `.hibyte`, `.lobyte`, `.max`, `.min`, `.match`, `.xmatch`, `.tcount`, etc.
* Token-transform functions like `.concat`, `.ident`, `.sprintf`, `.left`, `.mid`, `.right`, `.string` run during normal token expansion, not inside raw macro/repeat storage or skipped conditional bodies.

**Addressing / NES-Relevant CPU Behavior**

* Parses normal 6502 modes: immediate, accumulator, absolute/zp, indexed, indirect, indexed-indirect, indirect-indexed, relative.
* Address size can be forced with `z:`, `a:`, `f:` prefixes.
* Zero-page vs absolute is inferred from constants, symbol address size, segment address size, `.globalzp` / `.exportzp`, and defaults. Unknown symbols may be guessed and warned about later if wrong.
* `jmp (addr)` on plain 6502 gets special page-boundary bug checking through linker assertions; ca65 knows the NMOS indirect-JMP bug.
* Bracket indirect syntax exists, but `.feature bracket_as_indirect` changes `[]` into general indirect delimiters, which effectively bypasses the special long-indirect bracket path.

**Parsing Bugs / Sharp Quirks**

* `\ooo` octal escapes under `.feature string_escapes` are broken in scanner code. The parser computes the octal value but never assigns it back to the character being appended. Probe: `.byte "\123"` produces string/newline errors instead of byte `$53`.
* Single-letter `A`, `X`, `Y` are tokenized as registers, not identifiers. Probes confirmed `A:`, `X:`, and `Y:` cannot be ordinary labels.
* Decimal scanning consumes hex-looking letters before deciding the base. Probe: `.byte 123ABC` errors as “Invalid digits in number” instead of tokenizing `123` then `ABC`.
* `.feature addrsize` exists as a feature name but is effectively deprecated/no-op.
* `.asciiz "a","b"` emits `a b 00`, not `a 00 b 00`.
* `.mid` token slicing has odd bounds behavior: negative counts clamp to zero, and starts outside a hard-coded range can reset to zero.
* `.byte` string output uses target charset translation, but NES target uses identity translation, so NES strings are raw byte values unless `.charmap` changes them.
