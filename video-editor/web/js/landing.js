// Landing page — light touches only (no framework).
// Adds "/projects" nav link target: the server renders the project list page,
// but if a visitor is offline we keep the link pointing at the editor instead.

const projectsLink = document.getElementById('navProjects');
const probe = await fetch('/api/projects', { method: 'GET' }).catch(() => null);
if (!probe || !probe.ok) {
  projectsLink?.setAttribute('href', '/editor');
}

// Smooth-scroll for in-page anchors (respects reduced motion).
for (const link of document.querySelectorAll('a[href^="#"]')) {
  link.addEventListener('click', (event) => {
    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  });
}

// Reveal sections on scroll. Content stays visible even if this never runs —
// the animation is additive, so the page is never blank.
const revealTargets = document.querySelectorAll('.card, .steps li, .fmt, .faq details');
const reveal = (node) => { node.style.animation = 'fade-up .6s ease both'; };
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          reveal(entry.target);
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );
  for (const node of revealTargets) observer.observe(node);
}
