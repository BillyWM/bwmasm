; bwmasm text test ROM.

.nesprg 32k
.neschr 8k
.nesmapper nrom
.nesmirroring vertical
.incchr "horrible-night.chr"
.include tbl "example.tbl" as MainTable

.ram
  .db framesLo
  .db framesHi
.end

.bank 0

.nmi Nmi
.reset Reset
.irq Irq

Nmi:
  inc framesLo
  bne +
  inc framesHi
+:
  jsr DrawCounter
  rti

Irq:
  rti

Reset:
  sei
  cld
  ldx #$ff
  txs

  lda #$00
  sta PPUCTRL
  sta PPUMASK
  sta framesLo
  sta framesHi

-:
  bit PPUSTATUS
  bpl -

  bit PPUSTATUS
  lda #$20
  sta PPUADDR
  lda #$00
  sta PPUADDR
  lda #$00
  ldx #$00

  lda #$00
  ldy #$04
  ldx #$00

ClearName:
  sta PPUDATA
  inx
  bne ClearName
  dey
  bne ClearName

  bit PPUSTATUS
  lda #$3f
  sta PPUADDR
  lda #$00
  sta PPUADDR
  lda #$0f
  sta PPUDATA
  lda #$30
  sta PPUDATA
  lda #$10
  sta PPUDATA
  lda #$00
  sta PPUDATA

  bit PPUSTATUS
  lda #$20
  sta PPUADDR
  lda #$48
  sta PPUADDR
  ldx #$00

DrawTitle:
  lda TitleText,x
  cmp #$ff
  beq TitleDone
  sta PPUDATA
  inx
  jmp DrawTitle

TitleDone:
  jsr DrawCounter

  lda #%10000000
  sta PPUCTRL
  lda #%00011110
  sta PPUMASK

MainLoop:
  jmp MainLoop

DrawCounter:
  bit PPUSTATUS
  lda #$20
  sta PPUADDR
  lda #$8e
  sta PPUADDR

  lda framesHi
  lsr A
  lsr A
  lsr A
  lsr A
  jsr WriteHexDigit

  lda framesHi
  and #$0f
  jsr WriteHexDigit

  lda framesLo
  lsr A
  lsr A
  lsr A
  lsr A
  jsr WriteHexDigit

  lda framesLo
  and #$0f
  jsr WriteHexDigit
  lda #$00
  sta PPUSCROLL
  sta PPUSCROLL
  rts

WriteHexDigit:
  cmp #$0a
  bpl HexLetter
  clc
  adc #$35
  sta PPUDATA
  rts
  
HexLetter:
  clc
  adc #$f7
  sta PPUDATA
  rts

TitleText:
  .use MainTable
  .text "BWMASM Test ROM"
