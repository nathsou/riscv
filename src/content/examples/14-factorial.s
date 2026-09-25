# Title: Factorial & 64-bit multiply
# Iterative factorial with mul, then a 32×32→64-bit product using
# mulhu (high half) and mul (low half).

        .data
f:      .asciz "12! = "
p:      .asciz "\n0xffffffff × 0xffffffff = "
nl:     .asciz "\n"

        .text
main:
        li      t0, 12
        li      a0, 1
1:      mul     a0, a0, t0
        addi    t0, t0, -1
        bnez    t0, 1b
        mv      s0, a0
        la      a0, f
        li      a7, 4
        ecall
        mv      a0, s0
        li      a7, 36                  # print unsigned
        ecall

        la      a0, p
        li      a7, 4
        ecall
        li      t0, -1
        mulhu   a0, t0, t0              # high word
        li      a7, 34
        ecall
        mul     a0, t0, t0              # low word
        li      a7, 34
        ecall
        la      a0, nl
        li      a7, 4
        ecall
        li      a7, 10
        ecall
