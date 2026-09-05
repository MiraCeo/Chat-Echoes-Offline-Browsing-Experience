const host = document.querySelector('[data-side-pane-shell-host]');
const dock = host?.lastElementChild;
let opener;
let citationTrigger;
let modal;

function closePreview() {
  if (!dock) return;
  if (modal) { modal.close(); modal.remove(); modal = null; }
  dock.replaceChildren();
  dock.classList.remove('ceobe-preview-dock');
  dock.style.width = '0px';
  host.removeAttribute('data-side-pane-shell-open');
  citationTrigger?.setAttribute('aria-expanded', 'false');
  citationTrigger?.setAttribute('data-state', 'closed');
  opener?.focus({ preventScroll: true });
}

document.addEventListener('click', event => {
  const close = event.target.closest('[data-ceobe-close-preview]');
  if (close) { closePreview(); return; }
  const trigger = event.target.closest('[data-ceobe-open-preview]');
  if (trigger && dock) {
    const template = [...document.querySelectorAll('template[data-ceobe-preview]')]
      .find(t => t.dataset.ceobePreview === trigger.dataset.ceobeOpenPreview);
    if (!template) return;
    event.preventDefault();
    citationTrigger?.setAttribute('aria-expanded', 'false');
    citationTrigger?.setAttribute('data-state', 'closed');
    citationTrigger = trigger.matches('[data-file-citation-primary-file-id]') ? trigger : null;
    citationTrigger?.setAttribute('aria-expanded', 'true');
    citationTrigger?.setAttribute('data-state', 'open');
    opener = trigger.matches('button') ? trigger : trigger.querySelector('button');
    if (trigger.dataset.ceobeOpenPreview === 'pasted') {
      if (modal) { modal.close(); modal.remove(); }
      modal = document.createElement('dialog');
      modal.className = 'ceobe-pasted-dialog';
      modal.append(template.content.cloneNode(true));
      const heading = modal.querySelector('h2');
      if (heading) { heading.id = 'ceobe-pasted-heading'; modal.setAttribute('aria-labelledby', heading.id); }
      modal.addEventListener('cancel', event => { event.preventDefault(); closePreview(); });
      document.body.append(modal);
      modal.showModal();
      modal.querySelector('[data-ceobe-close-preview]')?.focus({ preventScroll: true });
      return;
    }
    dock.replaceChildren(template.content.cloneNode(true));
    dock.style.removeProperty('width');
    dock.classList.add('ceobe-preview-dock');
    host.setAttribute('data-side-pane-shell-open', '');
    dock.querySelector('[data-ceobe-close-preview]')?.focus({ preventScroll: true });
    return;
  }
  const tab = event.target.closest('[data-ceobe-sheet-tab]');
  if (tab && dock?.contains(tab)) {
    for (const sheet of dock.querySelectorAll('[data-ceobe-sheet]')) sheet.hidden = sheet.dataset.ceobeSheet !== tab.dataset.ceobeSheetTab;
    for (const button of dock.querySelectorAll('[data-ceobe-sheet-tab]')) {
      const selected = button === tab;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('text-token-text-primary', selected);
      button.classList.toggle('text-token-text-secondary', !selected);
      button.firstElementChild?.classList.toggle('bg-[var(--app-shell-tab-background)]', selected);
    }
    const viewport = dock.querySelector('[data-testid="popcorn-viewport-host"]');
    if (viewport) viewport.scrollTo(0, 0);
    const selectedSheet = dock.querySelector('[data-ceobe-sheet]:not([hidden])');
    const formula = dock.querySelector('[data-testid="popcorn-formula-input"]');
    if (formula) formula.value = selectedSheet?.querySelector('tbody td')?.textContent || '';
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && (modal || host?.hasAttribute('data-side-pane-shell-open'))) {
    event.preventDefault(); closePreview();
  }
});
