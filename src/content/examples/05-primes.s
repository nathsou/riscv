# Title: Sieve of Eratosthenes
# Finds the primes below 200 using a byte array in .bss.
# Uses mul — an M-extension instruction.

        .equ LIMIT, 200
        .bss
sieve:  .space LIMIT

        .data
space:  .asciz " "

        .text
main:
        la      s0, sieve
        li      s1, 2                   # p = 2
next_p: mul     t0, s1, s1              # p*p
        li      t1, LIMIT
        bge     t0, t1, report
        add     t2, s0, s1
        lbu     t3, 0(t2)
        bnez    t3, advance             # already crossed out
cross:  add     t2, s0, t0
        li      t4, 1
        sb      t4, 0(t2)
        add     t0, t0, s1              # next multiple
        blt     t0, t1, cross
advance:
        addi    s1, s1, 1
        j       next_p

report: li      s1, 2
loop:   add     t2, s0, s1
        lbu     t3, 0(t2)
        bnez    t3, skip
        mv      a0, s1
        li      a7, 1
        ecall
        la      a0, space
        li      a7, 4
        ecall
skip:   addi    s1, s1, 1
        li      t1, LIMIT
        blt     s1, t1, loop
        li      a7, 10
        ecall
