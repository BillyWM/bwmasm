.cartridge
  prg 32k
  chr 8k
  mapper mmc3
  mirroring vertical
.end

.mode swap-low
.bank last

; bwmasm MMC3 bank syntax / IRQ raster test ROM.
; PRG is 32K: four native 8K MMC3 banks.
; CHR layout:
;   $0000-$0FFF: generated vertical-stripe background pattern
;   $1000-$1FFF: steamed-hams.chr sprite font
;
; steamed-hams.chr has digits 0-9 starting at tile $10 and capitals
; starting with A at tile $21.  Background uses $0000; sprites use
; $1000 so the MMC3 A12 scanline counter has a reliable edge.
.include chr "mmc3-bg-pattern.chr", "steamed-hams.chr"

.ram
  .db framesLo
  .db framesHi
  .db padNow
  .db padPrev
  .db padPressed
  .db selectedBank
  .db irqLine
  .db wavePhase
.end

.ram at $0200
  .bytes x 256 oamShadow
.end

; Bank 0 is a switchable MMC3 8K bank assembled for the low window.
.bank 0 at low window
BankRoutine:
  ldx #$00
-:
  lda BankSprites,x
  sta oamShadow,x
  inx
  cpx #$28
  bne -
  rts

BankSprites:
  .db $30,$22,$00,$68  ; B
  .db $30,$21,$00,$70  ; A
  .db $30,$2e,$00,$78  ; N
  .db $30,$2b,$00,$80  ; K
  .db $30,$00,$00,$88
  .db $30,$10,$00,$90  ; 0
  .db $f8,$00,$00,$00
  .db $f8,$00,$00,$00
  .db $f8,$00,$00,$00
  .db $f8,$00,$00,$00

; Same native bank size written verbosely to test optional x 8k spelling.
.bank 1 x 8k at low window
BankRoutine:
  ldx #$00
-:
  lda BankSprites,x
  sta oamShadow,x
  inx
  cpx #$28
  bne -
  rts

BankSprites:
  .db $30,$22,$00,$68  ; B
  .db $30,$21,$00,$70  ; A
  .db $30,$2e,$00,$78  ; N
  .db $30,$2b,$00,$80  ; K
  .db $30,$00,$00,$88
  .db $30,$11,$00,$90  ; 1
  .db $f8,$00,$00,$00
  .db $f8,$00,$00,$00
  .db $f8,$00,$00,$00
  .db $f8,$00,$00,$00

; In swap-low mode, second-last is fixed at $C000-$DFFF.
.bank second-last
BankRoutine:
  ldx #$00
-:
  lda BankSprites,x
  sta oamShadow,x
  inx
  cpx #$28
  bne -
  rts

BankSprites:
  .db $30,$22,$00,$68  ; B
  .db $30,$21,$00,$70  ; A
  .db $30,$2e,$00,$78  ; N
  .db $30,$2b,$00,$80  ; K
  .db $30,$00,$00,$88
  .db $30,$12,$00,$90  ; 2
  .db $f8,$00,$00,$00
  .db $f8,$00,$00,$00
  .db $f8,$00,$00,$00
  .db $f8,$00,$00,$00

; Last is fixed at $E000-$FFFF and owns vectors, main, NMI, and IRQ.
.bank last
.nmi Nmi
.reset Reset
.irq Irq

BankRoutine:
  ldx #$00
-:
  lda BankSprites,x
  sta oamShadow,x
  inx
  cpx #$28
  bne -
  rts

BankSprites:
  .db $30,$22,$00,$68  ; B
  .db $30,$21,$00,$70  ; A
  .db $30,$2e,$00,$78  ; N
  .db $30,$2b,$00,$80  ; K
  .db $30,$00,$00,$88
  .db $30,$13,$00,$90  ; 3
  .db $f8,$00,$00,$00
  .db $f8,$00,$00,$00
  .db $f8,$00,$00,$00
  .db $f8,$00,$00,$00

Reset:
  sei
  cld
  ldx #$ff
  txs

  lda #$00
  sta PPUCTRL
  sta PPUMASK
  sta MMC3_IRQDISABLE
  sta selectedBank
  sta framesLo
  sta framesHi
  sta padNow
  sta padPrev
  sta padPressed
  sta irqLine
  sta wavePhase

  ; Wait for PPU warmup.
-:
  bit PPUSTATUS
  bpl -
-:
  bit PPUSTATUS
  bpl -

  jsr ClearOam
  jsr LoadPalettes
  jsr DrawBackground
  jsr RunSelectedBank
  jsr UploadOam

  ; NMI on, sprites from $1000, background from $0000.
  lda #%10001000
  sta PPUCTRL
  lda #%00011110
  sta PPUMASK
  cli

MainLoop:
  jmp MainLoop

Nmi:
  pha
  txa
  pha
  tya
  pha

  inc framesLo
  bne +
  inc framesHi
+:
  lda framesLo
  and #$3f
  sta wavePhase

  jsr ReadController
  jsr HandleInput
  jsr UploadOam
  jsr StartRaster

  pla
  tay
  pla
  tax
  pla
  rti

