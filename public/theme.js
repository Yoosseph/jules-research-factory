(() => {
  const preference = matchMedia('(prefers-color-scheme: dark)');
  let saved;
  try { saved = localStorage.getItem('research-facility-theme'); } catch { /* Private browsing may restrict storage. */ }
  const preferredTheme = () => saved === 'dark' || saved === 'light' ? saved : preference.matches ? 'dark' : 'light';
  const apply = theme => {
    document.documentElement.dataset.theme = theme;
    const button = document.querySelector('[data-theme-toggle]');
    if (button) { button.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`); button.setAttribute('aria-pressed', String(theme === 'dark')); button.title = button.getAttribute('aria-label'); }
    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon) favicon.href = theme === 'dark' ? '/favicon-dark.svg' : '/favicon.svg';
  };
  apply(preferredTheme());
  document.addEventListener('DOMContentLoaded', () => {
    apply(document.documentElement.dataset.theme);
    document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
      saved = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('research-facility-theme', saved); } catch { /* The switch still works without persistent storage. */ }
      apply(saved);
    });
  });
  preference.addEventListener('change', event => { if (!saved) apply(event.matches ? 'dark' : 'light'); });
  addEventListener('storage', event => { if (event.key === 'research-facility-theme') { saved = event.newValue; apply(preferredTheme()); } });
})();
