import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  PBKDF2_ITERATIONS,
  hashPassword,
  verifyPassword,
  needsRehash,
  randomHex,
  safeEqual,
  createSessionToken,
  verifySessionToken,
} from "../functions/admin/_auth-lib.js";

const legacy = (p) => createHash("sha256").update(p).digest("hex");

describe("hashPassword / verifyPassword", () => {
  test("round-trips and rejects a wrong password", async () => {
    const stored = await hashPassword("correct horse");
    assert.match(
      stored,
      new RegExp(`^pbkdf2\\$${PBKDF2_ITERATIONS}\\$[0-9a-f]{32}\\$[0-9a-f]{64}$`)
    );
    assert.equal(await verifyPassword("correct horse", stored), true);
    assert.equal(await verifyPassword("wrong horse", stored), false);
  });
  test("salts every hash", async () => {
    assert.notEqual(await hashPassword("same-password"), await hashPassword("same-password"));
  });
  test("still verifies a legacy unsalted SHA-256 hash", async () => {
    assert.equal(await verifyPassword("old-password", legacy("old-password")), true);
    assert.equal(await verifyPassword("other", legacy("old-password")), false);
  });
  test("rejects malformed and over-costed stored values", async () => {
    for (const bad of ["", "pbkdf2$x$00$00", "pbkdf2$999999999$00$00", "md5$1$00$00", null]) {
      assert.equal(await verifyPassword("x", bad), false);
    }
  });
});

describe("needsRehash", () => {
  test("flags legacy hashes only", async () => {
    assert.equal(needsRehash(legacy("p")), true);
    assert.equal(needsRehash(await hashPassword("p")), false);
  });
});

describe("safeEqual / randomHex", () => {
  test("compares exactly", () => {
    assert.equal(safeEqual("abc", "abc"), true);
    assert.equal(safeEqual("abc", "abd"), false);
    assert.equal(safeEqual("abc", "abcd"), false);
  });
  test("produces distinct 64-char secrets", () => {
    assert.match(randomHex(), /^[0-9a-f]{64}$/);
    assert.notEqual(randomHex(), randomHex());
  });
});

describe("session tokens", () => {
  const base = { user: "عمر", passwordHash: "pbkdf2$1$00$11", secret: "s".repeat(64) };
  const now = 1_800_000_000_000;

  test("verifies a fresh token", async () => {
    const t = await createSessionToken({ ...base, maxAgeSeconds: 60, now });
    assert.equal(await verifySessionToken(t, { ...base, now }), true);
  });
  test("rejects expiry, other user, other secret, changed password, tampering", async () => {
    const t = await createSessionToken({ ...base, maxAgeSeconds: 60, now });
    assert.equal(await verifySessionToken(t, { ...base, now: now + 61_000 }), false);
    assert.equal(await verifySessionToken(t, { ...base, user: "admin", now }), false);
    assert.equal(await verifySessionToken(t, { ...base, secret: "x".repeat(64), now }), false);
    assert.equal(
      await verifySessionToken(t, { ...base, passwordHash: "pbkdf2$1$00$22", now }),
      false
    );
    const [u, , sig] = t.split(".");
    assert.equal(await verifySessionToken(`${u}.${now + 9e9}.${sig}`, { ...base, now }), false);
    assert.equal(await verifySessionToken("garbage", { ...base, now }), false);
  });
  test("cannot be forged from the password hash alone", async () => {
    const forged = await createSessionToken({
      ...base,
      secret: base.passwordHash,
      maxAgeSeconds: 60,
      now,
    });
    assert.equal(await verifySessionToken(forged, { ...base, now }), false);
  });
});
