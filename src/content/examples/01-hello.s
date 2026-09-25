# Title: Hello, world
# The classic. Prints a string with the print_string system call.
# Watch: `la` expands into auipc + addi — look at the listing column.

        .data
msg:    .asciz "Hello, RISC-V!\n"

        .text
main:
        la      a0, msg         # a0 = address of the string
        li      a7, 4           # syscall 4 = print_string
        ecall

        li      a0, 0           # exit code
        li      a7, 93          # syscall 93 = exit
        ecall
