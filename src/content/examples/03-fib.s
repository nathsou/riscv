# Title: Recursive Fibonacci
# fib(n) = fib(n-1) + fib(n-2). Each call saves ra and two callee-saved
# registers on the stack — open the Memory tab and follow sp.

        .text
main:
        li      a0, 10
        call    fib             # a0 = fib(10)
        li      a7, 1
        ecall                   # prints 55
        li      a7, 10
        ecall

# int fib(int n)
fib:
        li      t0, 2
        blt     a0, t0, base    # fib(0)=0, fib(1)=1
        addi    sp, sp, -16     # push a stack frame
        sw      ra, 12(sp)
        sw      s0, 8(sp)
        sw      s1, 4(sp)
        mv      s0, a0          # s0 = n
        addi    a0, s0, -1
        call    fib             # fib(n-1)
        mv      s1, a0
        addi    a0, s0, -2
        call    fib             # fib(n-2)
        add     a0, a0, s1
        lw      ra, 12(sp)      # pop the frame
        lw      s0, 8(sp)
        lw      s1, 4(sp)
        addi    sp, sp, 16
base:
        ret
