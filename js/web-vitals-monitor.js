/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Web Vitals Monitoring — Core Web Vitals Tracking (2026 Academic Standards)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This script monitors the three Core Web Vitals metrics as per Google & WCAG standards:
 * 1. LCP (Largest Contentful Paint) — Target: < 2.5 seconds
 * 2. FID (First Input Delay) — Target: < 100 milliseconds (deprecated in favor of INP)
 * 3. CLS (Cumulative Layout Shift) — Target: < 0.1 (10%)
 * 4. INP (Interaction to Next Paint) — Target: < 200 milliseconds (new in 2023)
 * 5. TTFB (Time to First Byte) — Target: < 600 milliseconds
 * 
 * Specifications Reference:
 * - Google PageSpeed Insights: https://pagespeed.web.dev/
 * - Web Vitals Specification: https://web.dev/vitals/
 * - W3C Performance API: https://www.w3.org/TR/performance-timeline-2/
 * - MDN Web Docs: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

(function() {
  'use strict';

  // ──────────────────────────────────────────────────────────────────────────
  // Configuration & Constants
  // ──────────────────────────────────────────────────────────────────────────
  
  const VITALS_THRESHOLD = {
    lcp: 2500,      // ms — Largest Contentful Paint threshold
    fid: 100,       // ms — First Input Delay threshold (deprecated)
    inp: 200,       // ms — Interaction to Next Paint threshold (new)
    cls: 0.1,       // score (10%) — Cumulative Layout Shift threshold
    ttfb: 600       // ms — Time to First Byte threshold
  };

  const ANALYTICS_ENDPOINT = '/api/vitals'; // Optional: send to analytics

  // ──────────────────────────────────────────────────────────────────────────
  // 1. LCP — Largest Contentful Paint
  // ──────────────────────────────────────────────────────────────────────────
  
  function observeLCP() {
    if (!('PerformanceObserver' in window)) return;

    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1];
        
        const metric = {
          name: 'LCP',
          value: Math.round(lastEntry.renderTime || lastEntry.loadTime),
          threshold: VITALS_THRESHOLD.lcp,
          status: lastEntry.renderTime <= VITALS_THRESHOLD.lcp ? 'good' : 'poor',
          timestamp: performance.now()
        };

        recordMetric(metric);
      });

      observer.observe({ entryTypes: ['largest-contentful-paint'] });
    } catch (e) {
      // observation failed silently
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. FID/INP — First Input Delay / Interaction to Next Paint
  // ──────────────────────────────────────────────────────────────────────────
  
  function observeINP() {
    if (!('PerformanceObserver' in window)) return;

    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1];

        const metric = {
          name: 'INP',
          value: Math.round(lastEntry.processingDuration),
          threshold: VITALS_THRESHOLD.inp,
          status: lastEntry.processingDuration <= VITALS_THRESHOLD.inp ? 'good' : 'poor',
          timestamp: performance.now()
        };

        recordMetric(metric);
      });

      observer.observe({ entryTypes: ['first-input', 'interaction'] });
    } catch (e) {
      // observation failed silently
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. CLS — Cumulative Layout Shift
  // ──────────────────────────────────────────────────────────────────────────
  
  function observeCLS() {
    if (!('PerformanceObserver' in window)) return;

    let clsValue = 0;

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            clsValue += entry.value;
            
            const metric = {
              name: 'CLS',
              value: parseFloat(clsValue.toFixed(3)),
              threshold: VITALS_THRESHOLD.cls,
              status: clsValue <= VITALS_THRESHOLD.cls ? 'good' : 'poor',
              timestamp: performance.now()
            };

            recordMetric(metric);
          }
        }
      });

      observer.observe({ entryTypes: ['layout-shift'] });
    } catch (e) {
      // observation failed silently
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. TTFB — Time to First Byte (Navigation Timing)
  // ──────────────────────────────────────────────────────────────────────────
  
  function observeTTFB() {
    if (!('PerformanceNavigationTiming' in window)) return;

    try {
      window.addEventListener('load', () => {
        const perfData = performance.getEntriesByType('navigation')[0];
        
        if (perfData) {
          const ttfb = Math.round(perfData.responseStart - perfData.fetchStart);

          const metric = {
            name: 'TTFB',
            value: ttfb,
            threshold: VITALS_THRESHOLD.ttfb,
            status: ttfb <= VITALS_THRESHOLD.ttfb ? 'good' : 'poor',
            timestamp: performance.now()
          };

          recordMetric(metric);
        }
      });
    } catch (e) {
      // observation failed silently
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Performance Summary Report
  // ──────────────────────────────────────────────────────────────────────────
  
  function generatePerformanceReport() {
    window.addEventListener('load', () => {
      const perfData = performance.getEntriesByType('navigation')[0];
      
      if (!perfData) return;

      const report = {
        url: window.location.href,
        userAgent: navigator.userAgent,
        metrics: {
          dns: Math.round(perfData.domainLookupEnd - perfData.domainLookupStart),
          tcp: Math.round(perfData.connectEnd - perfData.connectStart),
          request: Math.round(perfData.responseStart - perfData.requestStart),
          response: Math.round(perfData.responseEnd - perfData.responseStart),
          domInteractive: Math.round(perfData.domInteractive - perfData.fetchStart),
          domContentLoaded: Math.round(perfData.domContentLoadedEventEnd - perfData.fetchStart),
          loadComplete: Math.round(perfData.loadEventEnd - perfData.fetchStart)
        }
      };

      // Send to analytics
      sendAnalytics(report);
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helper Functions
  // ──────────────────────────────────────────────────────────────────────────
  
  function recordMetric(metric) {
    // Store in session storage for local access
    const existingMetrics = JSON.parse(sessionStorage.getItem('webVitals') || '[]');
    existingMetrics.push(metric);
    sessionStorage.setItem('webVitals', JSON.stringify(existingMetrics));
  }

  function sendAnalytics(data) {
    // Send performance data to your analytics endpoint (optional)
    if (navigator.sendBeacon && ANALYTICS_ENDPOINT) {
      try {
        navigator.sendBeacon(ANALYTICS_ENDPOINT, JSON.stringify(data));
      } catch (e) {
        // sending failed silently
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Initialization
  // ──────────────────────────────────────────────────────────────────────────
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      observeLCP();
      observeINP();
      observeCLS();
      observeTTFB();
      generatePerformanceReport();
    });
  } else {
    observeLCP();
    observeINP();
    observeCLS();
    observeTTFB();
    generatePerformanceReport();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Exposed API for manual testing
  // ──────────────────────────────────────────────────────────────────────────
  
  window.WebVitalsMonitor = {
    getMetrics: () => JSON.parse(sessionStorage.getItem('webVitals') || '[]'),
    clearMetrics: () => sessionStorage.removeItem('webVitals'),
    getThresholds: () => VITALS_THRESHOLD
  };

})();
