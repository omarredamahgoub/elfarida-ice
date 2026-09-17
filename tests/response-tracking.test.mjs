import test from "node:test";
import assert from "node:assert/strict";

import {
  SLA_HOURS,
  MIN_RESPONSE_SAMPLE,
  isAnswered,
  hoursBetween,
  pendingLeads,
  median,
  responseStats,
  arabicCount,
  waitLabel,
  hoursLabel,
  repliesLabel,
  peopleLabel,
  tapsLabel,
  requestsLabel,
  tapConversion,
} from "../functions/admin/_overview-lib.js";

const NOW = new Date("2026-09-17T12:00:00Z");
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600000).toISOString();

test("isAnswered", async (t) => {
  await t.test("a new lead with no timestamp is not answered", () => {
    assert.equal(isAnswered({ status: "new" }), false);
  });

  await t.test("any status other than new counts as answered", () => {
    assert.equal(isAnswered({ status: "contacted" }), true);
    assert.equal(isAnswered({ status: "closed" }), true);
  });

  await t.test("a missing status is treated as new, not as answered", () => {
    assert.equal(isAnswered({}), false);
    assert.equal(isAnswered({ status: "" }), false);
  });

  await t.test("a timestamp answers the lead even if the status lags behind", () => {
    assert.equal(isAnswered({ status: "new", answered_at: hoursAgo(1) }), true);
  });

  await t.test("a null row is not answered rather than a crash", () => {
    assert.equal(isAnswered(null), false);
  });
});

test("hoursBetween", async (t) => {
  await t.test("counts whole and fractional hours", () => {
    assert.equal(hoursBetween(hoursAgo(5), NOW), 5);
    assert.equal(hoursBetween(hoursAgo(0.5), NOW), 0.5);
  });

  await t.test("returns null rather than a negative wait for a future row", () => {
    const future = new Date(NOW.getTime() + 3600000).toISOString();
    assert.equal(hoursBetween(future, NOW), null);
  });

  await t.test("returns null for unparsable input", () => {
    assert.equal(hoursBetween("not a date", NOW), null);
    assert.equal(hoursBetween(null, NOW), null);
  });

  await t.test("accepts an ISO string as the end instant", () => {
    assert.equal(hoursBetween(hoursAgo(3), hoursAgo(1)), 2);
  });
});

test("pendingLeads", async (t) => {
  const rows = [
    { id: "a", status: "new", created_at: hoursAgo(2) },
    { id: "b", status: "new", created_at: hoursAgo(50) },
    { id: "c", status: "contacted", created_at: hoursAgo(90) },
    { id: "d", status: "new", created_at: hoursAgo(26) },
  ];

  await t.test("keeps only unanswered rows", () => {
    assert.deepEqual(
      pendingLeads(rows, NOW).map((r) => r.id),
      ["b", "d", "a"]
    );
  });

  await t.test("longest wait comes first — it is a work queue, not a log", () => {
    const [first] = pendingLeads(rows, NOW);
    assert.equal(first.id, "b");
    assert.equal(first.waitedHours, 50);
  });

  await t.test("drops rows with an unusable timestamp instead of ranking them", () => {
    const out = pendingLeads([{ id: "x", status: "new", created_at: "??" }], NOW);
    assert.equal(out.length, 0);
  });

  await t.test("an empty input is an empty queue", () => {
    assert.deepEqual(pendingLeads([], NOW), []);
    assert.deepEqual(pendingLeads(null, NOW), []);
  });
});

test("median", async (t) => {
  await t.test("odd length takes the middle value", () => {
    assert.equal(median([5, 1, 3]), 3);
  });

  await t.test("even length averages the middle pair", () => {
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });

  await t.test("null for an empty list, never 0", () => {
    assert.equal(median([]), null);
    assert.equal(median(null), null);
  });

  await t.test("ignores non-numeric entries", () => {
    assert.equal(median([1, null, 3, undefined]), 2);
  });

  await t.test("one late outlier does not move it the way a mean would", () => {
    const values = [1, 1, 2, 2, 400];
    assert.equal(median(values), 2);
  });
});

test("responseStats", async (t) => {
  const rows = [
    { id: "a", status: "new", created_at: hoursAgo(2) },
    { id: "b", status: "new", created_at: hoursAgo(50) },
    { id: "c", status: "contacted", created_at: hoursAgo(90), answered_at: hoursAgo(88) },
    { id: "d", status: "closed", created_at: hoursAgo(80), answered_at: hoursAgo(20) },
  ];

  await t.test("counts what is waiting and what is late", () => {
    const s = responseStats(rows, NOW);
    assert.equal(s.total, 4);
    assert.equal(s.pending, 2);
    assert.equal(s.overdue, 1);
    assert.equal(s.oldest.id, "b");
  });

  await t.test("overdue uses the configured threshold", () => {
    assert.equal(responseStats(rows, NOW, 100).overdue, 0);
    assert.equal(responseStats(rows, NOW, 1).overdue, 2);
  });

  await t.test("a median is withheld below the minimum sample", () => {
    const s = responseStats(rows, NOW);
    assert.equal(s.answered, 2);
    assert.ok(s.answered < MIN_RESPONSE_SAMPLE);
    assert.equal(s.median, null);
  });

  await t.test("a median appears once enough replies exist", () => {
    const many = Array.from({ length: MIN_RESPONSE_SAMPLE }, (_, i) => ({
      id: `m${i}`,
      status: "contacted",
      created_at: hoursAgo(100),
      answered_at: hoursAgo(96),
    }));
    const s = responseStats(many, NOW);
    assert.equal(s.answered, MIN_RESPONSE_SAMPLE);
    assert.equal(s.median, 4);
    assert.equal(s.slaPct, 100);
  });

  await t.test("the SLA percentage counts replies, not open requests", () => {
    const s = responseStats(rows, NOW);
    // c answered in 2h (within), d in 60h (outside) → 1 of 2.
    assert.equal(s.withinSla, 1);
    assert.equal(s.slaPct, 50);
  });

  await t.test("no replies yet means no percentage rather than 0%", () => {
    const s = responseStats([{ status: "new", created_at: hoursAgo(1) }], NOW);
    assert.equal(s.slaPct, null);
    assert.equal(s.median, null);
  });

  await t.test("reports the threshold it used, so the caller cannot mislabel it", () => {
    assert.equal(responseStats([], NOW).slaHours, SLA_HOURS);
  });
});

