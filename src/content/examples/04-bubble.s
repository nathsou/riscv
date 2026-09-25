# Title: Bubble sort
# Sorts an array of words in memory, then prints it.
# Open the Memory tab at 0x10000000 to watch elements swap.

        .data
array:  .word 42, 7, 19, -3, 88, 0, 23, 5, 61, 14
        .equ N, 10
sep:    .asciz ", "
nl:     .asciz "\n"

        .text
main:
        la      s0, array
        li      s1, N
outer:  addi    s1, s1, -1      # passes left
        blez    s1, done
        li      t0, 0           # i
        mv      t1, s0          # p = &array[0]
inner:  lw      t2, 0(t1)
        lw      t3, 4(t1)
        ble     t2, t3, noswap
        sw      t3, 0(t1)       # swap
        sw      t2, 4(t1)
noswap: addi    t1, t1, 4
        addi    t0, t0, 1
        blt     t0, s1, inner
        j       outer

done:   li      t0, 0
print:  slli    t1, t0, 2
        add     t1, t1, s0
        lw      a0, 0(t1)
        li      a7, 1
        ecall
        addi    t0, t0, 1
        li      t1, N
        beq     t0, t1, end
        la      a0, sep
        li      a7, 4
        ecall
        j       print
end:    la      a0, nl
        li      a7, 4
        ecall
        li      a7, 10
        ecall
