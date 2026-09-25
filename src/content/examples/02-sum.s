# Title: Sum 1 … n
# A counted loop. Step through it and watch t0 and a0 change,
# and the branch at the bottom jump backwards.

        .text
main:
        li      t0, 1           # i = 1
        li      t1, 10          # n = 10
        li      a0, 0           # sum = 0
loop:
        add     a0, a0, t0      # sum += i
        addi    t0, t0, 1       # i++
        ble     t0, t1, loop    # pseudo: bge t1, t0, loop

        li      a7, 1           # print_int(sum)
        ecall
        li      a7, 10          # exit
        ecall
