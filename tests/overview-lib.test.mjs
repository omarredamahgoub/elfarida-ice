import test from "node:test";
import assert from "node:assert/strict";

import {
  RIYADH_OFFSET_MS,
  WEEKDAY_LABELS_AR,
  riyadhDate,
  dayKey,
  hourOf,
  weekdayOf,
  shortDayLabel,
  dailySeries,
  combinedSeries,
  windowCounts,
  deltaPct,
  hourHistogram,
  weekdayHistogram,
  busiest,
  hourRangeLabel,
  normalizeRef,
  findByRef,
  shareOf,
} from "../functions/admin/_overview-lib.js";

const at = (iso) => ({ created_at: iso });

test("Riyadh bucketing", async (t) => {
  await t.test("the offset is a fixed UTC+3 with no daylight saving", () => {
    assert.equal(RIYADH_OFFSET_MS, 3 * 60 * 60 * 1000);
  });

  await t.test("a late-evening Riyadh tap stays on its own calendar day", () => {
    // 22:30 Riyadh on the 14th is 19:30 UTC on the 14th.
    assert.equal(dayKey("2026-09-14T19:30:00Z"), "2026-09-14");
    assert.equal(hourOf("2026-09-14T19:30:00Z"), 22);
  });

  await t.test("a tap just after Riyadh midnight rolls to the next day", () => {
    // 00:30 Riyadh on the 15th is 21:30 UTC on the 14th — the case UTC bucketing gets wrong.
    assert.equal(dayKey("2026-09-14T21:30:00Z"), "2026-09-15");
    assert.equal(hourOf("2026-09-14T21:30:00Z"), 0);
  });

  await t.test("weekday is Riyadh-local and Sunday-indexed", () => {
    // 2026-09-13 is a Sunday.
    assert.equal(weekdayOf("2026-09-13T09:00:00Z"), 0);
    assert.equal(WEEKDAY_LABELS_AR[0], "الأحد");
    assert.equal(WEEKDAY_LABELS_AR.length, 7);
  });

  await t.test("unparsable and missing input yields null rather than throwing", () => {
    assert.equal(riyadhDate("not a date"), null);
    assert.equal(dayKey(undefined), null);
    assert.equal(hourOf(null), null);
    assert.equal(weekdayOf(""), null);
  });

  await t.test("accepts a Date as well as a string", () => {
    assert.equal(dayKey(new Date("2026-09-14T19:30:00Z")), "2026-09-14");
  });
});

test("shortDayLabel", () => {
  assert.equal(shortDayLabel("2026-09-14"), "09-14");
  assert.equal(shortDayLabel("bad"), "");
  assert.equal(shortDayLabel(null), "");
});

test("dailySeries", async (t) => {
  const now = new Date("2026-09-16T10:00:00Z");

  await t.test("returns one bucket per day, oldest first, ending today", () => {
    const s = dailySeries([], 7, now);
    assert.equal(s.length, 7);
    assert.equal(s[0].key, "2026-09-10");
    assert.equal(s[6].key, "2026-09-16");
  });

  await t.test("days with no activity are present as zero, not skipped", () => {
    const s = dailySeries([at("2026-09-16T08:00:00Z"), at("2026-09-14T08:00:00Z")], 4, now);
    assert.deepEqual(
      s.map((d) => d.count),
      [0, 1, 0, 1]
    );
  });

  await t.test("rows outside the window are ignored", () => {
    const s = dailySeries([at("2026-01-01T08:00:00Z")], 3, now);
    assert.equal(
      s.reduce((n, d) => n + d.count, 0),
      0
    );
  });

  await t.test("malformed rows never break the series", () => {
    const s = dailySeries([{}, null, at("nonsense"), at("2026-09-16T08:00:00Z")], 2, now);
    assert.equal(s[1].count, 1);
  });

  await t.test("empty or invalid inputs yield an empty series", () => {
    assert.deepEqual(dailySeries(null, 0, now), []);
    assert.deepEqual(dailySeries([], -3, now), []);
  });
});

