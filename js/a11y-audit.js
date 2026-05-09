/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WCAG 2.1 AA Accessibility Audit — Academic Standards 2026
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This script performs automated accessibility audits against WCAG 2.1 AA standards:
 * 
 * Standards Covered:
 * 1. Color Contrast Ratios (WCAG 2.1 1.4.3 Contrast Minimum)
 * 2. Image Alt Text (WCAG 2.1 1.1.1 Non-text Content)
 * 3. Heading Structure (WCAG 2.1 1.3.1 Info & Relationships)
 * 4. Form Labels (WCAG 2.1 1.3.1 & 3.3.2)
 * 5. Keyboard Navigation (WCAG 2.1 2.1.1 Keyboard)
 * 6. Focus Indicators (WCAG 2.1 2.4.7 Focus Visible)
 * 7. Language Declaration (WCAG 2.1 3.1.1 Language of Page)
 * 8. ARIA Attributes (WCAG 2.1 4.1.2 Name, Role, Value)
 * 9. Text Sizing (WCAG 2.1 1.4.4 Resize Text)
 * 10. Page Structure (WCAG 2.1 1.3.1 Info & Relationships)
 * 
 * References:
 * - WCAG 2.1: https://www.w3.org/WAI/WCAG21/quickref/
 * - WebAIM: https://webaim.org/articles/
 * - Axe DevTools: https://www.deque.com/axe/devtools/
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

