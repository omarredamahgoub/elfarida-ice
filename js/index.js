!(function () {
  "use strict";
  // ─── Slider Engine (v2 — Zero Forced Reflow) ─────────────────────────────────
  // الإصلاح: استبدال getBoundingClientRect() داخل دورة الأنيميشن بـ cache
  // يُحدَّث فقط عند resize عبر ResizeObserver (async, لا يُسبب reflow)
  function initCarousel(cfg) {
    var track = document.getElementById(cfg.trackId),
      btnPrev = document.getElementById(cfg.prevBtnId),
      btnNext = document.getElementById(cfg.nextBtnId),
      dotsWrap = document.getElementById(cfg.dotsId);
    if (!track || !btnPrev || !btnNext || !dotsWrap || !track.children.length) return;

    var ANIM_MS = 600,
      AUTOPLAY_MS = 3500,
      slides = Array.from(track.children),
      count = slides.length;

    // نسخ الشرائح للتكرار اللانهائي
    slides.forEach(function (s) {
      track.appendChild(s.cloneNode(true));
    });

    var idx = 0,
      locked = false,
      timer = null,
      touchX = 0,
      touchDx = 0,
      _resizeTimer = null,
      // ▶ cache لعرض الشريحة — يُحدَّث async عبر ResizeObserver فقط
      _slideW = 0;

    // ─── حساب العرض المخزَّن (يُستدعى async — لا reflow أثناء render) ─────────
    function updateSlideWidth() {
      var first = track.children[0];
      if (!first) return;
      // getBoundingClientRect هنا آمن لأنه يُستدعى فقط عند resize وليس داخل rAF
      _slideW = first.getBoundingClientRect().width + 30;
    }

    // تهيئة أولية بعد paint
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        updateSlideWidth();
        moveTo(0, false);
        startAutoplay();
      });
    });

    // ─── ResizeObserver بدلاً من window.resize للدقة وعدم الـ reflow ───────────
    if (typeof ResizeObserver !== "undefined") {
      var ro = new ResizeObserver(function () {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(function () {
          updateSlideWidth();
          moveTo(idx, false);
        }, 120);
      });
      ro.observe(track.parentElement);
    } else {
      window.addEventListener("resize", function () {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(function () {
          updateSlideWidth();
          moveTo(idx, false);
        }, 120);
      });
    }

    // ─── حركة الـ slider باستخدام transform بدون قراءة layout ────────────────
    function moveTo(n, animate) {
      track.style.transition = animate
        ? "transform " + ANIM_MS + "ms cubic-bezier(0.25,0.8,0.25,1)"
        : "none";
      track.style.transform = "translateX(-" + n * _slideW + "px)";
      updateDots();
    }

    function updateDots() {
      var active = idx % count;
      dotsWrap.querySelectorAll(".carousel-dot").forEach(function (d, i) {
        d.classList.toggle("active", i === active);
      });
    }

    function next() {
      if (locked) return;
      locked = true;
      idx++;
      moveTo(idx, true);
      setTimeout(function () {
        if (idx >= count) {
          idx = 0;
          moveTo(0, false);
        }
        locked = false;
      }, ANIM_MS);
    }

    function prev() {
      if (locked) return;
      locked = true;
      if (idx <= 0) {
        idx = count;
        moveTo(idx, false);
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            idx--;
            moveTo(idx, true);
            setTimeout(function () {
              locked = false;
            }, ANIM_MS);
          });
        });
      } else {
        idx--;
        moveTo(idx, true);
        setTimeout(function () {
          locked = false;
        }, ANIM_MS);
      }
    }

    function startAutoplay() {
      clearInterval(timer);
      timer = setInterval(next, AUTOPLAY_MS);
    }

    // ─── Dots ────────────────────────────────────────────────────────────────────
    dotsWrap.innerHTML = "";
    for (var i = 0; i < count; i++) {
      (function (n) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "carousel-dot" + (n === 0 ? " active" : "");
        btn.setAttribute("aria-label", "الشريحة " + (n + 1));
        btn.addEventListener("click", function () {
          if (locked) return;
          idx = n;
          moveTo(idx, true);
          startAutoplay();
        });
        dotsWrap.appendChild(btn);
      })(i);
    }

    // ─── Buttons ─────────────────────────────────────────────────────────────────
    btnPrev.addEventListener("click", function () {
      prev();
      startAutoplay();
    });
    btnNext.addEventListener("click", function () {
      next();
      startAutoplay();
    });
    ["keydown"].forEach(function (ev) {
      btnPrev.addEventListener(ev, function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          prev();
          startAutoplay();
        }
      });
      btnNext.addEventListener(ev, function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          next();
          startAutoplay();
        }
      });
    });

    // ─── Hover pause ─────────────────────────────────────────────────────────────
    var wrap = track.parentElement;
    wrap.addEventListener("mouseenter", function () {
      clearInterval(timer);
    });
    wrap.addEventListener("mouseleave", startAutoplay);

    // ─── Touch / Swipe (passive — لا reflow) ─────────────────────────────────────
    track.addEventListener(
      "touchstart",
      function (e) {
        touchX = e.touches[0].clientX;
        touchDx = 0;
        track.style.transition = "none";
        clearInterval(timer);
      },
      { passive: true }
    );
    track.addEventListener(
      "touchmove",
      function (e) {
        touchDx = e.touches[0].clientX - touchX;
        // استخدام الـ cached width — لا getBoundingClientRect هنا
        track.style.transform = "translateX(-" + (idx * _slideW - touchDx) + "px)";
      },
      { passive: true }
    );
    track.addEventListener("touchend", function () {
      if (touchDx > 56) prev();
      else if (touchDx < -56) next();
      else moveTo(idx, true);
      startAutoplay();
    });
  }

  initCarousel({
    trackId: "partnersTrack",
    prevBtnId: "partnersPrevBtn",
    nextBtnId: "partnersNextBtn",
    dotsId: "partnersDots",
  });
  initCarousel({
    trackId: "clientsTrack",
    prevBtnId: "clientsPrevBtn",
    nextBtnId: "clientsNextBtn",
    dotsId: "clientsDots",
  });

  // ─── Hero Quick Form ──────────────────────────────────────────────────────────
  (function () {
    var form = document.getElementById("hero-quick-form"),
      btnSub = document.getElementById("hero-submit-btn"),
      inpName = document.getElementById("hero-name"),
      inpPh = document.getElementById("hero-phone"),
      inpSvc = document.getElementById("hero-service-val"),
      elErr = document.getElementById("hero-error"),
      errDefaultTxt = elErr ? elErr.textContent : "";

    if (!form || !btnSub) return;

    function showError(msg) {
      if (elErr) elErr.textContent = msg && String(msg).trim() ? msg : errDefaultTxt;
      show("hero-error");
    }

    // ── Input validation policy ───────────────────
    // Deliberately permissive. Every keystroke rejected here is a lost lead:
    // real buyers write names such as "عبد الله آل-سعود" or "M. Al-Qahtani", and they
    // dial from company switchboards ("013 812 3456") and foreign numbers.
    // The Worker performs the authoritative validation, so the browser only
    // blocks input that could not possibly be a name or a phone number.
    var reNm =
        /^[\u0600-\u06FF\u0750-\u077Fa-zA-Z][\u0600-\u06FF\u0750-\u077Fa-zA-Z\s.'\u2019-]{1,59}$/,
      rePh = /^\+?\d{9,15}$/;

    /** Arabic-Indic digits to Latin, then every human separator removed. */
    function normPhone(value) {
      return String(value)
        .replace(/[\u0660-\u0669]/g, function (d) {
          return String.fromCharCode(d.charCodeAt(0) - 0x0630);
        })
        .replace(/[^\d+]/g, "");
    }

    function validPhone(value) {
      return rePh.test(normPhone(value));
    }

    function hide(id) {
      var e = document.getElementById(id);
      e && e.classList.add("hidden");
    }
    function show(id) {
      var e = document.getElementById(id);
      e && e.classList.remove("hidden");
    }

    inpName.addEventListener("input", function () {
      // Dots, hyphens and apostrophes are legitimate inside names; only
      // digits and characters that can never appear in one are stripped.
      this.value = this.value.replace(/[0-9\u0660-\u0669!@#$%^&*()_+=[\]{};:"\\|,<>/?]/g, "");
      var v = this.value.trim();
      v.length === 0 || reNm.test(v) ? hide("err-name") : show("err-name");
    });
    inpPh.addEventListener("input", function () {
      // Spaces, dashes and parentheses are kept so the visitor can type the
      // number the way it is printed on their card; normPhone strips them.
      this.value = this.value.replace(/[^\d+\u0660-\u0669\s()-]/g, "");
      var v = this.value.trim();
      v.length === 0 || validPhone(v) ? hide("err-phone") : v.length > 3 && show("err-phone");
    });

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var nm = inpName.value.trim(),
        ph = inpPh.value.trim(),
        svc = inpSvc ? inpSvc.value : "",
        ok = true;
      reNm.test(nm) ? hide("err-name") : (show("err-name"), (ok = false));
      validPhone(ph) ? hide("err-phone") : (show("err-phone"), (ok = false));
      svc ? hide("err-service") : (show("err-service"), (ok = false));
      if (!ok) return;
      hide("hero-success");
      hide("hero-error");
      btnSub.disabled = true;
      btnSub.textContent = "جاري الإرسال...";
      // منطق الإرسال موحَّد عبر SiteShell.postLead (site-shell.js يُحمَّل دائماً قبل التفاعل الفعلي مع الصفحة)
      window.SiteShell.postLead(form)
        .then(function (r) {
          r.success ? (show("hero-success"), form.reset()) : showError(r && r.message);
        })
        .catch(function () {
          showError();
        })
        .finally(function () {
          btnSub.disabled = false;
          btnSub.textContent = "أرسل الطلب";
        });
    });
  })();

  // ─── Service Dropdown ─────────────────────────────────────────────────────────
  (function () {
    var trigger = document.getElementById("svc-trigger"),
      list = document.getElementById("svc-list"),
      label = document.getElementById("svc-label"),
      valEl = document.getElementById("hero-service-val");
    if (!trigger || !list) return;

    trigger.addEventListener("click", function () {
      var open = list.classList.contains("open");
      list.classList.toggle("open", !open);
      trigger.classList.toggle("open", !open);
      trigger.setAttribute("aria-expanded", String(!open));
    });

    list.querySelectorAll(".svc-option").forEach(function (opt) {
      opt.addEventListener("click", function () {
        var val = this.getAttribute("data-value");
        if (valEl) valEl.value = val;
        if (label) {
          label.textContent = this.textContent.trim();
          label.style.color = "white";
        }
        list.querySelectorAll(".svc-option").forEach(function (o) {
          o.classList.remove("selected");
        });
        this.classList.add("selected");
        list.classList.remove("open");
        trigger.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
        var err = document.getElementById("err-service");
        if (err) err.classList.add("hidden");
      });
    });

    document.addEventListener("click", function (e) {
      var dd = document.getElementById("svc-dropdown");
      if (dd && !dd.contains(e.target)) {
        list.classList.remove("open");
        trigger.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
      }
    });
  })();
})();
