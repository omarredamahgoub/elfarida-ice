/**
 * POST /api/quote — self-hosted quote/contact intake on Cloudflare.
 * Replaces the external web3forms dependency.
 *
 * Pipeline (each stage degrades gracefully if its binding/secret is absent):
 *   1. Parse JSON or form-encoded body.
 *   2. Honeypot ("botcheck") → silently accept & drop.
 *   3. Cloudflare Turnstile verification (if TURNSTILE_SECRET set).
 *   4. Minimal validation.
 *   5. Persist to D1 (binding: DB) — the durable source of truth.
 *   6. Notify by email via Resend (if RESEND_API_KEY set).
 *
 * Bindings / secrets (Pages → Settings):
 *   DB                D1 database "elfarida-leads"
 *   TURNSTILE_SECRET  Cloudflare Turnstile secret key   (optional)
 *   RESEND_API_KEY    Resend API key                    (optional)
 *   LEAD_TO           recipient (default info@elfaridaice.com)
 *   LEAD_FROM         sender   (default no-reply@elfaridaice.com)
 */

const DEFAULT_TO = "info@elfaridaice.com";
const DEFAULT_FROM = "Elfarida Ice <no-reply@elfaridaice.com>";

export async function onRequestPost(context) {
  const { request, env } = context;

  const data = await parseBody(request);
  if (data === null) return json({ success: false, message: "طلب غير صالح." }, 400);

  // Anti-abuse: reject oversized payloads before any processing.
  try {
    if (JSON.stringify(data).length > 8000) {
      return json({ success: false, message: "حجم الطلب كبير جدًّا." }, 413);
    }
  } catch (_) { /* non-serializable → treat as bad request */ }

  // 2) Honeypot — pretend success so bots do not retry.
  if (data.botcheck) return json({ success: true, message: "تمّ الاستلام." });

  // 3) Turnstile (only enforced when configured).
  if (env.TURNSTILE_SECRET) {
    const token = data["cf-turnstile-response"] || data.turnstileToken || "";
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET, token, request.headers.get("CF-Connecting-IP"));
    if (!ok) return json({ success: false, message: "فشل التحقّق من أنّك لست روبوتًا. حدِّث الصفحة وحاول مجدّدًا." }, 403);
  }

  // 4) Minimal validation.
  const name = pick(data, ["name", "الاسم", "full_name"]);
  const email = pick(data, ["email", "البريد", "البريد_الإلكتروني"]);
  const phone = pick(data, ["phone", "الهاتف", "الجوال", "رقم_الجوال"]);
  if (!name && !phone && !email) return json({ success: false, message: "يرجى إدخال بيانات التواصل." }, 422);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ success: false, message: "صيغة البريد غير صحيحة." }, 422);

  // 4.5) Lightweight per-IP rate limit (anti-flood) backed by D1.
  // Real visitors almost never submit >5 times in 10 minutes; bots flooding
  // the endpoint do. Fails open if the check itself errors.
  const clientIp = request.headers.get("CF-Connecting-IP") || "";
  if (env.DB && clientIp) {
    try {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const recent = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM leads WHERE ip = ? AND created_at > ?"
      ).bind(clientIp, since).first();
      if (recent && recent.n >= 5) {
        return json({ success: false, message: "لقد أرسلت عدّة طلبات للتوّ. يرجى المحاولة بعد قليل." }, 429);
      }
    } catch (_) { /* fail open — never block a genuine user on a check error */ }
  }

  // 5) Persist (durable). Never block the user on a storage hiccup.
  let stored = false;
  if (env.DB) {
    try {
      await env.DB.prepare(
        "INSERT INTO leads (id, created_at, name, email, phone, subject, payload, ip, ua) VALUES (?,?,?,?,?,?,?,?,?)"
      ).bind(
        crypto.randomUUID(),
        new Date().toISOString(),
        name, email, phone,
        pick(data, ["subject", "الموضوع"]),
        JSON.stringify(stripNoise(data)),
        request.headers.get("CF-Connecting-IP") || "",
        request.headers.get("user-agent") || ""
      ).run();
      stored = true;
    } catch (_) { /* fall through; email may still deliver */ }
  }

  // 6) Notify (best-effort). Config lives in D1 (env secrets are not injected
  // into Functions on this project), with env vars as fallback.
  let emailed = false;
  const cfg = await loadMailConfig(env);
  if (cfg.apiKey && cfg.to.length) {
    try { emailed = await sendEmail(cfg, { name, email, data }); } catch (_) { /* ignore */ }
  }

  if (!stored && !emailed) {
    return json({ success: false, message: "تعذّر استلام الطلب مؤقّتًا. يرجى المحاولة لاحقًا أو الاتّصال بنا." }, 502);
  }
  return json({ success: true, message: "تمّ استلام طلبك بنجاح، وسنتواصل معك في أقرب وقت." });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "Allow": "POST, OPTIONS" } });
}

/* ── helpers ───────────────────────────────────────────────── */

async function parseBody(request) {
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  try {
    if (ct.includes("application/json")) return await request.json();
    const fd = await request.formData();
    const obj = {};
    for (const [k, v] of fd.entries()) obj[k] = typeof v === "string" ? v : "(file)";
    return obj;
  } catch (_) {
    return null;
  }
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim() !== "") return String(obj[k]).trim();
  }
  return "";
}

function stripNoise(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === "botcheck" || k === "cf-turnstile-response" || k === "access_key") continue;
    out[k] = v;
  }
  return out;
}

async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const out = await resp.json().catch(() => ({ success: false }));
  return !!out.success;
}

async function loadMailConfig(env) {
  let row = {};
  if (env.DB) {
    try {
      const res = await env.DB.prepare(
        "SELECT k, v FROM settings WHERE k IN ('resend_api_key','lead_to','lead_from')"
      ).all();
      for (const r of (res?.results || [])) row[r.k] = r.v;
    } catch (_) { /* fall back to env */ }
  }
  const toRaw = row.lead_to || env.LEAD_TO || DEFAULT_TO;
  return {
    apiKey: row.resend_api_key || env.RESEND_API_KEY || "",
    from: row.lead_from || env.LEAD_FROM || DEFAULT_FROM,
    to: String(toRaw).split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean),
  };
}

async function sendEmail(cfg, { name, email, data }) {
  const rows = Object.entries(stripNoise(data))
    .map(([k, v]) => `<tr><td style="padding:6px 10px;border:1px solid #e2e8f0;font-weight:700">${esc(k)}</td><td style="padding:6px 10px;border:1px solid #e2e8f0">${esc(v)}</td></tr>`)
    .join("");
  const html = `<div dir="rtl" style="font-family:sans-serif;max-width:640px;margin:auto">
    <h2 style="color:#1e3a8a">طلب عرض سعر / تواصل جديد</h2>
    <table style="border-collapse:collapse;width:100%">${rows}</table>
    <hr/><small style="color:#64748b">elfaridaice.com — نموذج الموقع</small></div>`;
  const payload = {
    from: cfg.from,
    to: cfg.to,
    subject: pick(data, ["subject", "الموضوع"]) || `طلب جديد${name ? " - " + name : ""}`,
    html,
  };
  if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) payload.reply_to = email;
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return resp.ok;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