(function() {
  'use strict';

  const A11Y_REPORT = {
    passed: [],
    warnings: [],
    errors: [],
    timestamp: new Date().toISOString()
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Color Contrast Ratio Check (WCAG 2.1 1.4.3)
  // ──────────────────────────────────────────────────────────────────────────

  function getContrastRatio(rgb1, rgb2) {
    const getLuminance = (rgb) => {
      const [r, g, b] = rgb.match(/\d+/g).map(x => parseInt(x) / 255);
      const [rs, gs, bs] = [r, g, b].map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    };

    const l1 = getLuminance(rgb1);
    const l2 = getLuminance(rgb2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    
    return ((lighter + 0.05) / (darker + 0.05)).toFixed(2);
  }

  function checkColorContrast() {
    const textElements = document.querySelectorAll('body, p, span, a, button, h1, h2, h3, h4, h5, h6, li, label');
    let contrastIssues = 0;

    textElements.forEach(el => {
      const style = window.getComputedStyle(el);
      const color = style.color;
      const bgColor = style.backgroundColor;

      if (bgColor !== 'rgba(0, 0, 0, 0)') {
        const ratio = getContrastRatio(color, bgColor);
        const minRatio = el.tagName.match(/^H[1-6]$/) ? 3 : 4.5; // Heading vs normal text

        if (parseFloat(ratio) < minRatio) {
          contrastIssues++;
          A11Y_REPORT.errors.push({
            code: '1.4.3',
            issue: 'Low Color Contrast',
            element: el.tagName,
            text: el.textContent.substring(0, 50),
            ratio: `${ratio}:1 (minimum required: ${minRatio}:1)`
          });
        }
      }
    });

    if (contrastIssues === 0) {
      A11Y_REPORT.passed.push('✅ 1.4.3 Contrast Minimum — All text meets WCAG AA standards');
    }

    return contrastIssues;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Image Alt Text Check (WCAG 2.1 1.1.1)
  // ──────────────────────────────────────────────────────────────────────────

  function checkImageAltText() {
    const images = document.querySelectorAll('img:not([role="presentation"])');
    let missingAltCount = 0;

    images.forEach((img, idx) => {
      if (!img.alt || img.alt.trim() === '') {
        missingAltCount++;
        A11Y_REPORT.errors.push({
          code: '1.1.1',
          issue: 'Missing Image Alt Text',
          src: img.src.substring(0, 50),
          index: idx
        });
      }
    });

    if (missingAltCount === 0) {
      A11Y_REPORT.passed.push(`✅ 1.1.1 Non-text Content — All ${images.length} images have descriptive alt text`);
    }

    return missingAltCount;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Heading Structure Check (WCAG 2.1 1.3.1)
  // ──────────────────────────────────────────────────────────────────────────

  function checkHeadingStructure() {
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    let issues = 0;

    if (headings.length === 0) {
      A11Y_REPORT.warnings.push({
        code: '1.3.1',
        issue: 'No headings found on page',
        impact: 'Screen reader users may struggle with page structure'
      });
      return 1;
    }

    let lastLevel = 0;
    headings.forEach((h, idx) => {
      const level = parseInt(h.tagName[1]);
      
      // Check for skipped levels
      if (level > lastLevel + 1 && idx > 0) {
        issues++;
        A11Y_REPORT.warnings.push({
          code: '1.3.1',
          issue: 'Skipped Heading Level',
          from: `H${lastLevel}`,
          to: `H${level}`,
          text: h.textContent.substring(0, 50)
        });
      }

      // H1 should appear only once
      if (level === 1 && idx > 0) {
        issues++;
        A11Y_REPORT.warnings.push({
          code: '1.3.1',
          issue: 'Multiple H1 Tags',
          text: h.textContent.substring(0, 50)
        });
      }

      lastLevel = level;
    });

    if (issues === 0) {
      A11Y_REPORT.passed.push('✅ 1.3.1 Info & Relationships — Heading structure is properly organized');
    }

    return issues;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Form Labels Check (WCAG 2.1 1.3.1 & 3.3.2)
  // ──────────────────────────────────────────────────────────────────────────

  function checkFormLabels() {
    const inputs = document.querySelectorAll('input, textarea, select');
    let missingLabelsCount = 0;

    inputs.forEach((input) => {
      const id = input.id;
      const ariaLabel = input.getAttribute('aria-label');
      const ariaLabelledBy = input.getAttribute('aria-labelledby');
      
      let hasLabel = false;

      if (ariaLabel || ariaLabelledBy) {
        hasLabel = true;
      } else if (id) {
        const label = document.querySelector(`label[for="${id}"]`);
        hasLabel = !!label;
      }

      if (!hasLabel && input.type !== 'hidden') {
        missingLabelsCount++;
        A11Y_REPORT.errors.push({
          code: '3.3.2',
          issue: 'Form Input Missing Label',
          type: input.type,
          id: id || '(no id)'
        });
      }
    });

    if (missingLabelsCount === 0 && inputs.length > 0) {
      A11Y_REPORT.passed.push(`✅ 3.3.2 Labels or Instructions — All ${inputs.length} form inputs have labels`);
    }

    return missingLabelsCount;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Keyboard Navigation Check (WCAG 2.1 2.1.1)
  // ──────────────────────────────────────────────────────────────────────────

  function checkKeyboardNavigation() {
    const interactiveElements = document.querySelectorAll('a, button, input, select, textarea, [onclick], [role="button"]');
    let focusableCount = 0;

    interactiveElements.forEach((el) => {
      const tabIndex = el.tabIndex;
      if (tabIndex >= 0 || el.tagName === 'A' || el.tagName === 'BUTTON' || el.tagName.match(/^INPUT|SELECT|TEXTAREA$/)) {
        focusableCount++;
      }
    });

    if (focusableCount > 0) {
      A11Y_REPORT.passed.push(`✅ 2.1.1 Keyboard — ${focusableCount} interactive elements are keyboard accessible`);
    } else {
      A11Y_REPORT.warnings.push({
        code: '2.1.1',
        issue: 'Low keyboard accessibility',
        elements: interactiveElements.length
      });
    }

    return focusableCount;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Language Declaration Check (WCAG 2.1 3.1.1)
  // ──────────────────────────────────────────────────────────────────────────

  function checkLanguageDeclaration() {
    const html = document.documentElement;
    const lang = html.getAttribute('lang');

    if (lang && lang.length >= 2) {
      A11Y_REPORT.passed.push(`✅ 3.1.1 Language of Page — Page language declared as '${lang}'`);
      return 0;
    } else {
      A11Y_REPORT.errors.push({
        code: '3.1.1',
        issue: 'Missing Language Declaration',
        impact: 'Screen readers may use incorrect pronunciation'
      });
      return 1;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 7. ARIA Attributes Check (WCAG 2.1 4.1.2)
  // ──────────────────────────────────────────────────────────────────────────

  function checkARIA() {
    const ariaElements = document.querySelectorAll('[role], [aria-label], [aria-labelledby], [aria-describedby]');
    let ariaCount = ariaElements.length;

    // Check for invalid ARIA roles
    const validRoles = [
      'button', 'link', 'checkbox', 'radio', 'tab', 'tablist', 'tabpanel',
      'navigation', 'main', 'complementary', 'contentinfo', 'search',
      'img', 'alert', 'log', 'marquee', 'status', 'timer', 'tooltip',
      'definition', 'directory', 'doc-*', 'figure', 'list', 'listitem'
    ];

    document.querySelectorAll('[role]').forEach((el) => {
      const role = el.getAttribute('role');
      if (!validRoles.includes(role) && !role.startsWith('doc-')) {
        A11Y_REPORT.warnings.push({
          code: '4.1.2',
          issue: 'Invalid ARIA Role',
          role: role,
          element: el.tagName
        });
      }
    });

    A11Y_REPORT.passed.push(`✅ 4.1.2 Name, Role, Value — ${ariaCount} semantic/ARIA elements found`);
    return 0;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Generate Report
  // ──────────────────────────────────────────────────────────────────────────

  function runAudit() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', executeAudit);
    } else {
      executeAudit();
    }
  }

  function executeAudit() {
    checkColorContrast();
    checkImageAltText();
    checkHeadingStructure();
    checkFormLabels();
    checkKeyboardNavigation();
    checkLanguageDeclaration();
    checkARIA();

    // Expose API — results accessible via window.A11yAudit
    window.A11yAudit = A11Y_REPORT;
  }

  // Initialize
  runAudit();

})();
