; bwmasm text test ROM.

.nesprg 32k
.neschr 8k
.nesmapper nrom
.nesmirroring vertical
.incchr "horrible-night.chr"

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
  sta $2000
  sta $2001
  sta framesLo
  sta framesHi

-:
  bit $2002
  bpl -

  bit $2002
  lda #$20
  sta $2006
  lda #$00
  sta $2006
  lda #$00
  ldx #$00

  lda #$00
  ldy #$04
  ldx #$00

ClearName:
  sta $2007
  inx
  bne ClearName
  dey
  bne ClearName

  bit $2002
  lda #$3f
  sta $2006
  lda #$00
  sta $2006
  lda #$0f
  sta $2007
  lda #$30
  sta $2007
  lda #$10
  sta $2007
  lda #$00
  sta $2007

  bit $2002
  lda #$20
  sta $2006
  lda #$48
  sta $2006
  ldx #$00

DrawTitle:
  lda TitleText,x
  cmp #$ff
  beq TitleDone
  sta $2007
  inx
  jmp DrawTitle

TitleDone:
  jsr DrawCounter

  lda #%10000000
  sta $2000
  lda #%00011110
  sta $2001

MainLoop:
  jmp MainLoop

DrawCounter:
  bit $2002
  lda #$20
  sta $2006
  lda #$8e
  sta $2006

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
  sta $2005
  sta $2005
  rts

WriteHexDigit:
  cmp #$0a
  bpl HexLetter
  clc
  adc #$35
  sta $2007
  rts
  
HexLetter:
  clc
  adc #$f7
  sta $2007
  rts

TitleText:
  .db 2, 23, 13, 1, 19, 13, 0, 20, 31, 45, 46, 0, 18, 15, 13, $ff
