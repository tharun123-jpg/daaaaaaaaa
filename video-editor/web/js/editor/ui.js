/* ==========================================================================
   ClipForge — toast, modal and floating progress-card helpers
   ========================================================================== */

import { $, el } from './utils.js';

export function toast(message, { kind = 'info', timeout = 2800, actions = null } = {}) {
  const host = $('#toasts');
  if (!host) return null;
  const node = el('div', { class: `toast toast-${kind}` }, [
    el('span', { class: 'toast-msg', text: message }),
    actions ? el('div', { class: 'toast-actions' }, actions.map((action) => el('button', {
      class: 'toast-btn', text: action.label,
      onclick: () => { action.onClick?.(); dismiss(); },
    }))) : null,
  ]);
  host.append(node);
  let timer = timeout ? setTimeout(dismiss, timeout) : 0;
  function dismiss() {
    clearTimeout(timer);
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 220);
  }
  node.addEventListener('click', (event) => {
    if (!event.target.closest('.toast-btn')) dismiss();
  });
  return { dismiss };
}

export function openModal({ title, body, actions = [], width = 520, onClose = null, className = '' }) {
  const root = $('#modalRoot');
  root.hidden = false;
  root.innerHTML = '';

  const close = () => {
    root.hidden = true;
    root.innerHTML = '';
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const card = el('div', { class: `modal ${className}`.trim(), style: { maxWidth: `${width}px` } }, [
    el('header', { class: 'modal-head' }, [
      el('h3', { text: title }),
      el('button', { class: 'icon-btn', title: 'Close', html: '✕', onclick: close }),
    ]),
    el('div', { class: 'modal-body' }, [body]),
    actions.length ? el('footer', { class: 'modal-foot' }, actions.map((action) => el('button', {
      class: `btn ${action.primary ? 'btn-primary' : action.danger ? 'btn-danger' : ''}`.trim(),
      text: action.label,
      onclick: () => action.onClick?.(close),
    }))) : null,
  ]);

  root.append(card);
  root.onclick = (event) => { if (event.target === root) close(); };
  return { close, card };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value, close) => { settled = true; close(); resolve(value); };
    const modal = openModal({
      title,
      width: 420,
      body: el('p', { class: 'modal-text', text: message }),
      actions: [
        { label: 'Cancel', onClick: (close) => finish(false, close) },
        { label: confirmLabel, primary: !danger, danger, onClick: (close) => finish(true, close) },
      ],
      onClose: () => { if (!settled) resolve(false); },
    });
    void modal;
  });
}

/** Small floating progress panel (non-blocking, keeps the preview visible). */
export function progressCard({ title = 'Working…', icon = '⚙' } = {}) {
  const host = $('#progressHost');
  host.hidden = false;
  host.innerHTML = '';
  const bar = el('i', { style: { width: '0%' } });
  const label = el('span', { class: 'pc-status', text: 'Starting…' });
  const pct = el('span', { class: 'pc-pct', text: '0%' });
  const actions = el('div', { class: 'pc-actions' });
  const card = el('div', { class: 'progress-card' }, [
    el('div', { class: 'pc-head' }, [
      el('span', { class: 'pc-icon', text: icon }),
      el('strong', { text: title }),
      pct,
    ]),
    el('div', { class: 'pc-bar' }, [bar]),
    label,
    actions,
  ]);
  host.append(card);

  const api = {
    update(value, text) {
      const v = Math.max(0, Math.min(100, value));
      bar.style.width = `${v}%`;
      pct.textContent = `${Math.round(v)}%`;
      if (text) label.textContent = text;
    },
    status(text) { label.textContent = text; },
    setActions(items) {
      actions.innerHTML = '';
      for (const item of items) {
        actions.append(el('button', {
          class: `btn btn-sm ${item.primary ? 'btn-primary' : item.danger ? 'btn-danger' : ''}`.trim(),
          text: item.label,
          onclick: () => item.onClick?.(api),
        }));
      }
    },
    close() {
      host.hidden = true;
      host.innerHTML = '';
    },
  };
  return api;
}

export function field(label, control, hint) {
  return el('div', { class: 'form-row' }, [
    el('label', { text: label }),
    control,
    hint ? el('small', { class: 'form-hint', text: hint }) : null,
  ]);
}
