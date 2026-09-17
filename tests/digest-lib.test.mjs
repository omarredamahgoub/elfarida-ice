import test from "node:test";
import assert from "node:assert/strict";

import {
  dayKeyBack,
  onDay,
  dayDisplay,
  dailyDigest,
  digestStamp,
} from "../functions/admin/_digest-lib.js";

// 10:00 UTC = 13:00 Riyadh on 17 September 2026.
const NOW = new Date("2026-09-17T10:00:00Z");
const at = (iso) => ({ created_at: iso });

test("dayKeyBack", async (t) => {
  await t.test("offset 0 is today in Riyadh", () => {
    assert.equal(dayKeyBack(NOW, 0), "2026-09-17");
  });

  await t.test("offset 1 is yesterday", () => {
    assert.equal(dayKeyBack(NOW, 1), "2026-09-16");
  });

  await t.test("late Riyadh evening still belongs to the Riyadh day", () => {
    // 22:30 UTC is 01:30 the NEXT day in Riyadh — a UTC-based digest would
    // file that traffic under the wrong day and understate the evening.
    const late = new Date("2026-09-17T22:30:00Z");
    assert.equal(dayKeyBack(late, 0), "2026-09-18");
  });
});

test("onDay", async (t) => {
  const rows = [
    at("2026-09-17T06:00:00Z"),
    at("2026-09-16T23:00:00Z"), // 02:00 Riyadh on the 17th
    at("2026-09-15T09:00:00Z"),
  ];

  await t.test("selects by the Riyadh calendar day, not the UTC one", () => {
    assert.equal(onDay(rows, "2026-09-17").length, 2);
  });

  await t.test("an unknown day selects nothing", () => {
    assert.equal(onDay(rows, "2026-01-01").length, 0);
  });
});

test("dayDisplay", async (t) => {
  await t.test("renders a day key the way the owner writes dates", () => {
    assert.equal(dayDisplay("2026-09-17"), "17/09/2026");
  });

  await t.test("passes anything unrecognised through untouched", () => {
    assert.equal(dayDisplay(""), "");
    assert.equal(dayDisplay("nonsense"), "nonsense");
  });
});

test("dailyDigest", async (t) => {
  const leads = [
    { created_at: "2026-09-17T06:00:00Z", status: "new" },
    {
      created_at: "2026-09-16T06:00:00Z",
      status: "contacted",
      answered_at: "2026-09-16T08:00:00Z",
    },
  ];
  const contacts = [
    {
      created_at: "2026-09-17T07:00:00Z",
      channel: "whatsapp",
      page: "/cold-rooms-dammam",
      page_title: "غرف تبريد الدمام",
    },
    {
      created_at: "2026-09-17T08:00:00Z",
      channel: "whatsapp",
      page: "/cold-rooms-dammam",
      page_title: "غرف تبريد الدمام",
    },
    { created_at: "2026-09-17T09:00:00Z", channel: "phone", page: "/contact", page_title: "تواصل" },
    { created_at: "2026-09-16T09:00:00Z", channel: "phone", page: "/contact", page_title: "تواصل" },
  ];

  await t.test("names today's Riyadh date", () => {
    assert.match(dailyDigest(leads, contacts, NOW), /17\/09\/2026/);
  });

  await t.test("counts each channel separately and totals them", () => {
    const out = dailyDigest(leads, contacts, NOW);
    assert.match(out, /طلبات النماذج: 1/);
    assert.match(out, /واتساب: 2/);
    assert.match(out, /مكالمات: 1/);
    assert.match(out, /الإجمالي: 4/);
  });

  await t.test("compares against yesterday so a number has a direction", () => {
    assert.match(dailyDigest(leads, contacts, NOW), /أمس: 2/);
  });

  await t.test("reports the waiting queue and the longest wait", () => {
    const out = dailyDigest(leads, contacts, NOW);
    assert.match(out, /بانتظار الرد: طلب واحد/);
    assert.match(out, /منتظر منذ/);
  });

  await t.test("names the overdue threshold in hours, not as a bare day", () => {
    const stale = [{ created_at: "2026-09-10T06:00:00Z", status: "new" }];
    const out = dailyDigest(stale, [], NOW);
    assert.match(out, /بلا رد منذ أكثر من 24 ساعة/);
  });

  await t.test("says so plainly when nothing is waiting", () => {
    const answered = [
      { created_at: "2026-09-17T06:00:00Z", status: "closed", answered_at: "2026-09-17T07:00:00Z" },
    ];
    assert.match(dailyDigest(answered, contacts, NOW), /بانتظار الرد: لا شيء/);
  });

  await t.test("withholds a median reply time on a thin sample", () => {
    assert.doesNotMatch(dailyDigest(leads, contacts, NOW), /وسيط زمن الرد/);
  });

  await t.test("states a median once enough replies exist", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      created_at: `2026-09-1${i}T06:00:00Z`,
      status: "contacted",
      answered_at: `2026-09-1${i}T08:00:00Z`,
    }));
    assert.match(dailyDigest(many, contacts, NOW), /وسيط زمن الرد: ساعتين/);
  });

  await t.test("names the page that produced the most taps today", () => {
    const out = dailyDigest(leads, contacts, NOW);
    assert.match(out, /غرف تبريد الدمام \(2\)/);
  });

  await t.test("a silent day still produces a readable message, not an empty one", () => {
    const out = dailyDigest([], [], NOW);
    assert.match(out, /الإجمالي: 0 \(أمس: 0\)/);
    assert.match(out, /بانتظار الرد: لا شيء/);
    assert.doesNotMatch(out, /أكثر صفحة/);
  });

  await t.test("survives null inputs the way a route hands them over on a cold table", () => {
    assert.match(dailyDigest(null, null, NOW), /الإجمالي: 0/);
  });

  await t.test("stays plain text — it has to survive being pasted into WhatsApp", () => {
    const out = dailyDigest(leads, contacts, NOW);
    assert.doesNotMatch(out, /[<>]/);
  });
});

test("digestStamp", async (t) => {
  await t.test("stamps Riyadh wall-clock time, not UTC", () => {
    assert.equal(digestStamp(NOW), "13:00 بتوقيت الرياض");
  });

  await t.test("pads single-digit hours and minutes", () => {
    assert.equal(digestStamp(new Date("2026-09-17T02:05:00Z")), "05:05 بتوقيت الرياض");
  });
});