test("combinedSeries", async (t) => {
  const now = new Date("2026-09-16T10:00:00Z");

  await t.test("aligns the three streams on the same days and totals them", () => {
    const s = combinedSeries(
      {
        quotes: [at("2026-09-16T06:00:00Z")],
        whatsapp: [at("2026-09-16T07:00:00Z"), at("2026-09-15T07:00:00Z")],
        phone: [at("2026-09-15T08:00:00Z")],
      },
      2,
      now
    );
    assert.equal(s.length, 2);
    assert.deepEqual(s[0], { key: "2026-09-15", quotes: 0, whatsapp: 1, phone: 1, total: 2 });
    assert.deepEqual(s[1], { key: "2026-09-16", quotes: 1, whatsapp: 1, phone: 0, total: 2 });
  });

  await t.test("a missing stream is treated as empty", () => {
    const s = combinedSeries({ quotes: [at("2026-09-16T06:00:00Z")] }, 1, now);
    assert.deepEqual(s[0], { key: "2026-09-16", quotes: 1, whatsapp: 0, phone: 0, total: 1 });
  });

  await t.test("no streams at all still produces the day grid", () => {
    assert.equal(combinedSeries(undefined, 3, now).length, 3);
  });
});

test("windowCounts", async (t) => {
  const now = new Date("2026-09-16T10:00:00Z");
  const rows = [
    at("2026-09-16T09:00:00Z"), // today
    at("2026-09-16T05:00:00Z"), // today
    at("2026-09-13T09:00:00Z"), // within 7d
    at("2026-09-06T09:00:00Z"), // within 14d, not 7d
    at("2026-07-20T09:00:00Z"), // outside 30d
  ];

  await t.test("counts today, the trailing week and the trailing month", () => {
    const w = windowCounts(rows, now);
    assert.equal(w.today, 2);
    assert.equal(w.last7, 3);
    assert.equal(w.prev7, 1);
    assert.equal(w.last30, 4);
    assert.equal(w.total, 5);
  });

  await t.test("the trend compares this week against the one before it", () => {
    assert.equal(windowCounts(rows, now).trend, 200);
  });

  await t.test("empty input is all zeroes with no trend", () => {
    const w = windowCounts([], now);
    assert.equal(w.today, 0);
    assert.equal(w.total, 0);
    assert.equal(w.trend, null);
  });

  await t.test("missing rows argument is treated as empty", () => {
    assert.equal(windowCounts(undefined, now).total, 0);
  });
});

test("deltaPct", async (t) => {
  await t.test("computes a rounded percentage change", () => {
    assert.equal(deltaPct(12, 10), 20);
    assert.equal(deltaPct(5, 10), -50);
  });

  await t.test("no baseline yields null rather than a misleading number", () => {
    assert.equal(deltaPct(7, 0), null);
    assert.equal(deltaPct(0, 0), null);
  });

  await t.test("non-numeric input yields null", () => {
    assert.equal(deltaPct("x", 3), null);
    assert.equal(deltaPct(3, undefined), null);
  });
});

test("hourHistogram", async (t) => {
  await t.test("always returns 24 buckets in order", () => {
    const h = hourHistogram([]);
    assert.equal(h.length, 24);
    assert.equal(h[0].hour, 0);
    assert.equal(h[23].hour, 23);
  });

  await t.test("buckets by Riyadh hour, not UTC", () => {
    const h = hourHistogram([at("2026-09-14T19:30:00Z")]);
    assert.equal(h[22].count, 1);
    assert.equal(h[19].count, 0);
  });

  await t.test("unparsable timestamps are ignored", () => {
    const h = hourHistogram([at("nope"), {}, null]);
    assert.equal(
      h.reduce((n, b) => n + b.count, 0),
      0
    );
  });
});

test("weekdayHistogram", async (t) => {
  await t.test("always returns 7 labelled buckets starting Sunday", () => {
    const w = weekdayHistogram([]);
    assert.equal(w.length, 7);
    assert.equal(w[0].label, "الأحد");
    assert.equal(w[5].label, "الجمعة");
  });

  await t.test("counts land on the Riyadh weekday", () => {
    const w = weekdayHistogram([at("2026-09-13T09:00:00Z")]);
    assert.equal(w[0].count, 1);
  });
});

