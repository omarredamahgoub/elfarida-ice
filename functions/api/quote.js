/**
 * POST /api/quote — self-hosted quote/contact intake on Cloudflare.
 *
 * Pipeline (each stage degrades gracefully if its binding/secret is absent):
 *   1. Read the raw body under a hard byte cap, then parse JSON, urlencoded or
 *      multipart into a flat, bounded map of string fields.
 *   2. Honeypot ("botcheck") → silently accept & drop.
 *   3. Cloudflare Turnstile verification for protected forms.
 *   4. Validation.
 *   5. Per-IP rate limit.
 *   6. Persist to D1 (binding: DB) — the durable source of truth.
 *   7. Notify the owner by email via Resend.
 *   8. Customer auto-acknowledgement — ONLY for a request that passed Turnstile,
 *      at most once per address per day. This endpoint must never become a
 *      relay that sends mail from elfaridaice.com to arbitrary addresses.
 *
 * Bindings / secrets (Pages → Settings, or the D1 `settings` table):
 *   DB                D1 database "elfarida-leads"
 *   TURNSTILE_SECRET  Cloudflare Turnstile secret key
 *   RESEND_API_KEY    Resend API key
 *   LEAD_TO           recipient (default info@elfaridaice.com)
 *   LEAD_FROM         sender   (default no-reply@elfaridaice.com)
 */

const DEFAULT_TO = "info@elfaridaice.com";
const DEFAULT_FROM = "Elfarida Ice <no-reply@elfaridaice.com>";

const MAX_BODY_BYTES = 16384;
const MAX_FIELDS = 40;
const MAX_KEY_LENGTH = 64;
const MAX_VALUE_LENGTH = 4000;
const MAX_SUBJECT_LENGTH = 150;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_PER_IP = 5;
const CONFIRMATION_WINDOW_MS = 24 * 60 * 60 * 1000;

const HONEYPOT_KEY = "botcheck";
const TURNSTILE_KEYS = ["cf-turnstile-response", "turnstileToken"];
const INTERNAL_KEYS = new Set([
  HONEYPOT_KEY,
  "access_key",
  "contact_ref",
  "protected",
  ...TURNSTILE_KEYS,
]);

/** Same shape /api/contact-event stores, so the two tables join on equal terms. */
const REF_RE = /^EFI-[0-9A-Z]{4}$/;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"']+@[^\s@<>()[\]\\,;:"']+\.[A-Za-z]{2,}$/;
const URL_LIKE_RE = /(https?:|www\.|:\/\/|[a-z0-9-]+\.[a-z]{2,}\/)/i;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const LINE_BREAKS_RE = /[\r\n\u2028\u2029]+/g;

export async function onRequestPost(context) {
  const { request, env } = context;

  const parsed = await parseBody(request);
  if (parsed.error === "too_large")
    return json({ success: false, message: "حجم الطلب كبير جدًّا." }, 413);
  if (parsed.error) return json({ success: false, message: "طلب غير صالح." }, 400);
  const data = parsed.data;

  // Honeypot — pretend success so bots do not retry.
  if (data[HONEYPOT_KEY]) return json({ success: true, message: "تمّ الاستلام." });

  const clientIp = request.headers.get("CF-Connecting-IP") || "";

  // Turnstile. A MISSING token is never a rejection: the widget loads from a
  // third-party origin and is absent on slow links or behind content blockers,
  // and those are real buyers. A token that is PRESENT but fails verification
  // is a forged or replayed challenge and is rejected. An unverified request
  // is still stored and forwarded to the owner, but earns no outbound mail to
  // the address it supplied.
  let humanVerified = false;
  if (data.protected === "1") {
    const token = TURNSTILE_KEYS.map((k) => data[k]).find(Boolean) || "";
    if (token) {
      const secret = (await getSetting(env.DB, "turnstile_secret")) || env.TURNSTILE_SECRET || "";
      if (secret) {
        humanVerified = await verifyTurnstile(secret, token, clientIp);
        if (!humanVerified)
          return json(
            {
              success: false,
              message: "فشل التحقّق من أنّك لست روبوتًا. حدِّث الصفحة وحاول مجدّدًا.",
            },
            403
          );
      }
    }
  }

  const name = singleLine(pick(data, ["name", "Name", "الاسم", "full_name"])).slice(
    0,
    MAX_NAME_LENGTH
  );
  const email = pick(data, ["email", "Email", "البريد", "البريد_الإلكتروني"]);
  const phone = singleLine(
    pick(data, ["phone", "Phone", "Mobile", "mobile", "الهاتف", "الجوال", "رقم_الجوال"])
  );
  const subject = singleLine(pick(data, ["subject", "الموضوع", "service", "Service"])).slice(
    0,
    MAX_SUBJECT_LENGTH
  );

  if (!name && !phone && !email)
    return json({ success: false, message: "يرجى إدخال بيانات التواصل." }, 422);
  if (email && !isValidEmail(email))
    return json({ success: false, message: "صيغة البريد غير صحيحة." }, 422);

  if (await isRateLimited(env.DB, clientIp))
    return json(
      { success: false, message: "لقد أرسلت عدّة طلبات للتوّ. يرجى المحاولة بعد قليل." },
      429
    );

  const payload = publicFields(data);
  const stored = await storeLead(env.DB, {
    name,
    email,
    phone,
    subject,
    payload,
    ref: validRef(data.contact_ref),
    ip: clientIp,
    ua: (request.headers.get("user-agent") || "").slice(0, 300),
  });

  const cfg = await loadMailConfig(env);
  let emailed = false;
  if (cfg.apiKey && cfg.to.length) {
    emailed = await sendOwnerNotification(cfg, { name, email, subject, payload });
  }

  if (cfg.apiKey && email && humanVerified && !(await confirmationRecentlySent(env.DB, email))) {
    await sendCustomerConfirmation(cfg, { name, email });
  }

  if (!stored && !emailed)
    return json(
      {
        success: false,
        message: "تعذّر استلام الطلب مؤقّتًا. يرجى المحاولة لاحقًا أو الاتّصال بنا.",
      },
      502
    );
  return json({ success: true, message: "تمّ استلام طلبك بنجاح، وسنتواصل معك في أقرب وقت." });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: "POST, OPTIONS" } });
}

