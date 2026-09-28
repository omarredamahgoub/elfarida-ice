import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { onRequestPost } from "../functions/api/quote.js";

/** Minimal D1 double covering exactly the statements /api/quote issues. */
function fakeDb() {
  const leads = [];
  const quota = [];
  const settings = { turnstile_secret: "ts-secret", resend_api_key: "rk" };
  return {
    leads,
    quota,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes("FROM settings WHERE k = ?")) {
                const v = settings[args[0]];
                return v ? { v } : null;
              }
              if (sql.includes("lower(email)"))
                return {
                  n: leads.filter((l) => l.email.toLowerCase() === args[0].toLowerCase()).length,
                };
              if (sql.includes("FROM quote_quota WHERE kind = ?"))
                return { n: quota.filter((q) => q === args[0]).length };
              if (sql.includes("WHERE ip = ?"))
                return { n: leads.filter((l) => l.ip === args[0]).length };
              return null;
            },
            async run() {
              if (sql.startsWith("INSERT INTO quote_quota")) quota.push(args[0]);
              if (sql.startsWith("INSERT INTO leads")) {
                const [id, createdAt, name, email, phone, subject, payload, ip] = args;
                leads.push({ id, createdAt, name, email, phone, subject, payload, ip });
              }
            },
          };
        },
        async run() {},
        async all() {
          return { results: Object.entries(settings).map(([k, v]) => ({ k, v })) };
        },
      };
    },
  };
}

let sent;
let realFetch;
let db;

beforeEach(() => {
  sent = [];
  db = fakeDb();
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("turnstile")) {
      return new Response(JSON.stringify({ success: init.body.get("response") === "valid" }));
    }
    sent.push(JSON.parse(init.body));
    return new Response("{}", { status: 200 });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

let ipCounter = 0;
async function post(body, contentType = "application/json") {
  ipCounter += 1;
  const request = new Request("https://elfaridaice.com/api/quote", {
    method: "POST",
    headers: { "content-type": contentType, "CF-Connecting-IP": `10.0.0.${ipCounter}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const res = await onRequestPost({ request, env: { DB: db } });
  return { status: res.status, body: await res.json(), recipients: sent.map((m) => m.to) };
}

describe("/api/quote", () => {
  test("an unverified request never mails the address it supplies", async () => {
    const r = await post({ name: "x", email: "victim@example.com", protected: "1" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.recipients, [["info@elfaridaice.com"]]);
  });

  test("a verified request is acknowledged once per address per day", async () => {
    const body = { name: "Ali", email: "ali@example.com", protected: "1", turnstileToken: "valid" };
    assert.deepEqual((await post(body)).recipients, [
      ["info@elfaridaice.com"],
      ["ali@example.com"],
    ]);
    sent = [];
    assert.deepEqual((await post(body)).recipients, [["info@elfaridaice.com"]]);
  });

  test("a submission with a link in the name is dropped silently", async () => {
    const r = await post({
      name: "📌 Transfer from Coinbase. NEXT ->> graph.org/Bitcoin-Mining",
      email: "victim@example.com",
      phone: "046039021344",
    });
    assert.equal(r.body.success, true);
    assert.equal(db.leads.length, 0);
    assert.equal(sent.length, 0);
  });

  test("unverified intake shares a site-wide hourly budget across IPs", async () => {
    for (let i = 0; i < 40; i++) db.quota.push("unverified_lead");
    const r = await post({ name: "late", phone: "0500000000" });
    assert.equal(r.status, 429);
    assert.equal(db.leads.length, 0);
  });

  test("owner mail stops at its hourly budget while leads are still stored", async () => {
    for (let i = 0; i < 15; i++) db.quota.push("owner_mail_unverified");
    const r = await post({ name: "buyer", phone: "0500000000" });
    assert.equal(r.status, 200);
    assert.equal(db.leads.length, 1);
    assert.equal(sent.length, 0);
  });

  test("acknowledgements stop at their hourly budget", async () => {
    for (let i = 0; i < 30; i++) db.quota.push("confirmation_mail");
    await post({ name: "Ali", email: "ali@example.com", protected: "1", turnstileToken: "valid" });
    assert.deepEqual(
      sent.map((m) => m.to),
      [["info@elfaridaice.com"]]
    );
  });

  test("a failed Turnstile token is rejected", async () => {
    const r = await post({ name: "A", protected: "1", turnstileToken: "forged" });
    assert.equal(r.status, 403);
    assert.equal(db.leads.length, 0);
  });

  test("oversized, non-object and unsupported bodies are rejected", async () => {
    assert.equal((await post({ name: "a", d: "x".repeat(20000) })).status, 413);
    assert.equal((await post([1, 2])).status, 400);
    assert.equal((await post("name=a", "text/plain")).status, 400);
  });

  test("subject is forced onto a single line", async () => {
    await post({ name: "a", subject: "hi\r\nBcc: x@example.com" });
    assert.equal(sent[0].subject, "hi Bcc: x@example.com");
  });

  test("structured values are discarded, not stringified", async () => {
    await post({ name: { $gt: 1 }, phone: "0500000000" });
    assert.equal(db.leads[0].name, "");
    assert.equal(JSON.parse(db.leads[0].payload).name, undefined);
  });

  test("honeypot hits are accepted silently and never stored", async () => {
    const r = await post({ name: "bot", botcheck: "1" });
    assert.equal(r.body.success, true);
    assert.equal(db.leads.length, 0);
    assert.equal(sent.length, 0);
  });

  test("urlencoded submissions still work", async () => {
    const r = await post("name=Omar&phone=0500000000", "application/x-www-form-urlencoded");
    assert.equal(r.status, 200);
    assert.equal(db.leads[0].name, "Omar");
  });
});
