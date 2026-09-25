# Title: Game of Life
# Conway's cellular automaton on a 64×64 torus, drawn to the framebuffer.
# Seeded from the RANDOM device. Run at full speed.

        .equ FB, 0xff000000
        .equ RANDOM, 0xffff0040
        .equ ALIVE, 0x1e                # green-cyan (RGB332)
        .equ N, 64

        .bss
cur:    .space N*N
nxt:    .space N*N

        .text
main:
        la      s0, cur
        la      s1, nxt
        li      t0, RANDOM
        li      t1, 0
seed:   lw      t2, 0(t0)
        andi    t2, t2, 3
        seqz    t2, t2                  # ~25% alive
        add     t3, s0, t1
        sb      t2, 0(t3)
        addi    t1, t1, 1
        li      t3, N*N
        blt     t1, t3, seed

gen:    call    draw
        call    step
        mv      t0, s0                  # swap buffers
        mv      s0, s1
        mv      s1, t0
        li      a0, 30                  # pace: sleep 30 ms
        li      a7, 32
        ecall
        j       gen

# nxt = life(cur)
step:   li      a1, 0                   # y
1:      li      a2, 0                   # x
2:      li      a3, 0                   # neighbours
        li      a4, -1                  # dy
3:      li      a5, -1                  # dx
4:      or      t0, a4, a5
        beqz    t0, 5f                  # skip (0,0)… (or dx=dy=0 only)
        add     t0, a1, a4
        andi    t0, t0, N-1
        slli    t0, t0, 6
        add     t1, a2, a5
        andi    t1, t1, N-1
        add     t0, t0, t1
        add     t0, t0, s0
        lbu     t0, 0(t0)
        add     a3, a3, t0
5:      addi    a5, a5, 1
        li      t0, 2
        blt     a5, t0, 4b
        addi    a4, a4, 1
        blt     a4, t0, 3b
        # rule: alive' = (n == 3) | (alive & n == 2)
        slli    t0, a1, 6
        add     t0, t0, a2
        add     t1, t0, s0
        lbu     t1, 0(t1)
        addi    t2, a3, -3
        seqz    t2, t2
        addi    t3, a3, -2
        seqz    t3, t3
        and     t3, t3, t1
        or      t2, t2, t3
        add     t0, t0, s1
        sb      t2, 0(t0)
        addi    a2, a2, 1
        li      t0, N
        blt     a2, t0, 2b
        addi    a1, a1, 1
        blt     a1, t0, 1b
        ret

# framebuffer = cur ? ALIVE : 0
draw:   li      t0, 0
        li      t1, FB
        li      t4, ALIVE
1:      add     t2, s0, t0
        lbu     t2, 0(t2)
        neg     t2, t2                  # 0 or -1
        and     t2, t2, t4
        add     t3, t1, t0
        sb      t2, 0(t3)
        addi    t0, t0, 1
        li      t2, N*N
        blt     t0, t2, 1b
        ret
