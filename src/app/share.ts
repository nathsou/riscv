/** Encode programs into URL-safe strings with the built-in CompressionStream. */
async function pump(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export async function encodeProgram(src: string): Promise<string> {
  const input = new Blob([new TextEncoder().encode(src)]).stream();
  const bytes = await pump(input.pipeThrough(new CompressionStream('deflate-raw')));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function decodeProgram(code: string): Promise<string> {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const out = await pump(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')));
  return new TextDecoder().decode(out);
}
