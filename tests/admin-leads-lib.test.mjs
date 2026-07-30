// Unit tests for functions/admin/_leads-lib.js
// Run with: npm test  (uses Node's built-in test runner, no extra dependency)
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  STATUS_OPTIONS,
  DEFAULT_STATUS,
  STATUS_LABELS_AR,
  isValidStatus,
  isValidUuid,
  esc,
  isRateLimited,
  matchesQuery,
  matchesStatus,
  toRiyadhDisplay,
  isRecent,
  computeStats,
  buildTelHref,
  buildWaHref,
  buildMailtoHref,
  DEFAULT_PAGE_SIZE,
  paginate,
  SORT_FIELDS,
  DEFAULT_SORT_FIELD,
  DEFAULT_SORT_DIR,
  isValidSortField,
  isValidSortDir,
  sortRows,
  toggleSortDir,
  markDuplicates,
  isValidNewPassword,
  buildQueryString,
} from "../functions/admin/_leads-lib.js";

describe("STATUS_OPTIONS / STATUS_LABELS_AR", () => {
  test("has exactly the three expected statuses", () => {
    assert.deepEqual(STATUS_OPTIONS, ["new", "contacted", "closed"]);
  });

  test("DEFAULT_STATUS is one of STATUS_OPTIONS", () => {
    assert.ok(STATUS_OPTIONS.includes(DEFAULT_STATUS));
  });

  test("every status option has an Arabic label", () => {
    for (const s of STATUS_OPTIONS) {
      assert.equal(typeof STATUS_LABELS_AR[s], "string");
      assert.ok(STATUS_LABELS_AR[s].length > 0);
    }
  });
});

describe("isValidStatus", () => {
  test("accepts each known status", () => {
    for (const s of STATUS_OPTIONS) assert.equal(isValidStatus(s), true);
  });
  test("rejects unknown strings", () => {
    assert.equal(isValidStatus("archived"), false);
    assert.equal(isValidStatus(""), false);
  });
  test("rejects non-string / nullish input", () => {
    assert.equal(isValidStatus(null), false);
    assert.equal(isValidStatus(undefined), false);
    assert.equal(isValidStatus(42), false);
  });
});

describe("isValidUuid", () => {
  test("accepts a well-formed v4 uuid (lower and upper case)", () => {
    assert.equal(isValidUuid("3fa85f64-5717-4562-b3fc-2c963f66afa6"), true);
    assert.equal(isValidUuid("3FA85F64-5717-4562-B3FC-2C963F66AFA6"), true);
  });
  test("rejects malformed strings", () => {
    assert.equal(isValidUuid("not-a-uuid"), false);
    assert.equal(isValidUuid("3fa85f64-5717-4562-b3fc"), false);
    assert.equal(isValidUuid("3fa85f6457174562b3fc2c963f66afa6"), false);
  });
  test("rejects empty / non-string / nullish input", () => {
    assert.equal(isValidUuid(""), false);
    assert.equal(isValidUuid(null), false);
    assert.equal(isValidUuid(undefined), false);
    assert.equal(isValidUuid(12345), false);
  });
});

