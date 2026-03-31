/* =========================================================
   Kali MCP WebUI — script.js
   Features: navbar scroll, mobile menu, smooth scroll,
             copy-to-clipboard, screenshot modal, scroll reveal
========================================================= */

// ── Year ──────────────────────────────────────────────────
document.getElementById('footerYear').textContent = new Date().getFullYear();

// ── Navbar scroll effect ──────────────────────────────────
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 40);
}, { passive: true });

// ── Mobile nav toggle ─────────────────────────────────────
const navToggle = document.getElementById('navToggle');
const navLinks  = document.getElementById('navLinks');

navToggle.addEventListener('click', () => {
  navLinks.classList.toggle('open');
});

// Close menu when a link is clicked
navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => navLinks.classList.remove('open'));
});

// ── Smooth scroll for anchor links ───────────────────────
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', e => {
    const target = document.querySelector(anchor.getAttribute('href'));
    if (target) {
      e.preventDefault();
      const offset = 68; // nav height
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  });
});

// ── Copy-to-clipboard buttons ─────────────────────────────
document.querySelectorAll('.copy-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const text = btn.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Copy';
        btn.classList.remove('copied');
      }, 2000);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    }
  });
});

// ── Screenshot modal ─────────────────────────────────────
const modal         = document.getElementById('ssModal');
const modalImg      = document.getElementById('ssModalImg');
const modalCaption  = document.getElementById('ssModalCaption');
const modalClose    = document.getElementById('ssModalClose');
const modalBackdrop = document.getElementById('ssModalBackdrop');

function openModal(img, caption) {
  modalImg.src     = img;
  modalImg.alt     = caption;
  modalCaption.textContent = caption;
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  modal.classList.remove('active');
  document.body.style.overflow = '';
  setTimeout(() => { modalImg.src = ''; }, 300);
}

document.querySelectorAll('.screenshot-card').forEach(card => {
  card.addEventListener('click', () => {
    const img     = card.querySelector('img');
    const caption = card.dataset.caption || '';
    if (img) openModal(img.src, caption);
    // If placeholder (no img), do nothing
  });
});

modalClose.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// ── Scroll-reveal ─────────────────────────────────────────
const revealTargets = [
  '.section-label',
  '.section-title',
  '.section-desc',
  '.about-text p',
  '.callout',
  '.feature-card',
  '.arch-layer',
  '.install-step',
  '.team-card',
  '.contact-box',
  '.req-box',
  '.hero-badge',
  '.hero-sub',
  '.hero-cta',
  '.hero-stats',
];

revealTargets.forEach(selector => {
  document.querySelectorAll(selector).forEach((el, i) => {
    el.classList.add('reveal');
    el.style.transitionDelay = `${i * 60}ms`;
  });
});

const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

// ── Active nav highlighting ───────────────────────────────
const sections = document.querySelectorAll('section[id]');
const navAnchors = document.querySelectorAll('.nav-links a[href^="#"]');

const sectionObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const id = entry.target.id;
      navAnchors.forEach(a => {
        a.style.color = a.getAttribute('href') === `#${id}` ? 'var(--accent)' : '';
      });
    }
  });
}, { threshold: 0.3 });

sections.forEach(s => sectionObserver.observe(s));

// ── Terminal typing animation (subtle enhancement) ────────
// The terminal is pre-populated in HTML; this just adds a
// slow flicker to make it feel alive.
const termLines = document.querySelectorAll('.t-line');
termLines.forEach((line, i) => {
  line.style.opacity = '0';
  line.style.transition = 'opacity 0.3s ease';
  setTimeout(() => { line.style.opacity = '1'; }, 800 + i * 180);
});