/* ── body parsing ──────────────────────────────────────────── */

async function parseBody(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) return { error: "too_large" };

  let raw;
  try {
    raw = await request.arrayBuffer();
  } catch (_) {
    return { error: "invalid" };
  }
  if (raw.byteLength > MAX_BODY_BYTES) return { error: "too_large" };

  const ct = (request.headers.get("content-type") || "").toLowerCase();
  try {
    if (ct.includes("application/json")) {
      const obj = JSON.parse(new TextDecoder().decode(raw));
      if (obj === null || typeof obj !== "object" || Array.isArray(obj))
        return { error: "invalid" };
      return normalizeFields(Object.entries(obj));
    }
    if (ct.includes("application/x-www-form-urlencoded")) {
      return normalizeFields(new URLSearchParams(new TextDecoder().decode(raw)).entries());
    }
    if (ct.includes("multipart/form-data")) {
      const fd = await new Response(raw, { headers: { "content-type": ct } }).formData();
      return normalizeFields(fd.entries());
    }
  } catch (_) {
    return { error: "invalid" };
  }
  return { error: "invalid" };
}

/**
 * Flattens untrusted input into a null-prototype map of bounded strings.
 * Non-scalar values (objects, arrays, files) are discarded rather than
 * stringified, so nothing structured reaches storage or the mail template.
 */
function normalizeFields(entries) {
  const out = Object.create(null);
  let count = 0;
  for (const [rawKey, rawValue] of entries) {
    if (
      typeof rawValue !== "string" &&
      typeof rawValue !== "number" &&
      typeof rawValue !== "boolean"
    )
      continue;
    const key = String(rawKey).replace(CONTROL_CHARS_RE, "").trim().slice(0, MAX_KEY_LENGTH);
    if (!key || key in out) continue;
    if (++count > MAX_FIELDS) return { error: "too_large" };
    out[key] = String(rawValue).replace(CONTROL_CHARS_RE, "").trim().slice(0, MAX_VALUE_LENGTH);
  }
  return { data: out };
}

function pick(obj, keys) {
  // Case-insensitive lookup: form field names vary in casing across pages.
  const lower = new Map();
  for (const k of Object.keys(obj)) lower.set(k.toLowerCase(), obj[k]);
  for (const k of keys) {
    const v = lower.get(k.toLowerCase());
    if (v) return v;
  }
  return "";
}

function publicFields(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) if (!INTERNAL_KEYS.has(k)) out[k] = v;
  return out;
}

function singleLine(value) {
  return String(value).replace(LINE_BREAKS_RE, " ").trim();
}

function isValidEmail(value) {
  return value.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(value);
}

function validRef(value) {
  const s = String(value || "").toUpperCase();
  return REF_RE.test(s) ? s : "";
}

/* ── storage ───────────────────────────────────────────────── */

async function isRateLimited(db, ip) {
  if (!db || !ip) return false;
  try {
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const row = await db
      .prepare("SELECT COUNT(*) AS n FROM leads WHERE ip = ? AND created_at > ?")
      .bind(ip, since)
      .first();
    return Boolean(row && row.n >= RATE_MAX_PER_IP);
  } catch (_) {
    return false;
  }
}

async function storeLead(db, lead) {
  if (!db) return false;
  const id = crypto.randomUUID();
  try {
    await db
      .prepare(
        "INSERT INTO leads (id, created_at, name, email, phone, subject, payload, ip, ua) VALUES (?,?,?,?,?,?,?,?,?)"
      )
      .bind(
        id,
        new Date().toISOString(),
        lead.name,
        lead.email,
        lead.phone,
        lead.subject,
        JSON.stringify(lead.payload),
        lead.ip,
        lead.ua
      )
      .run();
  } catch (_) {
    return false;
  }
  // Written separately and best-effort: `leads.ref` comes from migration 0004,
  // and folding it into the INSERT would drop every lead on a deploy that
  // lands before the migration.
  if (lead.ref) {
    try {
      await db.prepare("UPDATE leads SET ref = ? WHERE id = ?").bind(lead.ref, id).run();
    } catch (_) {
      /* column not migrated yet — the lead itself is already safe */
    }
  }
  return true;
}

