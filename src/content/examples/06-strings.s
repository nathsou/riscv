# Title: Strings in memory
# strlen, in-place reverse and upper-casing with byte loads and stores.

        .data
text:   .asciz "risc-v is fun"
nl:     .asciz "\n"

        .text
main:
        la      a0, text
        call    strlen
        mv      s1, a0                  # s1 = length
        li      a7, 1
        ecall                           # print length
        la      a0, nl
        li      a7, 4
        ecall

        la      a0, text
        mv      a1, s1
        call    reverse
        la      a0, text
        call    upcase
        la      a0, text
        li      a7, 4
        ecall                           # "NUF SI V-CSIR"
        li      a7, 10
        ecall

# size_t strlen(const char *s)
strlen: mv      t0, a0
1:      lbu     t1, 0(t0)
        beqz    t1, 2f
        addi    t0, t0, 1
        j       1b
2:      sub     a0, t0, a0
        ret

# void reverse(char *s, size_t n)
reverse:
        add     t1, a0, a1
        addi    t1, t1, -1              # last char
1:      bgeu    a0, t1, 2f
        lbu     t2, 0(a0)
        lbu     t3, 0(t1)
        sb      t3, 0(a0)
        sb      t2, 0(t1)
        addi    a0, a0, 1
        addi    t1, t1, -1
        j       1b
2:      ret

# void upcase(char *s)
upcase: li      t2, 'a'
        li      t3, 'z'
1:      lbu     t1, 0(a0)
        beqz    t1, 3f
        blt     t1, t2, 2f
        bgt     t1, t3, 2f
        addi    t1, t1, -32             # 'a' - 'A'
        sb      t1, 0(a0)
2:      addi    a0, a0, 1
        j       1b
3:      ret
