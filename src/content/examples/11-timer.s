# Title: Timer interrupts
# Installs a trap handler (mtvec), arms the machine timer (mtimecmp) and
# sleeps with wfi. Each interrupt prints a tick and re-arms the timer.
# mtime advances once per retired instruction.

        .equ MTIME, 0xffff0020
        .equ MTIMECMP, 0xffff0028
        .equ PERIOD, 5000

        .data
msg:    .asciz "tick "
nl:     .asciz "\n"

        .text
main:
        la      t0, handler
        csrw    mtvec, t0               # where traps go
        call    rearm
        li      t0, 0x80                # MTIE: machine timer interrupt enable
        csrw    mie, t0
        csrsi   mstatus, 8              # MIE: global interrupt enable
        li      s0, 0                   # ticks seen
wait:   wfi                             # sleep until an interrupt
        li      t0, 5
        blt     s0, t0, wait
        li      a7, 10
        ecall

handler:                                # mcause = 0x80000007
        addi    s0, s0, 1
        la      a0, msg
        li      a7, 4
        ecall
        mv      a0, s0
        li      a7, 1
        ecall
        la      a0, nl
        li      a7, 4
        ecall
        call    rearm
        mret                            # pc ← mepc, re-enable interrupts

rearm:  li      t0, MTIME
        lw      t1, 0(t0)
        li      t2, PERIOD
        add     t1, t1, t2
        li      t0, MTIMECMP
        sw      t1, 0(t0)
        ret
