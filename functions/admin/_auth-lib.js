/**
 * Admin credential and session primitives, shared by the Pages Function
 * (functions/admin/leads.js) and the local reset script
 * (scripts/reset-admin-password.mjs) so both write the same hash format.
 *
 * Runtime-agnostic: relies only on the Web Crypto API (`crypto.subtle`,
 * `crypto.getRandomValues`), present in Cloudflare Workers and Node ≥ 20.
 *
 * Password storage: PBKDF2-HMAC-SHA256, per-password random salt, encoded as
 *   pbkdf2$<iterations>$<saltHex>$<hashHex>
 * 100 000 iterations is the ceiling Cloudflare Workers accept for PBKDF2.
 * A bare 64-hex-char value is the legacy unsalted SHA-256 format; it is still
 * verified so existing credentials keep working, and callers upgrade it on the
 * next successful login.
 *
 * Sessions: `<b64u(user)>.<expiryMs>.<hmac>` where the HMAC key is a random
 * server-side secret (never derived from the password hash), and the signed
 * message binds a fingerprint of the current password hash — so a password
 * change revokes every outstanding session without a session table.
 */

export const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const HASH_BITS = 256;
const SECRET_BYTES = 32;
const PBKDF2_PREFIX = "pbkdf2";
const LEGACY_HASH_RE = /^[0-9a-f]{64}$/;

const encoder = new TextEncoder();

export function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Constant-time string comparison (length is not secret). */
export function safeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length) return false;
  let r = 0;
  for (let i = 0; i < x.length; i++) r |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return r === 0;
}

export function randomHex(bytes = SECRET_BYTES) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256Hex(s) {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(s)));
}

async function pbkdf2Hex(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
    key,
    HASH_BITS
  );
  return toHex(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2Hex(password, salt, PBKDF2_ITERATIONS);
  return `${PBKDF2_PREFIX}$${PBKDF2_ITERATIONS}$${toHex(salt)}$${hash}`;
}

/** True when the stored value should be re-hashed with the current scheme. */
export function needsRehash(stored) {
  const parts = String(stored).split("$");
  return parts[0] !== PBKDF2_PREFIX || Number(parts[1]) !== PBKDF2_ITERATIONS;
}

export async function verifyPassword(password, stored) {
  const value = String(stored || "");
  if (LEGACY_HASH_RE.test(value)) return safeEqual(await sha256Hex(password), value);
  const parts = value.split("$");
  if (parts.length !== 4 || parts[0] !== PBKDF2_PREFIX) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS)
    return false;
  if (!/^[0-9a-f]+$/.test(parts[2]) || parts[2].length % 2 !== 0) return false;
  const candidate = await pbkdf2Hex(password, fromHex(parts[2]), iterations);
  return safeEqual(candidate, parts[3]);
}

function b64uEncode(s) {
  const bytes = encoder.encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64uDecode(s) {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(bin, (c) => c.charCodeAt(0))
    );
  } catch {
    return "";
  }
}

async function hmacHex(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

async function sessionMessage(userPart, expiry, passwordHash) {
  return `${userPart}.${expiry}.${(await sha256Hex(passwordHash)).slice(0, 32)}`;
}

export async function createSessionToken({ user, passwordHash, secret, maxAgeSeconds, now }) {
  const userPart = b64uEncode(user);
  const expiry = now + maxAgeSeconds * 1000;
  const sig = await hmacHex(await sessionMessage(userPart, expiry, passwordHash), secret);
  return `${userPart}.${expiry}.${sig}`;
}

export async function verifySessionToken(token, { user, passwordHash, secret, now }) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return false;
  const [userPart, expiryRaw, sig] = parts;
  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry) || now > expiry) return false;
  if (b64uDecode(userPart) !== user) return false;
  const expected = await hmacHex(await sessionMessage(userPart, expiryRaw, passwordHash), secret);
  return safeEqual(sig, expected);
}
