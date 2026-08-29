// Shared HMAC token utility for member links.
// Runs in BOTH the Edge runtime (middleware.js) and the Node runtime
// (api/member-*.js), so it uses only Web Crypto (globalThis.crypto.subtle) and
// btoa/atob — never the Node `crypto` module or Buffer.
//
// Token format:  base64url(JSON payload) + "." + base64url(HMAC-SHA256 sig)
// The payload is { n: <name>, r: <role "AM"|"MB"> }. The signature is what makes
// a token unforgeable — a member cannot swap in a colleague's name without the
// secret. The token identifies WHO; the member password (see middleware) is the
// separate access gate for the member-view surface as a whole.

const subtle = globalThis.crypto.subtle;

function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
const enc = (str) => new TextEncoder().encode(str);
const dec = (bytes) => new TextDecoder().decode(bytes);

async function importKey(secret) {
  return subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// Constant-time-ish comparison over the recomputed signature via subtle.verify.
export async function signToken(payload, secret) {
  if (!secret) throw new Error('signToken: missing secret');
  const body = bytesToB64url(enc(JSON.stringify(payload)));
  const key = await importKey(secret);
  const sig = new Uint8Array(await subtle.sign('HMAC', key, enc(body)));
  return body + '.' + bytesToB64url(sig);
}

// Returns the decoded payload object on success, or null on any failure
// (missing/malformed token, bad signature, unparseable body). Never throws.
export async function verifyToken(token, secret) {
  try {
    if (!secret || !token || typeof token !== 'string') return null;
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    if (!body || !sig) return null;
    const key = await importKey(secret);
    const ok = await subtle.verify('HMAC', key, b64urlToBytes(sig), enc(body));
    if (!ok) return null;
    const payload = JSON.parse(dec(b64urlToBytes(body)));
    return (payload && typeof payload === 'object') ? payload : null;
  } catch {
    return null;
  }
}
