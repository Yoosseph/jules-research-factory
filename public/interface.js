const motionAllowed = !matchMedia('(prefers-reduced-motion: reduce)').matches;
if (motionAllowed && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      entry.target.classList.add('revealed');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.08 });
  document.querySelectorAll('.reveal').forEach((element, index) => {
    element.classList.add('reveal-pending');
    element.style.setProperty('--reveal-delay', `${Math.min(index % 3, 2) * 100}ms`);
    observer.observe(element);
  });
}

function toggleFieldGroup(selectSelector, groupSelector, visibleValue) {
  const select = document.querySelector(selectSelector);
  const group = document.querySelector(groupSelector);
  if (!select || !group) return;
  const update = () => { group.hidden = select.value !== visibleValue; };
  select.addEventListener('change', update);
  update();
}

toggleFieldGroup('#provider', '[data-compatible-endpoint]', 'compatible');
toggleFieldGroup('#mode', '[data-scheduled-interval]', 'scheduled');
document.querySelectorAll('[data-confirm]').forEach(button => {
  button.addEventListener('click', event => {
    if (!confirm(button.dataset.confirm)) event.preventDefault();
  });
});