test("arabicCount", async (t) => {
  const forms = { one: "ساعة", two: "ساعتين", few: "ساعات", many: "ساعة" };

  await t.test("one and two carry no numeral", () => {
    assert.equal(arabicCount(1, forms), "ساعة");
    assert.equal(arabicCount(2, forms), "ساعتين");
  });

  await t.test("three to ten take the broken plural", () => {
    assert.equal(arabicCount(3, forms), "3 ساعات");
    assert.equal(arabicCount(10, forms), "10 ساعات");
  });

  await t.test("eleven and above return to the singular", () => {
    assert.equal(arabicCount(11, forms), "11 ساعة");
    assert.equal(arabicCount(40, forms), "40 ساعة");
  });
});

test("waitLabel", async (t) => {
  await t.test("under an hour reads in minutes", () => {
    assert.equal(waitLabel(0.5), "30 دقيقة");
    assert.equal(waitLabel(0.05), "3 دقائق");
  });

  await t.test("a sub-minute wait still reads as one minute, never zero", () => {
    assert.equal(waitLabel(0.001), "دقيقة");
  });

  await t.test("under a day reads in hours", () => {
    assert.equal(waitLabel(1), "ساعة");
    assert.equal(waitLabel(2), "ساعتين");
    assert.equal(waitLabel(5), "5 ساعات");
    assert.equal(waitLabel(23), "23 ساعة");
  });

  await t.test("a day and over reads in days", () => {
    assert.equal(waitLabel(24), "يوم");
    assert.equal(waitLabel(49), "يومين");
    assert.equal(waitLabel(72), "3 أيام");
  });

  await t.test("nothing to say for an unusable value", () => {
    assert.equal(waitLabel(null), "");
    assert.equal(waitLabel(Number.NaN), "");
  });
});

test("counted-noun labels", async (t) => {
  await t.test("a threshold stays in hours where waitLabel would say a day", () => {
    assert.equal(waitLabel(SLA_HOURS), "يوم");
    assert.equal(hoursLabel(SLA_HOURS), "24 ساعة");
  });

  await t.test("replies inflect across all four ranges", () => {
    assert.equal(repliesLabel(1), "ردّ واحد");
    assert.equal(repliesLabel(2), "ردّان");
    assert.equal(repliesLabel(7), "7 ردود");
    assert.equal(repliesLabel(19), "19 رداً");
  });

  await t.test("people inflect across all four ranges", () => {
    assert.equal(peopleLabel(1), "شخص واحد");
    assert.equal(peopleLabel(2), "شخصان");
    assert.equal(peopleLabel(5), "5 أشخاص");
    assert.equal(peopleLabel(12), "12 شخصاً");
  });

  await t.test("taps inflect across all four ranges", () => {
    assert.equal(tapsLabel(1), "ضغطة واحدة");
    assert.equal(tapsLabel(2), "ضغطتان");
    assert.equal(tapsLabel(4), "4 ضغطات");
    assert.equal(tapsLabel(40), "40 ضغطة");
  });

  await t.test("requests inflect across all four ranges", () => {
    assert.equal(requestsLabel(1), "طلب واحد");
    assert.equal(requestsLabel(2), "طلبان");
    assert.equal(requestsLabel(6), "6 طلبات");
    assert.equal(requestsLabel(30), "30 طلباً");
  });

  await t.test("zero takes the same form as a large count, never a singular", () => {
    assert.equal(repliesLabel(0), "0 رداً");
    assert.equal(requestsLabel(0), "0 طلباً");
  });
});

test("tapConversion", async (t) => {
  const events = [
    { ref: "EFI-7K3M" },
    { ref: "EFI-7K3M" },
    { ref: "EFI-ABCD" },
    { ref: "" },
    { ref: null },
  ];

  await t.test("counts distinct taps, not tap events", () => {
    const c = tapConversion([], events);
    assert.equal(c.taps, 2);
  });

  await t.test("a shared reference is a conversion", () => {
    const c = tapConversion([{ ref: "EFI-7K3M" }], events);
    assert.equal(c.converted, 1);
    assert.equal(c.pct, 50);
  });

  await t.test("a form with no matching tap is not counted against the taps", () => {
    const c = tapConversion([{ ref: "EFI-ZZZZ" }], events);
    assert.equal(c.taps, 2);
    assert.equal(c.converted, 0);
    assert.equal(c.pct, 0);
  });

  await t.test("matching ignores case and punctuation in the stored code", () => {
    const c = tapConversion([{ ref: "efi7k3m" }], events);
    assert.equal(c.converted, 1);
  });

  await t.test("no taps means no percentage rather than 0%", () => {
    const c = tapConversion([{ ref: "EFI-7K3M" }], []);
    assert.equal(c.taps, 0);
    assert.equal(c.pct, null);
  });
});
