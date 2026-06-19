# BWMASM

An NES assembler

Intended to to be integrated as a library into other NES projects, as well as runnable standalone.

Other popular NES assemblers have parsing bugs. One goal of bwmasm is to document their grammars formally and support compatibility with their syntax (as it actually is, not as intended). 

Also supports its own unique bwmasm syntax.

Future versions will switch to 4 different parsers: bwmasm syntax, asm6f, ca65, and nesasm (with more obscure ones to possibly be added later)