describe("esc", () => {
  test("escapes the five HTML-sensitive characters", () => {
    assert.equal(esc(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;'&lt;/a&gt;");
  });
  test("treats null/undefined as an empty string", () => {
    assert.equal(esc(null), "");
    assert.equal(esc(undefined), "");
  });
  test("coerces non-string values", () => {
    assert.equal(esc(42), "42");
  });
});

describe("isRateLimited", () => {
  const now = new Date("2026-07-05T12:00:00.000Z");
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 5;

  test("false when there are fewer attempts than the threshold", () => {
    const attempts = Array.from({ length: 4 }, (_, i) =>
      new Date(now.getTime() - i * 60 * 1000).toISOString()
    );
    assert.equal(isRateLimited(attempts, now, windowMs, maxAttempts), false);
  });

  test("true once attempts reach the threshold inside the window", () => {
    const attempts = Array.from({ length: 5 }, (_, i) =>
      new Date(now.getTime() - i * 60 * 1000).toISOString()
    );
    assert.equal(isRateLimited(attempts, now, windowMs, maxAttempts), true);
  });

  test("attempts outside the window are ignored", () => {
    const attempts = Array.from({ length: 10 }, (_, i) =>
      new Date(now.getTime() - (windowMs + i * 60 * 1000)).toISOString()
    );
    assert.equal(isRateLimited(attempts, now, windowMs, maxAttempts), false);
  });

  test("empty / missing attempts list is never rate limited", () => {
    assert.equal(isRateLimited([], now, windowMs, maxAttempts), false);
    assert.equal(isRateLimited(undefined, now, windowMs, maxAttempts), false);
  });

  test("malformed timestamps are ignored rather than counted", () => {
    const attempts = ["not-a-date", "also-bad", now.toISOString()];
    assert.equal(isRateLimited(attempts, now, windowMs, maxAttempts), false);
  });
});

describe("matchesQuery", () => {
  const row = {
    name: "Omar Samy",
    email: "omar@example.com",
    phone: "0511112222",
    subject: "طلب عرض سعر",
  };

  test("empty/blank query always matches", () => {
    assert.equal(matchesQuery(row, ""), true);
    assert.equal(matchesQuery(row, "   "), true);
    assert.equal(matchesQuery(row, undefined), true);
  });

  test("matches case-insensitively on name", () => {
    assert.equal(matchesQuery(row, "omar"), true);
    assert.equal(matchesQuery(row, "OMAR"), true);
  });

  test("matches on email, phone, and subject", () => {
    assert.equal(matchesQuery(row, "example.com"), true);
    assert.equal(matchesQuery(row, "0511112222"), true);
    assert.equal(matchesQuery(row, "عرض سعر"), true);
  });

  test("no match returns false", () => {
    assert.equal(matchesQuery(row, "zzz-nope"), false);
  });

  test("handles rows with missing fields without throwing", () => {
    assert.equal(matchesQuery({}, "anything"), false);
    assert.equal(matchesQuery({}, ""), true);
  });
});

describe("matchesStatus", () => {
  test("empty status filter always matches", () => {
    assert.equal(matchesStatus({ status: "closed" }, ""), true);
    assert.equal(matchesStatus({}, undefined), true);
  });
  test("row with no status is treated as DEFAULT_STATUS", () => {
    assert.equal(matchesStatus({}, DEFAULT_STATUS), true);
    assert.equal(matchesStatus({}, "closed"), false);
  });
  test("exact status match", () => {
    assert.equal(matchesStatus({ status: "contacted" }, "contacted"), true);
    assert.equal(matchesStatus({ status: "contacted" }, "closed"), false);
  });
});

describe("toRiyadhDisplay", () => {
  test("converts a UTC midnight timestamp to Riyadh time (UTC+3)", () => {
    assert.equal(toRiyadhDisplay("2026-01-01T00:00:00.000Z"), "01/01/2026 03:00");
  });

  test("rolls over to the next day near midnight", () => {
    assert.equal(toRiyadhDisplay("2026-01-01T21:30:00.000Z"), "02/01/2026 00:30");
  });

  test("returns the raw input for an unparsable timestamp", () => {
    assert.equal(toRiyadhDisplay("not-a-date"), "not-a-date");
  });

  test("returns an empty string for empty input", () => {
    assert.equal(toRiyadhDisplay(""), "");
  });
});

describe("isRecent", () => {
  const now = new Date("2026-07-05T12:00:00.000Z");

  test("true for a timestamp one hour ago (within 24h default)", () => {
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    assert.equal(isRecent(oneHourAgo, now), true);
  });

  test("false for a timestamp 25 hours ago", () => {
    const old = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
    assert.equal(isRecent(old, now), false);
  });

  test("respects a custom hours window", () => {
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    assert.equal(isRecent(twoHoursAgo, now, 1), false);
    assert.equal(isRecent(twoHoursAgo, now, 3), true);
  });

  test("false for an unparsable timestamp", () => {
    assert.equal(isRecent("not-a-date", now), false);
  });
});

describe("computeStats", () => {
  test("counts today / week / total correctly", () => {
    const now = new Date("2026-07-05T15:00:00.000Z");
    const rows = [
      { created_at: "2026-07-05T10:00:00.000Z" }, // today
      { created_at: "2026-07-05T01:00:00.000Z" }, // today (after local midnight UTC)
      { created_at: "2026-07-02T12:00:00.000Z" }, // this week, not today
      { created_at: "2026-06-01T12:00:00.000Z" }, // older than a week
    ];
    const stats = computeStats(rows, now);
    assert.equal(stats.total, 4);
    assert.equal(stats.today, 2);
    assert.equal(stats.week, 3);
  });

  test("all zero for an empty list", () => {
    assert.deepEqual(computeStats([], new Date()), {
      today: 0,
      week: 0,
      total: 0,
    });
  });

  test("ignores rows with an unparsable created_at", () => {
    const now = new Date("2026-07-05T15:00:00.000Z");
    const stats = computeStats([{ created_at: "garbage" }], now);
    assert.equal(stats.today, 0);
    assert.equal(stats.week, 0);
    assert.equal(stats.total, 1); // still counted toward the raw total
  });
});

describe("buildTelHref", () => {
  test("keeps a leading + and strips other punctuation", () => {
    assert.equal(buildTelHref("+966 51 111 2222"), "tel:+966511112222");
  });
  test("passes through a plain local number", () => {
    assert.equal(buildTelHref("0511112222"), "tel:0511112222");
  });
  test("empty phone yields empty string", () => {
    assert.equal(buildTelHref(""), "");
    assert.equal(buildTelHref(null), "");
  });
});

describe("buildWaHref", () => {
  test("normalizes a Saudi local number (leading 0) to the 966 country code", () => {
    assert.equal(buildWaHref("0511112222"), "https://wa.me/966511112222");
  });
  test("leaves an already-international number unchanged", () => {
    assert.equal(buildWaHref("966511112222"), "https://wa.me/966511112222");
  });
  test("strips a stray '+' and spaces", () => {
    assert.equal(buildWaHref("+966 51 111 2222"), "https://wa.me/966511112222");
  });
  test("empty phone yields empty string", () => {
    assert.equal(buildWaHref(""), "");
    assert.equal(buildWaHref(undefined), "");
  });
});

describe("buildMailtoHref", () => {
  test("builds a mailto: href", () => {
    assert.equal(buildMailtoHref("a@b.com"), "mailto:a@b.com");
  });
  test("empty email yields empty string", () => {
    assert.equal(buildMailtoHref(""), "");
    assert.equal(buildMailtoHref(null), "");
  });
});

describe("paginate", () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ id: i + 1 }));

  test("DEFAULT_PAGE_SIZE is 25", () => {
    assert.equal(DEFAULT_PAGE_SIZE, 25);
  });

  test("defaults to page 1 with DEFAULT_PAGE_SIZE rows", () => {
    const result = paginate(rows, undefined);
    assert.equal(result.page, 1);
    assert.equal(result.pageRows.length, DEFAULT_PAGE_SIZE);
    assert.equal(result.pageRows[0].id, 1);
    assert.equal(result.total, 60);
    assert.equal(result.totalPages, 3);
  });

  test("accepts a string page number (as read from a URL query param)", () => {
    const result = paginate(rows, "2");
    assert.equal(result.page, 2);
    assert.equal(result.pageRows[0].id, 26);
  });

  test("clamps an out-of-range page to the last page", () => {
    const result = paginate(rows, "999");
    assert.equal(result.page, 3);
    assert.equal(result.pageRows.length, 10);
  });

  test("falls back to page 1 for non-numeric or non-positive input", () => {
    assert.equal(paginate(rows, "abc").page, 1);
    assert.equal(paginate(rows, "0").page, 1);
    assert.equal(paginate(rows, "-5").page, 1);
    assert.equal(paginate(rows, null).page, 1);
  });

  test("respects a custom page size", () => {
    const result = paginate(rows, 1, 10);
    assert.equal(result.pageRows.length, 10);
    assert.equal(result.totalPages, 6);
  });

  test("empty rows always yields exactly one (empty) page", () => {
    const result = paginate([], 5);
    assert.deepEqual(result.pageRows, []);
    assert.equal(result.page, 1);
    assert.equal(result.totalPages, 1);
    assert.equal(result.total, 0);
  });

  test("missing rows argument is treated as an empty list", () => {
    const result = paginate(undefined, 1);
    assert.deepEqual(result.pageRows, []);
    assert.equal(result.totalPages, 1);
  });
});