test("busiest", async (t) => {
  await t.test("returns the bucket with the highest count", () => {
    const b = busiest([
      { hour: 9, count: 3 },
      { hour: 16, count: 11 },
      { hour: 20, count: 5 },
    ]);
    assert.equal(b.hour, 16);
  });

  await t.test("ties resolve to the earliest bucket so the peak stays stable", () => {
    const b = busiest([
      { hour: 9, count: 4 },
      { hour: 16, count: 4 },
    ]);
    assert.equal(b.hour, 9);
  });

  await t.test("all-zero or empty input yields null", () => {
    assert.equal(busiest([{ hour: 1, count: 0 }]), null);
    assert.equal(busiest([]), null);
    assert.equal(busiest(undefined), null);
  });
});

test("hourRangeLabel", async (t) => {
  await t.test("reads as a range in Arabic", () => {
    assert.equal(hourRangeLabel(16), "4–5 مساءً");
    assert.equal(hourRangeLabel(9), "9–10 صباحاً");
  });

  await t.test("crossing noon or midnight names both periods", () => {
    assert.equal(hourRangeLabel(11), "11 صباحاً – 12 مساءً");
    assert.equal(hourRangeLabel(23), "11 مساءً – 12 صباحاً");
  });

  await t.test("non-numeric input yields an empty label", () => {
    assert.equal(hourRangeLabel(null), "");
  });
});

test("normalizeRef", async (t) => {
  await t.test("accepts the code with or without its prefix, in any case", () => {
    assert.equal(normalizeRef("EFI-7K3M"), "EFI-7K3M");
    assert.equal(normalizeRef("efi-7k3m"), "EFI-7K3M");
    assert.equal(normalizeRef("7k3m"), "EFI-7K3M");
  });

  await t.test("strips the punctuation a pasted WhatsApp message carries", () => {
    assert.equal(normalizeRef("  (EFI-7K3M)  "), "EFI-7K3M");
    assert.equal(normalizeRef("رقم المرجع: EFI 7K3M."), "EFI-7K3M");
  });

  await t.test("empty and non-string input yields an empty string", () => {
    assert.equal(normalizeRef(""), "");
    assert.equal(normalizeRef(null), "");
    assert.equal(normalizeRef("---"), "");
  });
});

test("findByRef", async (t) => {
  const rows = [
    { ref: "EFI-7K3M", created_at: "2026-09-14T09:00:00Z", page: "/a" },
    { ref: "efi-7k3m", created_at: "2026-09-15T09:00:00Z", page: "/b" },
    { ref: "EFI-ZZZZ", created_at: "2026-09-15T10:00:00Z", page: "/c" },
  ];

  await t.test("matches regardless of the case stored or typed", () => {
    assert.equal(findByRef(rows, "7k3m").length, 2);
  });

  await t.test("returns newest first so the latest tap reads first", () => {
    assert.equal(findByRef(rows, "EFI-7K3M")[0].page, "/b");
  });

  await t.test("an unknown or empty code returns nothing", () => {
    assert.deepEqual(findByRef(rows, "EFI-0000"), []);
    assert.deepEqual(findByRef(rows, ""), []);
    assert.deepEqual(findByRef(undefined, "7K3M"), []);
  });
});

test("shareOf", async (t) => {
  await t.test("percentages always sum to exactly 100", () => {
    const s = shareOf({ quotes: 1, whatsapp: 1, phone: 1 });
    assert.equal(
      s.reduce((n, r) => n + r.pct, 0),
      100
    );
  });

  await t.test("the rounding remainder lands on the largest share", () => {
    const s = shareOf({ quotes: 1, whatsapp: 1, phone: 4 });
    const phone = s.find((r) => r.key === "phone");
    assert.equal(phone.pct, 68);
    assert.equal(
      s.reduce((n, r) => n + r.pct, 0),
      100
    );
  });

  await t.test("an all-zero window yields zero shares, not NaN", () => {
    const s = shareOf({ quotes: 0, whatsapp: 0, phone: 0 });
    assert.deepEqual(
      s.map((r) => r.pct),
      [0, 0, 0]
    );
  });

  await t.test("missing input yields an empty list", () => {
    assert.deepEqual(shareOf(undefined), []);
  });
});
