Excluding the `ELSE` / `ELSEIF` conditional quirks, the main parsing/parse-adjacent bugs I found are:

- `:` is treated as whitespace almost everywhere, not just after labels.
  `lda:$20` assembles as `lda $20`.

- `a:` force-absolute is lowercase-only.
  `lda a:$10` works; `lda A:$10` is illegal.

- Absolute-vs-zero-page selection depends on the last parsed atom’s digit count, not the whole expression.
  `$0010` is absolute, but `$0010+0` becomes zero page.

- `#` is accepted as a general unary expression prefix, not just opcode immediate syntax.
  `db #1` and `dw #$1234` assemble.

- Logical `&&` / `||` do not short-circuit.
  `1 || 1/0` still errors.

- Label validation is inconsistent.
  `foo? = 7` can work, but `foo? equ 7` won’t expand correctly later because `EQU` scanning uses a narrower symbol character set.

- Macro parameter definitions are not actually comma-required.
  `macro m x y` works even though docs say arguments are comma-separated.

- Macro invocation silently skips empty args and shifts later args left.
  `m ,2` binds `2` to the first parameter, not the second.

- Extra macro arguments are ignored.
  Missing ones only error later if their names are used.

- Macro names are case-sensitive, but opcode/directive lookup wins first after uppercasing.
  A macro named lowercase `lda` can be defined, but `lda 1` still parses as opcode syntax.

- Dot-prefixed macro invocation works accidentally.
  `.m 9` invokes macro `m`.

- Quoted escapes are “skip backslash and take next char,” not real C-style escapes.
  `"\n"` means byte `n`, not newline.

- Long tokens are truncated at 127 chars by `getword`, which can create weird partial-token behavior plus “extra characters” afterward.

- Source physical lines over 2048 bytes are split by `fgets`, so the parser effectively sees them as multiple lines.