describe("sort constants", () => {
  test("SORT_FIELDS has exactly the three sortable columns", () => {
    assert.deepEqual(SORT_FIELDS, ["created_at", "name", "status"]);
  });
  test("defaults are a valid field/dir pair", () => {
    assert.ok(SORT_FIELDS.includes(DEFAULT_SORT_FIELD));
    assert.ok(["asc", "desc"].includes(DEFAULT_SORT_DIR));
  });
});

describe("isValidSortField / isValidSortDir", () => {
  test("accepts each known sort field", () => {
    for (const f of SORT_FIELDS) assert.equal(isValidSortField(f), true);
  });
  test("rejects an unknown sort field", () => {
    assert.equal(isValidSortField("email"), false);
    assert.equal(isValidSortField(""), false);
    assert.equal(isValidSortField(undefined), false);
  });
  test("accepts asc/desc only", () => {
    assert.equal(isValidSortDir("asc"), true);
    assert.equal(isValidSortDir("desc"), true);
    assert.equal(isValidSortDir("ASC"), false);
    assert.equal(isValidSortDir(""), false);
    assert.equal(isValidSortDir(undefined), false);
  });
});

describe("sortRows", () => {
  const rows = [
    { name: "Zaid", status: "new", created_at: "2026-07-01T00:00:00.000Z" },
    { name: "amal", status: "closed", created_at: "2026-07-03T00:00:00.000Z" },
    {
      name: "Bilal",
      status: "contacted",
      created_at: "2026-07-02T00:00:00.000Z",
    },
  ];

  test("sorts by created_at descending by default", () => {
    const sorted = sortRows(rows, "created_at", "desc");
    assert.deepEqual(
      sorted.map((r) => r.name),
      ["amal", "Bilal", "Zaid"]
    );
  });

  test("sorts by created_at ascending", () => {
    const sorted = sortRows(rows, "created_at", "asc");
    assert.deepEqual(
      sorted.map((r) => r.name),
      ["Zaid", "Bilal", "amal"]
    );
  });

  test("sorts by name case-insensitively", () => {
    const sorted = sortRows(rows, "name", "asc");
    assert.deepEqual(
      sorted.map((r) => r.name),
      ["amal", "Bilal", "Zaid"]
    );
  });

  test("sorts by status", () => {
    const sorted = sortRows(rows, "status", "asc");
    assert.deepEqual(
      sorted.map((r) => r.status),
      ["closed", "contacted", "new"]
    );
  });

  test("falls back to defaults for an invalid field/dir", () => {
    const sorted = sortRows(rows, "email", "sideways");
    assert.deepEqual(
      sorted.map((r) => r.name),
      ["amal", "Bilal", "Zaid"]
    );
  });

  test("is stable: equal keys preserve original relative order", () => {
    const tied = [
      { name: "A", created_at: "2026-07-01T00:00:00.000Z" },
      { name: "B", created_at: "2026-07-01T00:00:00.000Z" },
      { name: "C", created_at: "2026-07-01T00:00:00.000Z" },
    ];
    const sorted = sortRows(tied, "created_at", "desc");
    assert.deepEqual(
      sorted.map((r) => r.name),
      ["A", "B", "C"]
    );
  });

  test("does not mutate the input array", () => {
    const copy = rows.map((r) => ({ ...r }));
    sortRows(rows, "name", "asc");
    assert.deepEqual(rows, copy);
  });

  test("missing rows argument is treated as an empty list", () => {
    assert.deepEqual(sortRows(undefined, "name", "asc"), []);
  });
});