Irq:
  pha
  txa
  pha

  ; Acknowledge the pending MMC3 IRQ before changing scroll.
  lda #$00
  sta MMC3_IRQDISABLE

  inc irqLine
  lda irqLine
  cmp #$e0
  bcc MoreRasterLines

  ; End of the visible field programmed by IRQs for this frame.
  lda #$00
  sta PPUSCROLL
  sta PPUSCROLL
  jmp IrqDone

MoreRasterLines:
  clc
  adc wavePhase
  and #$3f
  tax
  lda WaveScroll,x
  sta PPUSCROLL
  lda #$00
  sta PPUSCROLL

  ; Latch 0 keeps the MMC3 counter firing every scanline.
  ; Do not rewrite the latch/reload here; just re-enable after ack.
  sta MMC3_IRQENABLE

IrqDone:
  pla
  tax
  pla
  rti

ReadController:
  lda #$00
  sta padNow
  lda #$01
  sta JOY1
  lda #$00
  sta JOY1
  ldx #$08
-:
  lda JOY1
  and #$03
  cmp #$01
  rol padNow
  dex
  bne -

  lda padNow
  eor padPrev
  and padNow
  sta padPressed
  lda padNow
  sta padPrev
  rts

HandleInput:
  lda padPressed
  and #$01
  beq NoRight
  inc selectedBank
  lda selectedBank
  and #$03
  sta selectedBank
  jsr RunSelectedBank

NoRight:
  lda padPressed
  and #$02
  beq NoLeft
  lda selectedBank
  beq WrapLeft
  dec selectedBank
  jmp LeftDone

WrapLeft:
  lda #$03
  sta selectedBank

LeftDone:
  jsr RunSelectedBank

NoLeft:
  rts

RunSelectedBank:
  lda selectedBank
  beq RunBank0
  cmp #$01
  beq RunBank1
  cmp #$02
  beq RunBank2
  jmp BankRoutine

RunBank0:
  lda #$06
  sta MMC3_BANKSEL
  lda #$00
  sta MMC3_BANKDATA
  jsr $8000
  rts

RunBank1:
  lda #$06
  sta MMC3_BANKSEL
  lda #$01
  sta MMC3_BANKDATA
  jsr $8000
  rts

RunBank2:
  jsr $C000
  rts

StartRaster:
  lda #$00
  sta irqLine

  ; Reset PPUSCROLL write latch while safely in vblank.
  bit PPUSTATUS
  lda wavePhase
  and #$3f
  tax
  lda WaveScroll,x
  sta PPUSCROLL
  lda #$00
  sta PPUSCROLL

  ; Latch 0 produces an IRQ on every scanline on the MMC3 counter.
  lda #$00
  sta MMC3_IRQLATCH
  sta MMC3_IRQRELOAD
  sta MMC3_IRQDISABLE
  sta MMC3_IRQENABLE
  rts

UploadOam:
  lda #$00
  sta OAMADDR
  lda #$02
  sta OAMDMA
  rts

ClearOam:
  lda #$f8
  ldx #$00
-:
  sta oamShadow,x
  inx
  bne -
  rts

LoadPalettes:
  bit PPUSTATUS
  lda #$3f
  sta PPUADDR
  lda #$00
  sta PPUADDR
  ldx #$00
-:
  lda Palette,x
  sta PPUDATA
  inx
  cpx #$20
  bne -
  rts

DrawBackground:
  bit PPUSTATUS
  lda #$20
  jsr FillNametable
  lda #$24
  jsr FillNametable

  lda #$00
  sta PPUSCROLL
  sta PPUSCROLL
  rts

FillNametable:
  sta PPUADDR
  lda #$00
  sta PPUADDR

  ; Fill the whole nametable with one coherent vertical-stripe texture.
  ; The IRQ handler changes horizontal scroll every scanline, so the
  ; full screen bends as one continuous MMC3 raster wave.
  lda #$00
  ldy #$03
NameFullPages:
  ldx #$00
NameFullLoop:
  sta PPUDATA
  inx
  bne NameFullLoop
  dey
  bne NameFullPages

  ldx #$c0
NameTailLoop:
  sta PPUDATA
  dex
  bne NameTailLoop

  lda #$00
  ldx #$40
AttrLoop:
  sta PPUDATA
  dex
  bne AttrLoop
  rts

WaveScroll:
  .db $20,$23,$25,$28,$2b,$2d,$30,$32,$35,$37,$39,$3b,$3d,$3e,$3f,$40
  .db $40,$40,$3f,$3e,$3d,$3b,$39,$37,$35,$32,$30,$2d,$2b,$28,$25,$23
  .db $20,$1d,$1b,$18,$15,$13,$10,$0e,$0b,$09,$07,$05,$03,$02,$01,$00
  .db $00,$00,$01,$02,$03,$05,$07,$09,$0b,$0e,$10,$13,$15,$18,$1b,$1d

Palette:
  ; Background palettes: light blue vertical stripes.
  .db $30,$11,$21,$31
  .db $30,$11,$21,$31
  .db $30,$11,$21,$31
  .db $30,$11,$21,$31
  ; Sprite palettes: every nontransparent font pixel is opaque black.
  .db $0f,$0f,$0f,$0f
  .db $0f,$0f,$0f,$0f
  .db $0f,$0f,$0f,$0f
  .db $0f,$0f,$0f,$0f
