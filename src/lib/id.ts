const ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Short, unambiguous random ID for parties and templates. */
export function randomId(): string {
  const buf = new Uint8Array(6)
  crypto.getRandomValues(buf)
  let out = ''
  for (const b of buf) out += ID_ALPHABET[b % ID_ALPHABET.length]
  return out
}
