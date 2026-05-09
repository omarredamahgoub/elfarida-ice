/* ================================================================
   brands.js — JavaScript خاص بصفحة brands
   جميع المنطق المشترك منقول إلى js/shared.js
   ================================================================ */

if (typeof AOS !== 'undefined') AOS.init({ duration: 1000, once: true });

(function () {
  var track          = document.getElementById('carouselTrack');
  var prevBtn        = document.getElementById('prevBtn');
  var nextBtn        = document.getElementById('nextBtn');
  var dotsContainer  = document.getElementById('carouselDots');
  if (!track || !prevBtn || !nextBtn || !dotsContainer) return;

  var slides       = Array.from(track.children);
  var currentIndex = 0;
  var autoPlayTimer;
  var touchStartX  = 0;
  var touchDeltaX  = 0;

  function getVisibleCount() {
    if (window.innerWidth >= 1024) return 5;
    if (window.innerWidth >= 768)  return 3;
    return 2;
  }

  function getMaxIndex() {
    return Math.max(0, slides.length - getVisibleCount());
  }

  function renderDots() {
    dotsContainer.innerHTML = '';
    var max = getMaxIndex();
    for (var i = 0; i <= max; i++) {
      (function (idx) {
        var dot = document.createElement('button');
        dot.type      = 'button';
        dot.className = 'carousel-dot';
        dot.setAttribute('aria-label', 'الشريحة ' + (idx + 1));
        if (idx === currentIndex) dot.classList.add('active');
        dot.addEventListener('click', function () {
          currentIndex = idx;
          updateCarousel();
          resetAutoPlay();
        });
        dotsContainer.appendChild(dot);
      })(i);
    }
  }

  function updateCarousel(withTransition) {
    if (withTransition === undefined) withTransition = true;
    var slideWidth = slides[0].getBoundingClientRect().width + 30;
    track.style.transition = withTransition ? 'transform 0.6s cubic-bezier(0.25, 0.8, 0.25, 1)' : 'none';
    track.style.transform  = 'translateX(-' + (currentIndex * slideWidth) + 'px)';
    dotsContainer.querySelectorAll('.carousel-dot').forEach(function (dot, idx) {
      dot.classList.toggle('active', idx === currentIndex);
    });
  }

  function prevSlide() {
    var max = getMaxIndex();
    currentIndex = currentIndex <= 0 ? max : currentIndex - 1;
    updateCarousel();
  }

  function nextSlide() {
    var max = getMaxIndex();
    currentIndex = currentIndex >= max ? 0 : currentIndex + 1;
    updateCarousel();
  }

  function resetAutoPlay() {
    clearInterval(autoPlayTimer);
    autoPlayTimer = setInterval(nextSlide, 2600);
  }

  prevBtn.addEventListener('click', function () { prevSlide(); resetAutoPlay(); });
  nextBtn.addEventListener('click', function () { nextSlide(); resetAutoPlay(); });

  track.parentElement.addEventListener('mouseenter', function () { clearInterval(autoPlayTimer); });
  track.parentElement.addEventListener('mouseleave', function () { resetAutoPlay(); });

  track.addEventListener('touchstart', function (e) {
    touchStartX = e.touches[0].clientX;
    touchDeltaX = 0;
    track.style.transition = 'none';
  }, { passive: true });

  track.addEventListener('touchmove', function (e) {
    touchDeltaX = e.touches[0].clientX - touchStartX;
    var slideWidth = slides[0].getBoundingClientRect().width + 30;
    track.style.transform = 'translateX(-' + (currentIndex * slideWidth - touchDeltaX) + 'px)';
  }, { passive: true });

  track.addEventListener('touchend', function () {
    if (touchDeltaX > 56)       prevSlide();
    else if (touchDeltaX < -56) nextSlide();
    else                         updateCarousel();
    resetAutoPlay();
  });

  window.addEventListener('resize', function () {
    slides = Array.from(track.children);
    var max = getMaxIndex();
    if (currentIndex > max) currentIndex = max;
    renderDots();
    updateCarousel(false);
  });

  renderDots();
  updateCarousel(false);
  resetAutoPlay();
})();
