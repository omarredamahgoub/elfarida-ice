import test from "node:test";
import assert from "node:assert/strict";

import { run, htmlWrap } from "../workers/digest/src/index.js";

const NOW = new Date("2026-09-17T05:00:00Z");

/**
 * A stand-in for the D1 binding: it answers by matching the statement rather
 * than by call order, so a change to the order of the Worker's reads does not
 * silently start feeding leads into the contacts slot.
 */
function fakeDb({ leads = [], contacts = [], settings = {}, missing = [], written = [] } = {}) {
  return {
    written,
    prepare(sql) {
      const stmt = {
        bind: (...args) => {
          stmt.args = args;
          return stmt;
        },
        run: async () => {
          written.push({ sql, args: stmt.args });
          return {};
        },
        all: async () => {
          if (sql.includes("FROM contact_events")) {
            if (missing.includes("contact_events")) throw new Error("no such table");
            return { results: contacts };
          }
          if (sql.includes("FROM settings")) {
            if (missing.includes("settings")) throw new Error("no such table");
            return { results: Object.entries(settings).map(([k, v]) => ({ k, v })) };
          }
          return { results: leads };
        },
      };
      return stmt;
    },
  };
}

const MAIL = { resend_api_key: "re_test", lead_to: "owner@example.com" };

function captureFetch() {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true };
  };
  return calls;
}

test("digest worker", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  await t.test("does nothing at all without a database binding", async () => {
    const out = await run({}, NOW);
    assert.deepEqual(out, { sent: false, reason: "no-db" });
  });

  await t.test("does not send when no mail key is configured", async () => {
    const calls = captureFetch();
    const out = await run({ DB: fakeDb({ settings: {} }) }, NOW);
    assert.equal(out.sent, false);
    assert.equal(out.reason, "no-mail-config");
    assert.equal(calls.length, 0);
  });

  await t.test("sends the digest to the configured recipients", async () => {
    const calls = captureFetch();
    const out = await run(
      {
        DB: fakeDb({
          leads: [{ created_at: "2026-09-17T04:00:00Z", status: "new" }],
          contacts: [{ created_at: "2026-09-17T04:30:00Z", channel: "whatsapp", page: "/x" }],
          settings: MAIL,
        }),
      },
      NOW
    );
    assert.equal(out.sent, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.resend.com/emails");
    assert.deepEqual(calls[0].body.to, ["owner@example.com"]);
    assert.match(calls[0].body.subject, /ملخص 17\/09\/2026/);
    assert.match(calls[0].body.text, /طلبات النماذج: 1/);
    assert.match(calls[0].body.text, /واتساب: 1/);
  });

  await t.test("digest_to overrides lead_to, and splits a multi-recipient value", async () => {
    const calls = captureFetch();
    await run(
      {
        DB: fakeDb({
          settings: { ...MAIL, digest_to: "a@x.com, b@x.com" },
        }),
      },
      NOW
    );
    assert.deepEqual(calls[0].body.to, ["a@x.com", "b@x.com"]);
  });

  await t.test("still sends on a completely silent day", async () => {
    const calls = captureFetch();
    const out = await run({ DB: fakeDb({ settings: MAIL }) }, NOW);
    assert.equal(out.sent, true);
    assert.match(calls[0].body.text, /الإجمالي: 0/);
  });

  await t.test("survives a database with no contact_events table yet", async () => {
    const calls = captureFetch();
    const out = await run({ DB: fakeDb({ settings: MAIL, missing: ["contact_events"] }) }, NOW);
    assert.equal(out.sent, true);
    assert.match(calls[0].body.text, /واتساب: 0/);
  });

  await t.test("reports a failed send rather than claiming success", async () => {
    globalThis.fetch = async () => ({ ok: false });
    const out = await run({ DB: fakeDb({ settings: MAIL }) }, NOW);
    assert.deepEqual(out, { sent: false, reason: "send-failed" });
  });

  await t.test("the mail body and the plain text are the same message", async () => {
    const calls = captureFetch();
    await run({ DB: fakeDb({ settings: MAIL }) }, NOW);
    const { text, html } = calls[0].body;
    assert.equal(html, htmlWrap(text));
  });

  await t.test("records a successful run where the admin panel can read it", async () => {
    captureFetch();
    const db = fakeDb({ settings: MAIL });
    await run({ DB: db }, NOW);
    const write = db.written.find((w) => w.sql.includes("digest_last_run"));
    assert.ok(
      write,
      "nothing was recorded — a silent cron would be indistinguishable from a quiet week"
    );
    assert.deepEqual(JSON.parse(write.args[0]), {
      at: NOW.toISOString(),
      sent: true,
      reason: "",
    });
  });

  await t.test("records a failure with its reason, not just silence", async () => {
    globalThis.fetch = async () => ({ ok: false });
    const db = fakeDb({ settings: MAIL });
    await run({ DB: db }, NOW);
    const write = db.written.find((w) => w.sql.includes("digest_last_run"));
    assert.equal(JSON.parse(write.args[0]).sent, false);
    assert.equal(JSON.parse(write.args[0]).reason, "send-failed");
  });

  await t.test("records the missing-configuration case too", async () => {
    const db = fakeDb({ settings: {} });
    await run({ DB: db }, NOW);
    const write = db.written.find((w) => w.sql.includes("digest_last_run"));
    assert.equal(JSON.parse(write.args[0]).reason, "no-mail-config");
  });

  await t.test("a failure to record never turns a sent digest into a failed one", async () => {
    const calls = captureFetch();
    const db = fakeDb({ settings: MAIL });
    const prepare = db.prepare.bind(db);
    db.prepare = (sql) =>
      sql.includes("digest_last_run")
        ? {
            bind: () => ({
              run: async () => {
                throw new Error("read-only");
              },
            }),
          }
        : prepare(sql);
    const out = await run({ DB: db }, NOW);
    assert.equal(out.sent, true);
    assert.equal(calls.length, 1);
  });
});

test("htmlWrap", async (t) => {
  await t.test("marks the message right-to-left and preserves its line breaks", () => {
    const out = htmlWrap("سطر\nسطر آخر");
    assert.match(out, /dir="rtl"/);
    assert.match(out, /white-space:pre-wrap/);
    assert.match(out, /سطر\nسطر آخر/);
  });

  await t.test("escapes markup so a page title cannot break the email", () => {
    assert.match(htmlWrap("<script>x</script>"), /&lt;script&gt;/);
    assert.doesNotMatch(htmlWrap("<script>x</script>"), /<script>/);
  });
});
