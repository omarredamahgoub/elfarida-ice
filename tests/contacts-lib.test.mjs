import test from "node:test";
import assert from "node:assert/strict";

import {
  CHANNELS,
  channelLabel,
  locationLabel,
  isValidChannel,
  matchesContactQuery,
  matchesChannel,
  channelBreakdown,
  topPages,
  mergeTimeline,
  deviceHint,
} from "../functions/admin/_contacts-lib.js";

test("channel vocabulary", async (t) => {
  await t.test("only whatsapp and phone are accepted", () => {
    assert.deepEqual(CHANNELS, ["whatsapp", "phone"]);
    assert.equal(isValidChannel("whatsapp"), true);
    assert.equal(isValidChannel("phone"), true);
    assert.equal(isValidChannel("telegram"), false);
    assert.equal(isValidChannel(""), false);
    assert.equal(isValidChannel(undefined), false);
  });

  await t.test("labels fall back to the raw value rather than throwing", () => {
    assert.equal(channelLabel("whatsapp"), "واتساب");
    assert.equal(channelLabel("phone"), "مكالمة");
    assert.equal(channelLabel("carrier-pigeon"), "carrier-pigeon");
    assert.equal(channelLabel(null), "");
  });

  await t.test("location labels are translated, unknown ones pass through", () => {
    assert.equal(locationLabel("dock"), "الزر العائم");
    assert.equal(locationLabel("calculator-result"), "نتيجة الحاسبة");
    assert.equal(locationLabel("somewhere-new"), "somewhere-new");
    assert.equal(locationLabel(undefined), "");
  });
});

test("matchesContactQuery", async (t) => {
  const row = {
    ref: "EFI-7K3M",
    page: "/assets/articles/bitzer-maintenance-ar.html",
    page_title: "صيانة كمبروسر بيتزر",
    context: "12.4 kW / 3.53 RT / 72.0 م³",
    location: "dock",
    channel: "whatsapp",
  };

  await t.test("an empty query matches everything", () => {
    assert.equal(matchesContactQuery(row, ""), true);
    assert.equal(matchesContactQuery(row, "   "), true);
    assert.equal(matchesContactQuery(row, null), true);
  });

  await t.test("finds a row by its reference code, case-insensitively", () => {
    assert.equal(matchesContactQuery(row, "EFI-7K3M"), true);
    assert.equal(matchesContactQuery(row, "efi-7k3m"), true);
    assert.equal(matchesContactQuery(row, "7K3M"), true);
  });

  await t.test("searches page, title and context too", () => {
    assert.equal(matchesContactQuery(row, "bitzer"), true);
    assert.equal(matchesContactQuery(row, "بيتزر"), true);
    assert.equal(matchesContactQuery(row, "12.4 kW"), true);
  });

  await t.test("rejects a non-match", () => {
    assert.equal(matchesContactQuery(row, "EFI-ZZZZ"), false);
    assert.equal(matchesContactQuery(row, "danfoss"), false);
  });

  await t.test("tolerates missing fields", () => {
    assert.equal(matchesContactQuery({}, "anything"), false);
    assert.equal(matchesContactQuery({}, ""), true);
  });
});

test("matchesChannel", () => {
  assert.equal(matchesChannel({ channel: "whatsapp" }, ""), true);
  assert.equal(matchesChannel({ channel: "whatsapp" }, "whatsapp"), true);
  assert.equal(matchesChannel({ channel: "whatsapp" }, "phone"), false);
  assert.equal(matchesChannel({}, "phone"), false);
});

test("channelBreakdown", async (t) => {
  await t.test("counts each channel and the overall total", () => {
    const rows = [
      { channel: "whatsapp" },
      { channel: "whatsapp" },
      { channel: "phone" },
    ];
    assert.deepEqual(channelBreakdown(rows), { whatsapp: 2, phone: 1, total: 3 });
  });

  await t.test("an unknown channel still counts toward the total", () => {
    const rows = [{ channel: "whatsapp" }, { channel: "smoke-signal" }];
    const out = channelBreakdown(rows);
    assert.equal(out.total, 2);
    assert.equal(out.whatsapp, 1);
    assert.equal(out.phone, 0);
  });

  await t.test("handles empty and missing input", () => {
    assert.deepEqual(channelBreakdown([]), { whatsapp: 0, phone: 0, total: 0 });
    assert.deepEqual(channelBreakdown(null), { whatsapp: 0, phone: 0, total: 0 });
  });
});

test("topPages", async (t) => {
  const rows = [
    { page: "/a.html", page_title: "A" },
    { page: "/a.html", page_title: "A" },
    { page: "/b.html", page_title: "B" },
    { page: "", page_title: "blank is skipped" },
  ];

  await t.test("ranks pages by tap count, most first", () => {
    const out = topPages(rows);
    assert.equal(out[0].page, "/a.html");
    assert.equal(out[0].count, 2);
    assert.equal(out[1].page, "/b.html");
  });

  await t.test("skips rows with no page", () => {
    assert.equal(topPages(rows).length, 2);
  });

  await t.test("respects the limit", () => {
    assert.equal(topPages(rows, 1).length, 1);
    assert.equal(topPages(rows, 0).length, 0);
  });

  await t.test("recovers a title from a later row that has one", () => {
    const out = topPages([
      { page: "/c.html", page_title: "" },
      { page: "/c.html", page_title: "C" },
    ]);
    assert.equal(out[0].title, "C");
  });

  await t.test("handles empty input", () => {
    assert.deepEqual(topPages([]), []);
    assert.deepEqual(topPages(null), []);
  });
});

test("mergeTimeline", async (t) => {
  const leads = [{ created_at: "2026-09-10T10:00:00.000Z", name: "عميل", subject: "عرض سعر" }];
  const events = [
    { created_at: "2026-09-10T11:00:00.000Z", channel: "whatsapp", ref: "EFI-AAAA", page: "/x" },
    { created_at: "2026-09-10T09:00:00.000Z", channel: "phone", ref: "EFI-BBBB", page: "/y" },
  ];

  await t.test("returns one list, newest first", () => {
    const out = mergeTimeline(leads, events);
    assert.equal(out.length, 3);
    assert.equal(out[0].ref, "EFI-AAAA");
    assert.equal(out[1].kind, "lead");
    assert.equal(out[2].ref, "EFI-BBBB");
  });

  await t.test("tags each entry with its kind and channel", () => {
    const out = mergeTimeline(leads, events);
    assert.equal(out[1].kind, "lead");
    assert.equal(out[1].channel, "form");
    assert.equal(out[0].kind, "event");
    assert.equal(out[0].channel, "whatsapp");
  });

  await t.test("an unparseable date sorts last rather than throwing", () => {
    const out = mergeTimeline([], [{ created_at: "not a date", channel: "phone" }, ...events]);
    assert.equal(out.length, 3);
    assert.equal(out[out.length - 1].created_at, "not a date");
  });

  await t.test("handles empty inputs", () => {
    assert.deepEqual(mergeTimeline([], []), []);
    assert.deepEqual(mergeTimeline(null, null), []);
  });
});

test("deviceHint", () => {
  assert.equal(deviceHint("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)"), "جوال");
  assert.equal(deviceHint("Mozilla/5.0 (Linux; Android 14; SM-S911B)"), "جوال");
  assert.equal(deviceHint("Mozilla/5.0 (iPad; CPU OS 17_0)"), "جهاز لوحي");
  assert.equal(deviceHint("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "كمبيوتر");
  assert.equal(deviceHint(""), "");
  assert.equal(deviceHint(null), "");
});
