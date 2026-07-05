import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isHoneypotFilled,
  shouldTrackLead,
  buildLeadEventParams,
  dedupeKey,
  alreadyTracked,
  markTracked,
  pushLeadEvent,
  trackLeadFromResponse,
  GENERATE_LEAD_EVENT_NAME,
} from "../js/lead-tracking-lib.js";

function fakeFormData(entries) {
  const map = new Map(Object.entries(entries || {}));
  return { get: (key) => (map.has(key) ? map.get(key) : null) };
}

function fakeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    _map: map,
  };
}

describe("isHoneypotFilled", () => {
  test("false when the honeypot field is empty", () => {
    assert.equal(isHoneypotFilled(fakeFormData({ botcheck: "" })), false);
  });
  test("false when the honeypot field is absent entirely", () => {
    assert.equal(isHoneypotFilled(fakeFormData({ Name: "Omar" })), false);
  });
  test("true when the honeypot field was filled in (bot behavior)", () => {
    assert.equal(isHoneypotFilled(fakeFormData({ botcheck: "on" })), true);
  });
  test("false for null/undefined formData (defensive)", () => {
    assert.equal(isHoneypotFilled(null), false);
    assert.equal(isHoneypotFilled(undefined), false);
  });
  test("false for a formData-shaped object missing .get", () => {
    assert.equal(isHoneypotFilled({}), false);
  });
});

describe("shouldTrackLead", () => {
  test("true for a genuine successful submission", () => {
    const fd = fakeFormData({ Name: "Omar", botcheck: "" });
    assert.equal(shouldTrackLead({ success: true }, fd), true);
  });
  test("false when the server reports failure", () => {
    const fd = fakeFormData({ Name: "Omar", botcheck: "" });
    assert.equal(
      shouldTrackLead({ success: false, message: "خطأ" }, fd),
      false,
    );
  });
  test("false when the honeypot was filled, even though the server said success:true", () => {
    const fd = fakeFormData({ Name: "Omar", botcheck: "spam" });
    assert.equal(shouldTrackLead({ success: true }, fd), false);
  });
  test("false for a malformed/non-object response", () => {
    const fd = fakeFormData({});
    assert.equal(shouldTrackLead(null, fd), false);
    assert.equal(shouldTrackLead(undefined, fd), false);
    assert.equal(shouldTrackLead("success", fd), false);
    assert.equal(shouldTrackLead(true, fd), false);
  });
});

describe("buildLeadEventParams", () => {
  test("includes form_id, page_path, and lead_service when present", () => {
    const fd = fakeFormData({ Service: "غرفة تبريد جديدة" });
    const params = buildLeadEventParams(fd, {
      formId: "hero-quick-form",
      pagePath: "/",
    });
    assert.deepEqual(params, {
      form_id: "hero-quick-form",
      page_path: "/",
      lead_service: "غرفة تبريد جديدة",
    });
  });
  test("omits lead_service when the Service field is blank or absent", () => {
    const params1 = buildLeadEventParams(fakeFormData({ Service: "   " }), {
      formId: "f",
    });
    assert.equal("lead_service" in params1, false);
    const params2 = buildLeadEventParams(fakeFormData({}), { formId: "f" });
    assert.equal("lead_service" in params2, false);
  });
  test("omits form_id/page_path when meta is not provided", () => {
    const params = buildLeadEventParams(fakeFormData({}));
    assert.deepEqual(params, {});
  });
  test("never throws for a null formData", () => {
    assert.doesNotThrow(() => buildLeadEventParams(null, { formId: "f" }));
  });
});

describe("dedupeKey", () => {
  test("namespaces the key with the form id", () => {
    assert.equal(dedupeKey("contact-form"), "efi_lead_tracked_contact-form");
  });
  test("falls back to a stable key for a missing form id", () => {
    assert.equal(dedupeKey(""), "efi_lead_tracked_unknown");
    assert.equal(dedupeKey(undefined), "efi_lead_tracked_unknown");
  });
});

