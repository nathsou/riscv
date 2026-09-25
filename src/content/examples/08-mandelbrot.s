# Title: Mandelbrot set
# Fixed-point (Q12) arithmetic drawn straight into the 64×64 framebuffer
# at 0xff000000 (one RGB332 byte per pixel). Run at full speed.

        .equ FB, 0xff000000
        .equ ONE, 4096                  # 1.0 in Q12
        .equ MAXIT, 24

        .data
palette: .byte 0x00, 0x00, 0x05, 0x05, 0x09, 0x0a, 0x0e, 0x0e, 0x12, 0x13, 0x37, 0x57, 0x5b, 0x7b, 0x9a, 0xba, 0xba, 0xd9, 0xd9, 0xf4, 0xf0, 0xf0, 0xec, 0xe8, 0x00

        .text
main:
        li      s0, FB                  # pixel pointer
        la      s1, palette
        li      s2, 0                   # y
        li      s5, -6554               # cy = -1.6
rows:   li      s3, 0                   # x
        li      s4, -9011               # cx = -2.2
cols:   li      t0, 0                   # zx
        li      t1, 0                   # zy
        li      t2, 0                   # iteration
        li      t6, 4*ONE               # escape radius²
iter:   mul     t3, t0, t0
        srai    t3, t3, 12              # zx²
        mul     t4, t1, t1
        srai    t4, t4, 12              # zy²
        add     t5, t3, t4
        bgt     t5, t6, escaped
        mul     t5, t0, t1
        srai    t5, t5, 11              # 2·zx·zy
        add     t1, t5, s5              # zy' = 2·zx·zy + cy
        sub     t0, t3, t4
        add     t0, t0, s4              # zx' = zx² − zy² + cx
        addi    t2, t2, 1
        li      t5, MAXIT
        blt     t2, t5, iter
escaped:
        add     t5, s1, t2
        lbu     t5, 0(t5)               # colour = palette[i]
        sb      t5, 0(s0)
        addi    s0, s0, 1
        addi    s4, s4, 205             # cx += 3.2/64
        addi    s3, s3, 1
        li      t5, 64
        blt     s3, t5, cols
        addi    s5, s5, 205             # cy += 3.2/64
        addi    s2, s2, 1
        blt     s2, t5, rows
        li      a7, 10
        ecall
