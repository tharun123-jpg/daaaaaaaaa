/* ==========================================================================
   ClipForge — small shared utilities
   ========================================================================== */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, k) => a + (b - a) * k;

export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

export function deepClone(value) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch { /* fall through */ }
  }
  return JSON.parse(JSON.stringify(value));
}

/** "00:04.21" — timecode with frames. */
export function fmtTimecode(seconds, fps = 30) {
  const s = Math.max(0, seconds);
  const totalFrames = Math.round(s * fps);
  const frames = totalFrames % Math.round(fps);
  const whole = Math.floor(totalFrames / fps);
  const hh = Math.floor(whole / 3600);
  const mm = Math.floor((whole % 3600) / 60);
  const ss = whole % 60;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const base = hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
  return `${base}.${pad(frames)}`;
}

/** "1:04" or "0:07.4" — compact duration for lists. */
export function fmtDuration(seconds) {
  if (!isFinite(seconds)) return '—';
  const s = Math.max(0, seconds);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  if (mm > 0) return `${mm}:${String(Math.floor(ss)).padStart(2, '0')}`;
  return `${ss.toFixed(1)}s`;
}

export function humanBytes(n) {
  if (!isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

export function roundToFrame(t, fps = 30) {
  return Math.round(t * fps) / fps;
}

export function debounce(fn, ms = 120) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function throttle(fn, ms = 60) {
  let last = 0;
  let queued = null;
  return (...args) => {
    const now = performance.now();
    if (now - last >= ms) { last = now; fn(...args); return; }
    clearTimeout(queued);
    queued = setTimeout(() => { last = performance.now(); fn(...args); }, ms - (now - last));
  };
}

/** Tiny DOM builder: el('div', { class: 'x', onclick: fn }, [child, 'text']) */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function pickFile({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    document.body.append(input);
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      input.remove();
      resolve(files);
    });
    // If the dialog is dismissed no event fires; clean up on next focus.
    window.addEventListener('focus', () => setTimeout(() => input.remove(), 500), { once: true });
    input.click();
  });
}

/** Deterministic-ish id for a file (name + size + lastModified). */
export function fileKey(file) {
  return `${file.name}::${file.size}::${file.lastModified || 0}`;
}

export function extOf(name = '') {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

export function kindFromName(name = '', mime = '') {
  const ext = extOf(name);
  if (mime.startsWith('video/') || ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv'].includes(ext)) return 'video';
  if (mime.startsWith('audio/') || ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac'].includes(ext)) return 'audio';
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'].includes(ext)) return 'image';
  return '';
}

export function isMediaFile(file) {
  return Boolean(kindFromName(file.name, file.type || ''));
}
