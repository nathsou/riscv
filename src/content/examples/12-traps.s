# Title: Exceptions
# Provokes an illegal instruction, a misaligned load and a breakpoint.
# The handler reads mcause/mepc/mtval, reports them and skips the
# faulting instruction (mepc += 4).

        .data
m_cause: .asciz "trap: mcause="
m_epc:   .asciz " mepc="
m_tval:  .asciz " mtval="
nl:      .asciz "\n"

        .text
main:
        la      t0, handler
        csrw    mtvec, t0
        .word   0x00000000              # illegal instruction (all zeros)
        li      a1, 0x10000002
        lw      a0, 0(a1)               # misaligned load
        ebreak                          # breakpoint
        li      a7, 10
        ecall

handler:
        la      a0, m_cause
        li      a7, 4
        ecall
        csrr    a0, mcause
        li      a7, 1
        ecall
        la      a0, m_epc
        li      a7, 4
        ecall
        csrr    a0, mepc
        li      a7, 34                  # print hex
        ecall
        la      a0, m_tval
        li      a7, 4
        ecall
        csrr    a0, mtval
        li      a7, 34
        ecall
        la      a0, nl
        li      a7, 4
        ecall
        csrr    t0, mepc
        addi    t0, t0, 4               # skip the faulting instruction
        csrw    mepc, t0
        mret
