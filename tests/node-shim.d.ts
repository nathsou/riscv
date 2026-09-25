// Minimal type shims for the Node built-ins used by the test suite
// (keeps the project free of @types/node).
declare module 'node:test' {
  type Fn = (t: unknown) => void | Promise<void>;
  export function test(name: string, fn: Fn): void;
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: Fn): void;
}
declare module 'node:assert/strict' {
  interface Assert {
    (value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): asserts value;
    throws(fn: () => unknown, expected?: unknown, message?: string): void;
    match(value: string, re: RegExp, message?: string): void;
    fail(message?: string): never;
  }
  const assert: Assert;
  export default assert;
}
declare module 'node:fs' {
  export function readFileSync(path: string | URL, enc: 'utf8'): string;
  export function readdirSync(path: string | URL): string[];
}
