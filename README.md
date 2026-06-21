# BWMASM

An NES assembler

Intended to to be integrated as a library into other NES projects, as well as runnable standalone.

Other popular NES assemblers have parsing bugs. One goal of bwmasm is to document their grammars formally and support compatibility with their syntax (as it actually is, not as intended). 

Also supports its own unique bwmasm syntax.

Future versions will switch to 4 different parsers: bwmasm syntax, asm6f, ca65, and nesasm (with more obscure ones to possibly be added later) and provide automatic conversion between formats

## Features

### `TBL` file support and a `.text` directive

Encode output text to custom bytes (e.g. to match your CHR layout) rather than ASCII

Supports multiple TBL files - just switch encodings with `.use`

```
.include tbl "example.tbl" as MainTable
.use MainTable
.text "This text uses example.tbl where space is $00 'a' is $01 etc"
```

### Simplifed headers
	
Uses a human-readable format instead of forcing you to manually write magic numbers that please the iNES header format

```
.cartridge
	prg 256k
	chr 8k
	mapper axrom
	mirroring vertical
.end
```

### "Mapper-aware" assembly

**Native bank sizes**

The assembler understands bank sizes based on your mapper.

In this example, bank 1 can be the second bank of 8K, 16K or 32K, decided automatically, *depending on which mapper you chose*

```
.bank 1
Example:
	LDA #$FF
	...etc...
```

If your mapper supports multiple modies (like MMC1) you can specify e.g:

```.bank 1 x 16```

**Automatic ROM layout**:

`.org` is not needed because the assembler understands the selected mapper and knows where code and data should go.

Vectors are also calculated automatically and inserted - no need for "`.org $fffa dw ....`" stuff.

```
.nmi 	MyDrawFunction
.irq 	ExampleIrqFunc
.reset 	YourResetRoutine
```