/**
 * True when this address already has an earlier lead within the window, i.e.
 * it was already acknowledged. Runs after the current lead is stored, hence
 * `> 1`. Fails closed: on a query error no acknowledgement is sent.
 */
async function confirmationRecentlySent(db, email) {
  if (!db) return true;
  try {
    const since = new Date(Date.now() - CONFIRMATION_WINDOW_MS).toISOString();
    const row = await db
      .prepare("SELECT COUNT(*) AS n FROM leads WHERE lower(email) = lower(?) AND created_at > ?")
      .bind(email, since)
      .first();
    return !row || row.n > 1;
  } catch (_) {
    return true;
  }
}

async function getSetting(db, key) {
  if (!db) return "";
  try {
    const r = await db.prepare("SELECT v FROM settings WHERE k = ?").bind(key).first();
    return r ? r.v : "";
  } catch (_) {
    return "";
  }
}

/* ── mail ──────────────────────────────────────────────────── */

async function verifyTurnstile(secret, token, ip) {
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  try {
    const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    const out = await resp.json();
    return out.success === true;
  } catch (_) {
    return false;
  }
}

async function loadMailConfig(env) {
  const row = {};
  if (env.DB) {
    try {
      const res = await env.DB.prepare(
        "SELECT k, v FROM settings WHERE k IN ('resend_api_key','lead_to','lead_from')"
      ).all();
      for (const r of res?.results || []) row[r.k] = r.v;
    } catch (_) {
      /* fall back to env */
    }
  }
  const toRaw = row.lead_to || env.LEAD_TO || DEFAULT_TO;
  return {
    apiKey: row.resend_api_key || env.RESEND_API_KEY || "",
    from: row.lead_from || env.LEAD_FROM || DEFAULT_FROM,
    to: String(toRaw)
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

async function sendOwnerNotification(cfg, { name, email, subject, payload }) {
  const rows = Object.entries(payload)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 10px;border:1px solid #e2e8f0;font-weight:700">${esc(k)}</td><td style="padding:6px 10px;border:1px solid #e2e8f0;white-space:pre-wrap">${esc(v)}</td></tr>`
    )
    .join("");
  const html = `<div dir="rtl" style="font-family:sans-serif;max-width:640px;margin:auto">
    <h2 style="color:#1e3a8a">طلب عرض سعر / تواصل جديد</h2>
    <table style="border-collapse:collapse;width:100%">${rows}</table>
    <hr/><small style="color:#64748b">elfaridaice.com — نموذج الموقع</small></div>`;
  const message = {
    from: cfg.from,
    to: cfg.to,
    subject: subject || `طلب جديد${name ? " - " + name : ""}`,
    html,
  };
  if (email) message.reply_to = email;
  return sendMail(cfg.apiKey, message);
}

async function sendCustomerConfirmation(cfg, { name, email }) {
  // A supplied name is echoed only when it cannot carry a link: the mail is
  // sent from our domain, and a "name" holding a URL would turn it into a
  // phishing message bearing our signature.
  const greetingName = name && !URL_LIKE_RE.test(name) ? " " + esc(name.slice(0, 60)) : "";
  const html = `<div dir="rtl" style="font-family:'Cairo',Tahoma,sans-serif;max-width:600px;margin:auto;color:#1e293b;line-height:1.8">
    <h2 style="color:#1e3a8a;margin:0 0 12px">شكرًا لتواصلك مع شركة الفريدة آيس</h2>
    <p>مرحبًا${greetingName}،</p>
    <p>تسلّمنا طلبك بنجاح، وسيتواصل معك فريقنا في أقرب وقت ممكن لتزويدك بعرض السعر والتفاصيل المطلوبة.</p>
    <p>لأيّ استفسار عاجل تواصل معنا على <a href="mailto:info@elfaridaice.com" style="color:#1e3a8a">info@elfaridaice.com</a> أو هاتفيًّا على ‎+966&nbsp;59&nbsp;836&nbsp;6214‎.</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0"/>
    <small style="color:#64748b">شركة الفريدة آيس للهندسة والتبريد الصناعيّ — الدمّام، المملكة العربيّة السعوديّة<br/>elfaridaice.com</small>
  </div>`;
  return sendMail(cfg.apiKey, {
    from: cfg.from,
    to: [email],
    subject: "تمّ استلام طلبك — شركة الفريدة آيس",
    html,
    reply_to: "info@elfaridaice.com",
  });
}

async function sendMail(apiKey, message) {
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    return resp.ok;
  } catch (_) {
    return false;
  }
}

/* ── responses ─────────────────────────────────────────────── */

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
