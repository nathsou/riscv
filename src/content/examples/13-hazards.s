# Title: Pipeline hazards
# Designed for the 5-stage pipeline mode: watch the pipeline chart.
#  • back-to-back dependencies are solved by forwarding (EX→EX, MEM→EX)
#  • a load followed by its use needs a one-cycle stall (load-use hazard)
#  • a taken branch flushes the two instructions fetched behind it

        .data
vals:   .word 3, 4

        .text
main:
        la      s0, vals
        addi    t0, zero, 5             # t0 = 5
        add     t1, t0, t0              # needs t0 now: EX→EX forward
        sub     t2, t1, t0              # needs t1 (EX→EX) and t0 (MEM→EX)
        lw      t3, 0(s0)               # load …
        add     t4, t3, t2              # … used immediately: stall 1 cycle
        lw      t5, 4(s0)
        nop                             # independent instruction hides the load delay
        add     t6, t5, t4
        li      a0, 3
loop:   addi    a0, a0, -1
        bnez    a0, loop                # taken twice: 2-cycle flush each time
        mv      a0, t6
        li      a7, 1
        ecall                           # prints 12
        li      a7, 10
        ecall