describe("alreadyTracked / markTracked", () => {
  test("round-trips through a storage stub", () => {
    const storage = fakeStorage();
    assert.equal(alreadyTracked(storage, "contact-form"), false);
    markTracked(storage, "contact-form");
    assert.equal(alreadyTracked(storage, "contact-form"), true);
  });
  test("tracking one form id does not affect another", () => {
    const storage = fakeStorage();
    markTracked(storage, "hero-quick-form");
    assert.equal(alreadyTracked(storage, "contact-form"), false);
  });
  test("alreadyTracked is false when storage is unavailable", () => {
    assert.equal(alreadyTracked(null, "f"), false);
    assert.equal(alreadyTracked(undefined, "f"), false);
  });
  test("markTracked never throws when storage is unavailable", () => {
    assert.doesNotThrow(() => markTracked(null, "f"));
  });
  test("markTracked never throws when storage.setItem itself throws (e.g. quota/private mode)", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    assert.doesNotThrow(() => markTracked(storage, "f"));
  });
});

describe("pushLeadEvent", () => {
  test("pushes an object with the generate_lead event name and params", () => {
    const dataLayer = [];
    const pushed = pushLeadEvent(dataLayer, { form_id: "contact-form" });
    assert.equal(pushed, true);
    assert.equal(dataLayer.length, 1);
    assert.deepEqual(dataLayer[0], {
      event: "generate_lead",
      form_id: "contact-form",
    });
    assert.equal(GENERATE_LEAD_EVENT_NAME, "generate_lead");
  });
  test("returns false and does not throw when dataLayer is missing", () => {
    assert.equal(pushLeadEvent(null, {}), false);
    assert.equal(pushLeadEvent(undefined, {}), false);
  });
});

describe("trackLeadFromResponse (full orchestration)", () => {
  test("pushes exactly one event for a genuine first-time success", () => {
    const dataLayer = [];
    const storage = fakeStorage();
    const fd = fakeFormData({
      Name: "Omar",
      Service: "غرفة تبريد جديدة",
      botcheck: "",
    });
    const pushed = trackLeadFromResponse({
      responseJson: { success: true },
      formData: fd,
      formId: "hero-quick-form",
      pagePath: "/",
      dataLayer,
      storage,
    });
    assert.equal(pushed, true);
    assert.equal(dataLayer.length, 1);
    assert.deepEqual(dataLayer[0], {
      event: "generate_lead",
      form_id: "hero-quick-form",
      page_path: "/",
      lead_service: "غرفة تبريد جديدة",
    });
  });
  test("does not push a second event for a resubmission of the same form", () => {
    const dataLayer = [];
    const storage = fakeStorage();
    const fd = fakeFormData({ Name: "Omar", botcheck: "" });
    const ctx = {
      responseJson: { success: true },
      formData: fd,
      formId: "contact-form",
      dataLayer,
      storage,
    };
    assert.equal(trackLeadFromResponse(ctx), true);
    assert.equal(trackLeadFromResponse(ctx), false);
    assert.equal(dataLayer.length, 1);
  });
  test("does not push for a honeypot-caught bot submission despite success:true", () => {
    const dataLayer = [];
    const storage = fakeStorage();
    const fd = fakeFormData({ Name: "bot", botcheck: "spam" });
    const pushed = trackLeadFromResponse({
      responseJson: { success: true },
      formData: fd,
      formId: "contact-form",
      dataLayer,
      storage,
    });
    assert.equal(pushed, false);
    assert.equal(dataLayer.length, 0);
  });
  test("does not push for a failed submission", () => {
    const dataLayer = [];
    const storage = fakeStorage();
    const fd = fakeFormData({ Name: "Omar", botcheck: "" });
    const pushed = trackLeadFromResponse({
      responseJson: { success: false, message: "خطأ" },
      formData: fd,
      formId: "contact-form",
      dataLayer,
      storage,
    });
    assert.equal(pushed, false);
    assert.equal(dataLayer.length, 0);
  });
  test("two different forms in the same session are tracked independently", () => {
    const dataLayer = [];
    const storage = fakeStorage();
    const fd = fakeFormData({ botcheck: "" });
    trackLeadFromResponse({
      responseJson: { success: true },
      formData: fd,
      formId: "hero-quick-form",
      dataLayer,
      storage,
    });
    trackLeadFromResponse({
      responseJson: { success: true },
      formData: fd,
      formId: "contact-form",
      dataLayer,
      storage,
    });
    assert.equal(dataLayer.length, 2);
  });
  test("never throws even when dataLayer/storage are absent", () => {
    assert.doesNotThrow(() =>
      trackLeadFromResponse({
        responseJson: { success: true },
        formData: fakeFormData({ botcheck: "" }),
        formId: "contact-form",
      }),
    );
  });
  test("returns false and does nothing for an empty/undefined context", () => {
    assert.equal(trackLeadFromResponse(), false);
    assert.equal(trackLeadFromResponse({}), false);
  });
});
