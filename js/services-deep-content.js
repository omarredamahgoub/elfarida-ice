'use strict';
/**
 * services-deep-content-injector.js
 * يحقن أقساماً تقنية عميقة في صفحات الخدمات:
 *   - أنظمة الراك المركزي
 *   - تقنية IQF
 *   - أنظمة الأمونيا
 *   - عقود الصيانة (4 خطط)
 *   - مقارنة سماكات البانل
 *   - أنواع أبواب التبريد
 *
 * يُحقن قبل footer ولا يلمس المحتوى الموجود
 */
(function () {
  'use strict';

  function isServicesPage() {
    const path = (location.pathname || '').toLowerCase();
    return /services(-en)?\.html/.test(path);
  }

  function isArabic() {
    return (document.documentElement.lang || '').toLowerCase().indexOf('ar') === 0;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  const CONTENT = {
    ar: {
      rack: {
        heading: 'أنظمة الراك المركزية للمستودعات الكبرى',
        intro: 'أنظمة الراك المركزية (Centralized Rack Systems) هي العمود الفقري للمستودعات اللوجستية والسوبرماركت الكبرى. تجمع 3 إلى 12 ضاغطاً على هيكل واحد لخدمة عشرات نقاط التبريد، مما يحقق وفراً كهربائياً يصل إلى 40% مقارنةً بالوحدات المنفصلة، إلى جانب احتياطية تلقائية Lead/Lag تضمن استمرارية الخدمة عند فشل أي ضاغط.',
        bullets: [
          'سعة تبريدية: 50 إلى 600 كيلوواط للراك الواحد',
          'ضواغط Bitzer Octagon أو Copeland Discus نصف المغلقة',
          'تحكم مركزي بـ CAREL pCO5+ أو Danfoss AK-PC مع Modbus/BACnet',
          'استرداد حراري Heat Recovery لتوليد ماء ساخن مجاني',
          'دعم متعدد الحرارة: تبريد +2°م + تجميد -25°م على نفس الراك',
          'أنظمة CO2 Trans-Critical للسوبرماركت الحديثة'
        ]
      },
      iqf: {
        heading: 'تقنية التجميد الصاعق IQF',
        intro: 'IQF اختصار لـ Individual Quick Freezing — تقنية متقدمة تجمّد كل قطعة منتج بشكل منفرد بسرعة كبيرة (-35°م إلى -40°م خلال 15-30 دقيقة)، مما يحفظ القوام والقيمة الغذائية ويمنع تكوّن بلورات الثلج الكبيرة المدمّرة للخلايا. تستخدمها مصانع الدواجن، الأسماك، الفواكه، الخضروات، المخابز.',
        bullets: [
          'IQF Spiral: الأنسب للمنتجات الصغيرة (دواجن مقطّعة، روبيان، توت) بقدرات 500 كجم/ساعة إلى 5 طن/ساعة',
          'IQF Tunnel: للمنتجات الأكبر (فيليه أسماك، قطع لحم) بسرعة عالية',
          'IQF Plate Freezer: تجميد ألواح بلوكية للأسماك الكاملة بكفاءة فائقة',
          'IQF Fluidized Bed: للحبوب والبازلاء والذرة بهواء مرتفع السرعة',
          'وحدات Friga-Bohn IQF الفرنسية معتمدة دولياً'
        ]
      },
      ammonia: {
        heading: 'أنظمة الأمونيا (NH3 / R717) للصناعات الثقيلة',
        intro: 'الأمونيا هي الخيار الذهبي للمنشآت الصناعية الكبرى (>500 كيلوواط) نظراً لكفاءتها الفائقة (COP يفوق 4) وصفر تأثيرها على البيئة (GWP=0, ODP=0). تستخدمها مصانع الدواجن العملاقة، مصانع الثلج الصناعي، المستودعات اللوجستية الضخمة (>10,000م³)، ومصانع الألبان الكبيرة.',
        bullets: [
          'كفاءة طاقة أعلى بنسبة 25% من الفريون',
          'تكلفة تشغيل أقل بنسبة 30% على المدى الطويل',
          'صديقة للبيئة 100% — لا تساهم في الاحتباس الحراري',
          'تتطلب أنظمة سلامة Honeywell بحساسات تسرب متعددة المناطق',
          'توافق كامل مع معايير ASHRAE 15 و EN 378',
          'عمر تشغيلي يفوق 25 سنة مع صيانة منتظمة'
        ]
      },
      maintenance: {
        heading: 'خطط عقود الصيانة الدورية',
        intro: 'الصيانة الوقائية المنتظمة توفّر 60% من تكاليف الإصلاحات الطارئة وتمدّد عمر المعدات. نقدّم 4 خطط مرنة تناسب جميع أحجام المنشآت:',
        plans: [
          { name: 'Basic', price: '4,800 ريال/سنة', visits: '4 زيارات/سنة', features: ['فحص الضواغط ربع سنوي', 'فحص ضغوط ودرجات حرارة', 'تنظيف المكثفات والمبخرات', 'تقرير حالة شامل', 'استجابة طوارئ خلال 24 ساعة'] },
          { name: 'Standard', price: '9,600 ريال/سنة', visits: '8 زيارات/سنة', features: ['كل مزايا Basic', 'فحص شهري للأنظمة الحرجة', 'استبدال فلاتر التجفيف سنوياً', 'فحص تسرب الفريون نصف سنوي', 'استجابة طوارئ خلال 8 ساعات'] },
          { name: 'Premium', price: '18,000 ريال/سنة', visits: '12 زيارة/سنة', features: ['كل مزايا Standard', 'صيانة وقائية شهرية شاملة', 'قطع غيار استهلاكية مشمولة', 'فحص دقيق للوحات الكهربائية', 'استجابة طوارئ خلال 4 ساعات', 'تقارير شهرية لاستهلاك الطاقة'] },
          { name: 'Enterprise', price: 'مخصصة', visits: 'حسب المتطلبات', features: ['عقد مفصّل للمنشآت الكبيرة', 'فني مقيم اختياري', 'كل قطع الغيار مشمولة', 'مراقبة عن بُعد 24/7 عبر CAREL boss', 'استجابة طوارئ خلال ساعتين', 'KPI Dashboard شهري'] }
        ]
      },
      panels: {
        heading: 'مقارنة سماكات البانل العازل',
        intro: 'اختيار السماكة الصحيحة للبانل يحدد كفاءة الغرفة على المدى الطويل. الجدول التالي يعرض المواصفات والاستخدامات الموصى بها:',
        rows: [
          { thickness: '60mm', u_value: '0.36 W/m²K', application: 'غرف تبريد +5°م إلى +10°م (خضروات، فواكه)', cost_index: 'منخفض' },
          { thickness: '80mm', u_value: '0.27 W/m²K', application: 'غرف تبريد +2°م إلى +6°م (لحوم طازجة، ألبان)', cost_index: 'منخفض-متوسط' },
          { thickness: '100mm', u_value: '0.22 W/m²K', application: 'غرف تبريد دقيقة 0°م إلى +2°م (دواجن، أسماك)', cost_index: 'متوسط' },
          { thickness: '120mm', u_value: '0.18 W/m²K', application: 'غرف تجميد -10°م إلى -18°م', cost_index: 'متوسط-مرتفع' },
          { thickness: '150mm', u_value: '0.15 W/m²K', application: 'غرف تجميد عميق -20°م إلى -25°م (موصى به)', cost_index: 'مرتفع' },
          { thickness: '200mm', u_value: '0.11 W/m²K', application: 'تجميد فائق -30°م إلى -40°م، مختبرات دوائية', cost_index: 'بريميوم' }
        ]
      },
      doors: {
        heading: 'أنواع أبواب التبريد المتاحة',
        intro: 'الباب نقطة ضعف العزل الحراري وأكثر مكان لتسرّب البرودة. اختيار النوع الصحيح يقلّل الفقد بنسبة 70%:',
        types: [
          { name: 'مفصلية (Hinged)', desc: 'الأكثر شيوعاً للغرف الصغيرة والمتوسطة. سهلة التركيب، اقتصادية، مناسبة لتردد فتح متوسط (<50 مرة/يوم).', best: 'غرف التبريد التجارية الصغيرة' },
          { name: 'منزلقة (Sliding)', desc: 'للممرات الضيقة وفتح المتكرر. توفّر مساحة، تتحمّل الاستخدام المكثف، مناسبة لمستودعات اللوجستيات.', best: 'مستودعات لوجستية كبيرة' },
          { name: 'أوتوماتيكية (Automatic)', desc: 'تفتح وتغلق بحساس حركة أو زر. تقلل فقد البرودة لأن وقت الفتح قصير. أعلى تكلفة لكن أعلى توفير على المدى البعيد.', best: 'سوبرماركت ومستودعات الذروة' },
          { name: 'شريحية بلاستيكية (Strip Curtain)', desc: 'حاجز هوائي إضافي خلف الباب الرئيسي. يقلل الفقد عند فتح الباب بنسبة 40-60%.', best: 'كل أنواع الغرف (مكمّل)' },
          { name: 'ستائر هواء (Air Curtain)', desc: 'تدفع تيار هواء بسرعة عالية يمنع اختلاط الهواء الداخلي بالخارجي. مثالية للممرات بدون باب.', best: 'مداخل المستودعات الكبيرة' }
        ]
      }
    }
  };

  function buildSectionsHTML(c) {
    const html = ['<div class="max-w-7xl mx-auto px-4 space-y-20">'];

    // Rack
    html.push('<article aria-labelledby="rack-h"><h2 id="rack-h" class="text-3xl md:text-4xl font-black text-slate-900 mb-4">' + c.rack.heading + '</h2><p class="text-slate-700 leading-relaxed mb-6 text-lg">' + c.rack.intro + '</p><ul class="grid md:grid-cols-2 gap-3">');
    c.rack.bullets.forEach(b => html.push('<li class="flex gap-3 bg-blue-50 p-4 rounded-xl"><span class="text-blue-600 font-black">✓</span><span class="text-slate-700 text-sm">' + escapeHtml(b) + '</span></li>'));
    html.push('</ul></article>');

    // IQF
    html.push('<article aria-labelledby="iqf-h"><h2 id="iqf-h" class="text-3xl md:text-4xl font-black text-slate-900 mb-4">' + c.iqf.heading + '</h2><p class="text-slate-700 leading-relaxed mb-6 text-lg">' + c.iqf.intro + '</p><ul class="grid md:grid-cols-2 gap-3">');
    c.iqf.bullets.forEach(b => html.push('<li class="flex gap-3 bg-cyan-50 p-4 rounded-xl"><span class="text-cyan-600 font-black">❄</span><span class="text-slate-700 text-sm">' + escapeHtml(b) + '</span></li>'));
    html.push('</ul></article>');

    // Ammonia
    html.push('<article aria-labelledby="nh3-h"><h2 id="nh3-h" class="text-3xl md:text-4xl font-black text-slate-900 mb-4">' + c.ammonia.heading + '</h2><p class="text-slate-700 leading-relaxed mb-6 text-lg">' + c.ammonia.intro + '</p><ul class="grid md:grid-cols-2 gap-3">');
    c.ammonia.bullets.forEach(b => html.push('<li class="flex gap-3 bg-emerald-50 p-4 rounded-xl"><span class="text-emerald-600 font-black">🌿</span><span class="text-slate-700 text-sm">' + escapeHtml(b) + '</span></li>'));
    html.push('</ul></article>');

    // Maintenance plans
    html.push('<article aria-labelledby="maint-h"><h2 id="maint-h" class="text-3xl md:text-4xl font-black text-slate-900 mb-4">' + c.maintenance.heading + '</h2><p class="text-slate-700 leading-relaxed mb-8 text-lg">' + c.maintenance.intro + '</p><div class="grid md:grid-cols-2 lg:grid-cols-4 gap-6">');
    c.maintenance.plans.forEach((p, i) => {
      const featured = i === 2 ? 'ring-4 ring-blue-500 transform scale-105' : '';
      const badge = i === 2 ? '<div class="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-black px-3 py-1 rounded-full">الأكثر طلباً</div>' : '';
      html.push('<div class="relative bg-white rounded-2xl border border-slate-200 p-6 shadow hover:shadow-lg transition ' + featured + '">' + badge + '<h3 class="text-2xl font-black text-slate-900 mb-2">' + escapeHtml(p.name) + '</h3><div class="text-blue-600 font-black text-xl mb-1">' + escapeHtml(p.price) + '</div><div class="text-slate-500 text-xs mb-5">' + escapeHtml(p.visits) + '</div><ul class="space-y-2 text-sm">');
      p.features.forEach(f => html.push('<li class="flex gap-2"><span class="text-green-500 font-black flex-shrink-0">✓</span><span class="text-slate-700">' + escapeHtml(f) + '</span></li>'));
      html.push('</ul></div>');
    });
    html.push('</div></article>');

    // Panels comparison
    html.push('<article aria-labelledby="panels-h"><h2 id="panels-h" class="text-3xl md:text-4xl font-black text-slate-900 mb-4">' + c.panels.heading + '</h2><p class="text-slate-700 leading-relaxed mb-6 text-lg">' + c.panels.intro + '</p><div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow"><table class="w-full text-right"><thead class="bg-gradient-to-l from-blue-900 to-blue-700 text-white"><tr><th class="p-4 font-black text-sm">السماكة</th><th class="p-4 font-black text-sm">قيمة U</th><th class="p-4 font-black text-sm">التطبيق الموصى به</th><th class="p-4 font-black text-sm">التكلفة</th></tr></thead><tbody>');
    c.panels.rows.forEach((r, i) => {
      html.push('<tr class="border-t border-slate-100 ' + (i % 2 ? 'bg-slate-50' : 'bg-white') + ' hover:bg-blue-50 transition"><td class="p-4 font-black text-blue-700">' + escapeHtml(r.thickness) + '</td><td class="p-4 text-slate-700">' + escapeHtml(r.u_value) + '</td><td class="p-4 text-slate-700 text-sm">' + escapeHtml(r.application) + '</td><td class="p-4 text-slate-600 text-sm">' + escapeHtml(r.cost_index) + '</td></tr>');
    });
    html.push('</tbody></table></div></article>');

    // Doors
    html.push('<article aria-labelledby="doors-h"><h2 id="doors-h" class="text-3xl md:text-4xl font-black text-slate-900 mb-4">' + c.doors.heading + '</h2><p class="text-slate-700 leading-relaxed mb-6 text-lg">' + c.doors.intro + '</p><div class="grid md:grid-cols-2 gap-5">');
    c.doors.types.forEach(t => {
      html.push('<div class="bg-gradient-to-br from-slate-50 to-blue-50 rounded-2xl p-6 border border-slate-200"><h3 class="text-xl font-black text-slate-900 mb-2">🚪 ' + escapeHtml(t.name) + '</h3><p class="text-slate-700 text-sm leading-relaxed mb-3">' + escapeHtml(t.desc) + '</p><div class="text-xs font-bold text-blue-700 bg-blue-100 inline-block px-3 py-1 rounded-full">الأمثل لـ: ' + escapeHtml(t.best) + '</div></div>');
    });
    html.push('</div></article>');

    html.push('</div>');
    return html.join('');
  }

  function inject() {
    if (!isServicesPage()) return;
    if (document.getElementById('services-deep-content')) return;
    if (!isArabic()) return; // النسخة الإنجليزية تُحقن من ملف منفصل لاحقاً

    const c = CONTENT.ar;
    const section = document.createElement('section');
    section.id = 'services-deep-content';
    section.className = 'py-20 bg-gradient-to-br from-slate-50 to-white';
    section.innerHTML = buildSectionsHTML(c);

    const anchor = document.getElementById('services-deep-anchor');
    if (anchor) {
      anchor.replaceWith(section);
    } else {
      const footer = document.querySelector('footer[role="contentinfo"]') || document.querySelector('footer');
      if (footer && footer.parentNode) {
        footer.parentNode.insertBefore(section, footer);
      } else {
        document.body.appendChild(section);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
