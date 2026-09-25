/** Documentation for the environment calls the simulated OS understands (RARS numbering + Linux write/exit). */
export interface SyscallDoc { n: number; name: string; args: string; result: string; description: string }

export const SYSCALLS: SyscallDoc[] = [
  { n: 1, name: 'PrintInt', args: 'a0 = integer', result: '', description: 'Print a0 as a signed decimal number.' },
  { n: 4, name: 'PrintString', args: 'a0 = address', result: '', description: 'Print the NUL-terminated string at a0.' },
  { n: 5, name: 'ReadInt', args: '', result: 'a0 = integer', description: 'Read a line from the console and parse it as a decimal integer. Waits for input.' },
  { n: 8, name: 'ReadString', args: 'a0 = buffer, a1 = size', result: '', description: 'Read a line (up to a1 − 1 characters) into the buffer and NUL-terminate it. Waits for input.' },
  { n: 10, name: 'Exit', args: '', result: '', description: 'Stop the program with exit code 0.' },
  { n: 11, name: 'PrintChar', args: 'a0 = character', result: '', description: 'Print the low byte of a0 as a character.' },
  { n: 12, name: 'ReadChar', args: '', result: 'a0 = character', description: 'Read one character from the console. Waits for input.' },
  { n: 17, name: 'Exit2', args: 'a0 = code', result: '', description: 'Stop the program with exit code a0.' },
  { n: 30, name: 'Time', args: '', result: 'a0 = low, a1 = high', description: 'The current value of mtime (one tick per retired instruction, plus any time skipped by sleep/wfi).' },
  { n: 32, name: 'Sleep', args: 'a0 = milliseconds', result: '', description: 'Pause the animation for a0 ms of real time (useful for games).' },
  { n: 34, name: 'PrintIntHex', args: 'a0 = integer', result: '', description: 'Print a0 as 0x-prefixed hexadecimal (8 digits).' },
  { n: 35, name: 'PrintIntBinary', args: 'a0 = integer', result: '', description: 'Print a0 as 0b-prefixed binary (32 digits).' },
  { n: 36, name: 'PrintIntUnsigned', args: 'a0 = integer', result: '', description: 'Print a0 as an unsigned decimal number.' },
  { n: 40, name: 'RandSeed', args: 'a1 = seed', result: '', description: 'Seed the pseudo-random generator.' },
  { n: 41, name: 'RandInt', args: '', result: 'a0 = random', description: 'A pseudo-random 32-bit integer.' },
  { n: 42, name: 'RandIntRange', args: 'a1 = bound', result: 'a0 = random', description: 'A pseudo-random integer in [0, a1).' },
  { n: 64, name: 'write (Linux)', args: 'a0 = fd, a1 = buffer, a2 = length', result: 'a0 = bytes written', description: 'Write a2 bytes from the buffer to the console (the file descriptor is ignored).' },
  { n: 93, name: 'exit (Linux)', args: 'a0 = code', result: '', description: 'Stop the program with exit code a0.' },
];
