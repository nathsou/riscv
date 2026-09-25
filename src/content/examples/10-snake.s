# Title: Snake
# A tiny game: click the framebuffer, then steer with the arrow keys or WASD.
# Keys arrive through memory-mapped I/O (KEY_READY / KEY_CODE).
# Run at full speed — the game paces itself with the sleep syscall.

        .equ FB, 0xff000000
        .equ KEYS, 0xffff0010           # KEY_READY; KEY_CODE is at +4
        .equ G, 32                      # 32×32 cells, 2×2 pixels each
        .equ MAXLEN, 1024
        .equ SNAKE, 0x1c                # green (RGB332)
        .equ FOOD, 0xe4                 # red-orange

        .bss
body:   .space MAXLEN*2                 # ring buffer of cells (y*32+x)
grid:   .space G*G                      # occupancy map

        .data
hello:  .asciz "Click the framebuffer, then use arrows / WASD.\n"
over:   .asciz "Game over! Score: "

        .text
main:
        la      a0, hello
        li      a7, 4
        ecall
        la      s0, body
        la      s1, grid
        li      s2, 0                   # head index
        li      s3, 0                   # tail index
        li      s4, 4                   # target length
        li      s5, 1                   # dx
        li      s6, 0                   # dy
        li      s7, 8                   # head x
        li      s8, 16                  # head y
        li      s9, 0                   # score
        slli    s11, s8, 5
        add     s11, s11, s7
        sh      s11, 0(s0)
        add     t1, s1, s11
        li      t2, 1
        sb      t2, 0(t1)
        mv      a0, s11
        li      a1, SNAKE
        call    plot
        call    place_food

loop:   call    read_keys
        add     s7, s7, s5
        add     s8, s8, s6
        andi    s7, s7, G-1             # wrap around the edges
        andi    s8, s8, G-1
        slli    s11, s8, 5
        add     s11, s11, s7            # new head cell
        add     t1, s1, s11
        lbu     t2, 0(t1)
        bnez    t2, game_over           # bit ourselves
        addi    s2, s2, 1               # push head
        andi    s2, s2, MAXLEN-1
        slli    t3, s2, 1
        add     t3, t3, s0
        sh      s11, 0(t3)
        li      t2, 1
        sb      t2, 0(t1)
        bne     s11, s10, trim
        addi    s4, s4, 3               # ate: grow
        addi    s9, s9, 1
        call    place_food
trim:   sub     t0, s2, s3
        andi    t0, t0, MAXLEN-1
        addi    t0, t0, 1               # current length
        ble     t0, s4, draw
        slli    t1, s3, 1               # pop tail
        add     t1, t1, s0
        lhu     a0, 0(t1)
        add     t2, s1, a0
        sb      zero, 0(t2)
        addi    s3, s3, 1
        andi    s3, s3, MAXLEN-1
        li      a1, 0
        call    plot
draw:   mv      a0, s11
        li      a1, SNAKE
        call    plot
        li      a0, 90                  # sleep 90 ms
        li      a7, 32
        ecall
        j       loop

game_over:
        la      a0, over
        li      a7, 4
        ecall
        mv      a0, s9
        li      a7, 1
        ecall
        li      a7, 10
        ecall

# Drain the key queue, updating the direction (no 180° turns).
read_keys:
        li      t0, KEYS
1:      lw      t1, 0(t0)
        beqz    t1, 9f
        lw      t1, 4(t0)
        li      t2, 0x80
        beq     t1, t2, up
        li      t2, 'w'
        beq     t1, t2, up
        li      t2, 0x81
        beq     t1, t2, down
        li      t2, 's'
        beq     t1, t2, down
        li      t2, 0x82
        beq     t1, t2, left
        li      t2, 'a'
        beq     t1, t2, left
        li      t2, 0x83
        beq     t1, t2, right
        li      t2, 'd'
        beq     t1, t2, right
        j       1b
up:     bnez    s6, 1b
        li      s5, 0
        li      s6, -1
        j       1b
down:   bnez    s6, 1b
        li      s5, 0
        li      s6, 1
        j       1b
left:   bnez    s5, 1b
        li      s5, -1
        li      s6, 0
        j       1b
right:  bnez    s5, 1b
        li      s5, 1
        li      s6, 0
        j       1b
9:      ret

# Put food on a random free cell (s10).
place_food:
        addi    sp, sp, -16
        sw      ra, 12(sp)
1:      li      a1, G*G
        li      a7, 42                  # rand_int_range(0, a1)
        ecall
        add     t0, s1, a0
        lbu     t1, 0(t0)
        bnez    t1, 1b
        mv      s10, a0
        li      a1, FOOD
        call    plot
        lw      ra, 12(sp)
        addi    sp, sp, 16
        ret

# plot(cell a0, colour a1): fill a 2×2 block.
plot:   andi    t0, a0, G-1             # x
        srli    t1, a0, 5               # y
        slli    t1, t1, 7               # y · 2 · 64
        slli    t0, t0, 1               # x · 2
        add     t0, t0, t1
        li      t1, FB
        add     t0, t0, t1
        sb      a1, 0(t0)
        sb      a1, 1(t0)
        sb      a1, 64(t0)
        sb      a1, 65(t0)
        ret
