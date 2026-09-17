import test from "node:test";
import assert from "node:assert/strict";

import {
  RIYADH_OFFSET_MS,
  WEEKDAY_LABELS_AR,
  WEEKDAY_SHORT_AR,
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
  WINDOW_OPTIONS,
  DEFAULT_WINDOW,
  normalizeWindow,
  peakClaim,
  breakdownBy,
  uniqueCount,
  repeatRatio,
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
    assert.equal(w.window, 4);
    assert.equal(w.total, 5);
  });

  await t.test("the window count follows the selected period", () => {
    // The July row sits 58 days back: inside 90 days, outside 30 and 7.
    assert.equal(windowCounts(rows, now, 7).window, 3);
    assert.equal(windowCounts(rows, now, 30).window, 4);
    assert.equal(windowCounts(rows, now, 90).window, 5);
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

  await t.test("carries an axis-length short name for every bucket", () => {
    const w = weekdayHistogram([]);
    assert.equal(w.length, WEEKDAY_SHORT_AR.length);
    for (const b of w) {
      assert.equal(b.short, WEEKDAY_SHORT_AR[b.weekday]);
      assert.ok(b.short.length < b.label.length);
      assert.ok(b.label.endsWith(b.short.slice(-2)));
    }
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

test("normalizeWindow", async (t) => {
  await t.test("accepts only the windows we offer", () => {
    assert.equal(normalizeWindow("7"), 7);
    assert.equal(normalizeWindow(90), 90);
    assert.deepEqual(WINDOW_OPTIONS, [7, 30, 90]);
  });

  await t.test("anything else falls back to the default", () => {
    assert.equal(normalizeWindow("365"), DEFAULT_WINDOW);
    assert.equal(normalizeWindow("abc"), DEFAULT_WINDOW);
    assert.equal(normalizeWindow(null), DEFAULT_WINDOW);
    assert.equal(normalizeWindow("7; DROP TABLE leads"), 7);
  });
});

test("peakClaim", async (t) => {
  const spread = (counts) => counts.map((count, hour) => ({ hour, count }));

  await t.test("refuses to name a peak from a thin sample", () => {
    // 23 taps over 24 buckets: the winner holds two events, which is chance.
    const thin = spread([2, 1, 1, 0, 1, 2, 1, 0, 1, 2, 1, 1, 0, 1, 2, 1, 1, 0, 1, 1, 1, 1, 1, 0]);
    const claim = peakClaim(thin);
    assert.equal(claim.reliable, false);
    assert.equal(claim.total, 23);
    assert.ok(claim.top, "the busiest bucket is still returned for display");
  });

  await t.test("names a peak once the sample can carry it", () => {
    const solid = spread([1, 1, 1, 1, 2, 2, 3, 4, 9, 6, 3, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const claim = peakClaim(solid);
    assert.equal(claim.reliable, true);
    assert.equal(claim.top.hour, 8);
  });

  await t.test("a flat distribution is not a peak however large the total", () => {
    // 44 events but the winning bucket holds only two: nothing stands out.
    const flat = Array.from({ length: 24 }, (_, hour) => ({ hour, count: hour < 20 ? 2 : 1 }));
    const claim = peakClaim(flat);
    assert.equal(claim.total, 44);
    assert.equal(claim.reliable, false);
  });

  await t.test("empty input reports no peak and no total", () => {
    const claim = peakClaim([]);
    assert.equal(claim.top, null);
    assert.equal(claim.total, 0);
    assert.equal(claim.reliable, false);
  });

  await t.test("thresholds are overridable for smaller bucket sets", () => {
    const week = [
      { weekday: 0, count: 4 },
      { weekday: 1, count: 1 },
    ];
    assert.equal(peakClaim(week).reliable, false);
    assert.equal(peakClaim(week, 5, 3).reliable, true);
  });
});

test("breakdownBy", async (t) => {
  const rows = [
    { location: "dock" },
    { location: "dock" },
    { location: "header" },
    { location: "" },
    { location: null },
    {},
  ];

  await t.test("counts by field, largest first", () => {
    const b = breakdownBy(rows, "location");
    assert.deepEqual(
      b.map((x) => x.count),
      [3, 2, 1]
    );
    assert.equal(b.find((x) => x.key === "dock").count, 2);
    assert.equal(b.find((x) => x.key === "header").count, 1);
  });

  await t.test("empty values are grouped, not silently dropped", () => {
    const b = breakdownBy(rows, "location");
    const unknown = b.find((x) => x.key === "—");
    assert.equal(unknown.count, 3);
    assert.equal(
      b.reduce((n, x) => n + x.count, 0),
      rows.length
    );
  });

  await t.test("ties break alphabetically so the order is stable", () => {
    const b = breakdownBy([{ k: "b" }, { k: "a" }], "k");
    assert.deepEqual(
      b.map((x) => x.key),
      ["a", "b"]
    );
  });

  await t.test("respects the limit and tolerates empty input", () => {
    assert.equal(breakdownBy(rows, "location", 1).length, 1);
    assert.deepEqual(breakdownBy([], "location"), []);
    assert.deepEqual(breakdownBy(undefined, "location"), []);
  });
});

test("uniqueCount and repeatRatio", async (t) => {
  const rows = [{ ip: "1.1.1.1" }, { ip: "1.1.1.1" }, { ip: "2.2.2.2" }, { ip: "" }, {}];

  await t.test("counts distinct non-empty values", () => {
    assert.equal(uniqueCount(rows, "ip"), 2);
    assert.equal(uniqueCount([], "ip"), 0);
    assert.equal(uniqueCount(undefined, "ip"), 0);
  });

  await t.test("separates many people from one persistent person", () => {
    assert.equal(repeatRatio(rows), 2.5);
    assert.equal(repeatRatio([{ ip: "a" }, { ip: "b" }]), 1);
  });

  await t.test("no data yields null rather than a misleading 0.0", () => {
    assert.equal(repeatRatio([]), null);
    assert.equal(repeatRatio([{}, {}]), null);
  });
});
