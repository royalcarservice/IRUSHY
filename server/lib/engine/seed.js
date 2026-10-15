// IRUSHY local engine - deterministic seeds.
//
// No Math.random() and no clock anywhere in the engine. Every "choice" (which
// phrase variant, which practice question) is a hash of the request and the
// knowledge version, so the same request against the same knowledge always
// produces the same answer, while different questions still read naturally.

import crypto from 'node:crypto';

export function makeSeed(parts) {
  return crypto
    .createHash('sha256')
    .update(parts.map((p) => String(p ?? '')).join('\u241F'))
    .digest('hex')
    .slice(0, 16);
}

export function seededIndex(seed, key, n) {
  if (!Number.isInteger(n) || n <= 1) return 0;
  const h = crypto.createHash('sha256').update(`${seed}|${key}`).digest();
  return h.readUInt32BE(0) % n;
}