describe("toggleSortDir", () => {
  test("toggles asc<->desc when clicking the already-active column", () => {
    assert.equal(toggleSortDir("name", "asc", "name"), "desc");
    assert.equal(toggleSortDir("name", "desc", "name"), "asc");
  });
  test("switching to created_at defaults to desc (newest first)", () => {
    assert.equal(toggleSortDir("name", "asc", "created_at"), "desc");
  });
  test("switching to a text column defaults to asc", () => {
    assert.equal(toggleSortDir("created_at", "desc", "name"), "asc");
    assert.equal(toggleSortDir("created_at", "desc", "status"), "asc");
  });
});

describe("markDuplicates", () => {
  test("flags rows sharing the same phone number", () => {
    const rows = [
      { id: 1, phone: "0511112222", email: "a@x.com" },
      { id: 2, phone: "0511112222", email: "b@x.com" },
      { id: 3, phone: "0599998888", email: "c@x.com" },
    ];
    const marked = markDuplicates(rows);
    assert.equal(marked[0].isDuplicate, true);
    assert.equal(marked[1].isDuplicate, true);
    assert.equal(marked[2].isDuplicate, false);
  });

  test("flags rows sharing the same email (case/whitespace-insensitive)", () => {
    const rows = [
      { id: 1, phone: "0511112222", email: "Same@Example.com" },
      { id: 2, phone: "0522223333", email: " same@example.com " },
    ];
    const marked = markDuplicates(rows);
    assert.equal(marked[0].isDuplicate, true);
    assert.equal(marked[1].isDuplicate, true);
  });

  test("blank phone/email never counts as a match", () => {
    const rows = [
      { id: 1, phone: "", email: "" },
      { id: 2, phone: "", email: "" },
    ];
    const marked = markDuplicates(rows);
    assert.equal(marked[0].isDuplicate, false);
    assert.equal(marked[1].isDuplicate, false);
  });

  test("unique contacts are never flagged", () => {
    const rows = [
      { id: 1, phone: "0511112222", email: "a@x.com" },
      { id: 2, phone: "0522223333", email: "b@x.com" },
    ];
    const marked = markDuplicates(rows);
    assert.equal(marked[0].isDuplicate, false);
    assert.equal(marked[1].isDuplicate, false);
  });

  test("returns new row objects and does not mutate the input", () => {
    const rows = [{ id: 1, phone: "0511112222", email: "a@x.com" }];
    const marked = markDuplicates(rows);
    assert.notEqual(marked[0], rows[0]);
    assert.equal(rows[0].isDuplicate, undefined);
  });

  test("missing rows argument is treated as an empty list", () => {
    assert.deepEqual(markDuplicates(undefined), []);
  });
});

