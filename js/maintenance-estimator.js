/**
 * js/maintenance-estimator.js
 * ------------------------------------------------------------------
 * Annual maintenance-contract cost estimator, shared by
 * maintenance-contracts.html and maintenance-contracts-en.html.
 *
 * Every coefficient lives in /lib/site.config.json → `maintenance`, so pricing
 * is tuned in exactly one file and is never duplicated in markup or script:
 *
 *     annual ≈ unitBase × unitCount × planFactor × regionFactor
 *
 * The output is deliberately a RANGE (±maintenance.estimateSpreadPercent) and is
 * labelled as an estimate. A single exact figure would be a commitment this page
 * cannot honour before an on-site survey of the actual equipment.
 *
 * Language is taken from <html lang>, and every string is read from the config's
 * bilingual fields — this file carries only the handful of words that are pure UI.
 */
(function () {
  "use strict";

  var L = (document.documentElement.lang || "ar").toLowerCase().indexOf("en") === 0 ? "en" : "ar";

  var UI = {
    ar: {
      visitsSuffix: " زيارة/سنة",
      unitWord: " وحدة",
      basePriceOf: "ريال (سعر أساس ",
      factorOf: "معامل ",
      loadError: "تعذّر تحميل بيانات التسعير. تواصل معنا مباشرة للحصول على عرض.",
      waEstimate: [
        "السلام عليكم، أرغب في عقد صيانة سنوي.",
        "• نوع الوحدة: ",
        "• عدد الوحدات: ",
        "• الباقة: ",
        "• المنطقة: ",
        "• التقدير الظاهر على موقعكم: ",
        " ريال سنوياً",
        "أرجو ترتيب معاينة فنية.",
      ],
      waSurvey: "السلام عليكم، أرغب في معاينة فنية مجانية لعقد صيانة سنوي.",
    },
    en: {
      visitsSuffix: " visits/year",
      unitWord: " unit(s)",
      basePriceOf: "SAR (base price, ",
      factorOf: "factor ",
      loadError: "Could not load pricing data. Please contact us directly for a quote.",
      waEstimate: [
        "Hello, I would like an annual maintenance contract.",
        "• Unit type: ",
        "• Number of units: ",
        "• Plan: ",
        "• Region: ",
        "• Estimate shown on your site: ",
        " SAR per year",
        "Please arrange a technical survey.",
      ],
      waSurvey: "Hello, I would like a free technical survey for an annual maintenance contract.",
    },
  }[L];

  var els = {
    form: document.getElementById("est-form"),
    unit: document.getElementById("est-unit"),
    count: document.getElementById("est-count"),
    plan: document.getElementById("est-plan"),
    region: document.getElementById("est-region"),
    range: document.getElementById("est-range"),
    formula: document.getElementById("est-formula"),
    disclaimer: document.getElementById("est-disclaimer"),
    wa: document.getElementById("est-wa"),
    tel: document.getElementById("est-tel"),
    ctaWa: document.getElementById("cta-wa"),
  };
  if (!els.form) return;

  var cfg = null;

  /** Rounds to the nearest 100 SAR — an estimate implying single riyals reads false. */
  function money(n) {
    return (Math.round(n / 100) * 100).toLocaleString("en-US");
  }

  function option(value, label, selected) {
    var o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    if (selected) o.selected = true;
    return o;
  }

  function fillSelects(m) {
    Object.keys(m.unitBasePriceSar).forEach(function (k) {
      els.unit.appendChild(option(k, m.unitBasePriceSar[k][L]));
    });
    m.plans.forEach(function (p) {
      els.plan.appendChild(
        option(p.id, p.name[L] + " — " + p.visitsPerYear + UI.visitsSuffix, !!p.recommended)
      );
    });
    Object.keys(m.regionFactor).forEach(function (k) {
      els.region.appendChild(option(k, m.regionFactor[k][L]));
    });
    if (m.disclaimer && els.disclaimer) els.disclaimer.textContent = m.disclaimer[L];
  }

  /** Seeds each plan card's "from" price: one cold room, this plan, base region. */
  function fillPlanCards(m) {
    var base = m.unitBasePriceSar["cold-room"].base;
    m.plans.forEach(function (p) {
      var node = document.querySelector('.plan[data-plan="' + p.id + '"] [data-plan-price]');
      if (node) node.textContent = money(base * p.factor);
    });
  }

  function currentEstimate(m) {
    var unit = m.unitBasePriceSar[els.unit.value];
    var plan = m.plans.filter(function (p) { return p.id === els.plan.value; })[0];
    var region = m.regionFactor[els.region.value];
    var count = Math.max(1, Math.min(50, parseInt(els.count.value, 10) || 1));
    if (!unit || !plan || !region) return null;

    var mid = unit.base * count * plan.factor * region.factor;
    var spread = (m.estimateSpreadPercent || 15) / 100;
    return {
      unit: unit,
      plan: plan,
      region: region,
      count: count,
      low: mid * (1 - spread),
      high: mid * (1 + spread),
    };
  }

  function waMessage(e) {
    var w = UI.waEstimate;
    return [
      w[0],
      w[1] + e.unit[L],
      w[2] + e.count,
      w[3] + e.plan.name[L],
      w[4] + e.region[L],
      w[5] + money(e.low) + " – " + money(e.high) + w[6],
      w[7],
    ].join("\n");
  }

  function render() {
    if (!cfg) return;
    var e = currentEstimate(cfg.maintenance);
    if (!e) return;

    els.range.textContent = money(e.low) + " – " + money(e.high);
    els.formula.textContent =
      e.unit.base.toLocaleString("en-US") + " " + UI.basePriceOf + e.unit[L] + ") × " +
      e.count + UI.unitWord + " × " +
      e.plan.factor + " (" + UI.factorOf + e.plan.name[L] + ") × " +
      e.region.factor + " (" + UI.factorOf + e.region[L] + ")";

    var wa = String(cfg.contact.phoneWhatsapp.e164).replace(/\D/g, "");
    els.wa.href = "https://wa.me/" + wa + "?text=" + encodeURIComponent(waMessage(e));
    els.tel.href = "tel:" + cfg.contact.phonePrimary.e164;
    if (els.ctaWa) {
      els.ctaWa.href = "https://wa.me/" + wa + "?text=" + encodeURIComponent(UI.waSurvey);
    }
  }

  els.form.addEventListener("input", render);
  els.form.addEventListener("change", render);
  els.form.addEventListener("submit", function (ev) { ev.preventDefault(); });

  fetch("/lib/site.config.json", { credentials: "omit" })
    .then(function (r) { return r.json(); })
    .then(function (json) {
      if (!json || !json.maintenance) throw new Error("no maintenance config");
      cfg = json;
      fillSelects(json.maintenance);
      fillPlanCards(json.maintenance);
      render();
    })
    .catch(function () {
      els.range.textContent = "—";
      els.formula.textContent = UI.loadError;
    });
})();
