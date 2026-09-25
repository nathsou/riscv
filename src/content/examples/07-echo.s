# Title: Console input
# Reads two integers from the console and prints their product.
# Type a number in the console and press Enter when the program waits.

        .data
ask1:   .asciz "First number: "
ask2:   .asciz "Second number: "
res:    .asciz "Product: "

        .text
main:
        la      a0, ask1
        li      a7, 4
        ecall
        li      a7, 5           # read_int → a0
        ecall
        mv      s0, a0

        la      a0, ask2
        li      a7, 4
        ecall
        li      a7, 5
        ecall
        mv      s1, a0

        la      a0, res
        li      a7, 4
        ecall
        mul     a0, s0, s1
        li      a7, 1
        ecall
        li      a7, 10
        ecall