describe("isValidNewPassword", () => {
  test("accepts a password of 8 or more characters", () => {
    assert.equal(isValidNewPassword("12345678"), true);
    assert.equal(isValidNewPassword("a-very-long-password"), true);
  });
  test("rejects a password shorter than 8 characters", () => {
    assert.equal(isValidNewPassword("short"), false);
    assert.equal(isValidNewPassword(""), false);
  });
  test("rejects non-string input", () => {
    assert.equal(isValidNewPassword(undefined), false);
    assert.equal(isValidNewPassword(null), false);
    assert.equal(isValidNewPassword(12345678), false);
  });
});

describe("buildQueryString", () => {
  test("builds a query string from a plain object", () => {
    const qs = buildQueryString({ q: "ahmed", status: "new" });
    assert.equal(qs, "q=ahmed&status=new");
  });
  test("drops null/undefined/empty-string values", () => {
    const qs = buildQueryString({
      q: "",
      status: null,
      sort: undefined,
      dir: "asc",
    });
    assert.equal(qs, "dir=asc");
  });
  test("coerces numeric values to strings", () => {
    const qs = buildQueryString({ page: 2 });
    assert.equal(qs, "page=2");
  });
  test("percent-encodes special characters", () => {
    const qs = buildQueryString({ q: "a b&c" });
    assert.equal(qs, "q=a+b%26c");
  });
  test("empty/missing params object yields an empty string", () => {
    assert.equal(buildQueryString({}), "");
    assert.equal(buildQueryString(undefined), "");
  });
});
