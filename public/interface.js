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

const provider = document.querySelector('#provider');
const endpointGroup = document.querySelector('[data-compatible-endpoint]');
if (provider && endpointGroup) {
  const update = () => { endpointGroup.hidden = provider.value !== 'compatible'; };
  provider.addEventListener('change', update);
  update();
}
const mode = document.querySelector('#mode');
const intervalGroup = document.querySelector('[data-scheduled-interval]');
if (mode && intervalGroup) {
  const update = () => { intervalGroup.hidden = mode.value !== 'scheduled'; };
  mode.addEventListener('change', update);
  update();
}
document.querySelectorAll('[data-confirm]').forEach(button => {
  button.addEventListener('click', event => {
    if (!confirm(button.dataset.confirm)) event.preventDefault();
  });
});
