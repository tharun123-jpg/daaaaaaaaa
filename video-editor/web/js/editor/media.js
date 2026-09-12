/* ==========================================================================
   ClipForge — media import: probing, thumbnails, waveforms + media bin UI
   ========================================================================== */

import { $, el, uid, fmtDuration, humanBytes, kindFromName, isMediaFile, fileKey } from './utils.js';
import { store, addMedia, removeMedia } from './state.js';

const MAX_DECODE_BYTES = 64 * 1024 * 1024;   // don't decode huge files for peaks
const THUMB_W = 176;
const PEAK_BUCKETS = 900;

const CLIP_COLORS = [
  ['#7c5cff', '#5b46d6'], ['#22d3ee', '#0891b2'], ['#f472b6', '#db2777'],
  ['#fbbf24', '#f59e0b'], ['#34d399', '#059669'], ['#60a5fa', '#3b82f6'],
  ['#f87171', '#dc2626'], ['#a78bfa', '#7c3aed'],
];

let colorCursor = 0;
function nextColor() {
  return CLIP_COLORS[colorCursor++ % CLIP_COLORS.length];
}

/* ------------------------------------------------------------- audio ctx */

let decodeCtx = null;
export function getDecodeContext() {
  if (!decodeCtx) {
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    decodeCtx = Ctx ? new Ctx(1, 1, 44100) : new (window.AudioContext || window.webkitAudioContext)();
  }
  return decodeCtx;
}

/* ------------------------------------------------------------- probing */

function loadElement(url, kind) {
  const node = document.createElement(kind === 'audio' ? 'audio' : 'video');
  node.preload = 'metadata';
  node.src = url;
  node.muted = true;
  node.crossOrigin = 'anonymous';
  return node;
}

function waitEvent(node, ok, fail = ['error', 'stalled']) {
  return new Promise((resolve, reject) => {
    const clean = () => { ok.forEach((e) => node.removeEventListener(e, onOk)); fail.forEach((e) => node.removeEventListener(e, onFail)); };
    const onOk = () => { clean(); resolve(node); };
    const onFail = () => { clean(); reject(new Error('media load failed')); };
    ok.forEach((e) => node.addEventListener(e, onOk, { once: true }));
    fail.forEach((e) => node.addEventListener(e, onFail, { once: true }));
  });
}

/** Duration + intrinsic size for a video/audio URL. */
export async function probeMedia(url, kind) {
  const node = loadElement(url, kind);
  if (kind === 'image') {
    const img = new Image();
    img.src = url;
    await waitEvent(img, ['load']);
    return { duration: 0, width: img.naturalWidth || 1280, height: img.naturalHeight || 720 };
  }
  await waitEvent(node, ['loadedmetadata']);
  let duration = node.duration;
  if (!isFinite(duration) || duration <= 0) {
    // Some WebM/MKV blobs report Infinity until you seek far ahead.
    duration = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(0), 2500);
      node.addEventListener('durationchange', () => {
        if (isFinite(node.duration) && node.duration > 0) { clearTimeout(timer); resolve(node.duration); }
      });
      node.currentTime = 1e6;
    });
    node.currentTime = 0;
  }
  const info = {
    duration: isFinite(duration) && duration > 0 ? duration : 0,
    width: node.videoWidth || 0,
    height: node.videoHeight || 0,
  };
  node.src = '';
  return info;
}

/* ------------------------------------------------------------- thumbnails */

export async function makeThumbnail(url, kind, duration = 0) {
  const canvas = document.createElement('canvas');
  const W = THUMB_W;
  const H = Math.round((W * 9) / 16);
  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0d1224';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  try {
    if (kind === 'image') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      await waitEvent(img, ['load']);
      drawContain(ctx, img, canvas.width, canvas.height);
    } else if (kind === 'video') {
      const node = loadElement(url, 'video');
      await waitEvent(node, ['loadeddata']);
      const at = duration > 1 ? Math.min(duration * 0.25, 3) : 0;
      if (at > 0) {
        await new Promise((resolve) => {
          const onSeeked = () => { node.removeEventListener('seeked', onSeeked); resolve(); };
          node.addEventListener('seeked', onSeeked);
          setTimeout(() => { node.removeEventListener('seeked', onSeeked); resolve(); }, 2500);
          node.currentTime = at;
        });
      }
      drawContain(ctx, node, canvas.width, canvas.height);
      node.src = '';
    } else {
      // audio: waveform placeholder
      ctx.fillStyle = '#101528';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  } catch {
    ctx.fillStyle = '#141a30';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas.toDataURL('image/jpeg', 0.72);
}

function drawContain(ctx, source, W, H) {
  const sw = source.videoWidth || source.naturalWidth || W;
  const sh = source.videoHeight || source.naturalHeight || H;
  const scale = Math.min(W / sw, H / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(source, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

/* ------------------------------------------------------------- peaks */

export async function makePeaks(url, buckets = PEAK_BUCKETS) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    if (blob.size > MAX_DECODE_BYTES) return null;
    const buffer = await blob.arrayBuffer();
    const ctx = getDecodeContext();
    const audio = await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(buffer.slice(0), resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
    const channel = audio.getChannelData(0);
    const step = Math.max(1, Math.floor(channel.length / buckets));
    const peaks = new Float32Array(buckets * 2);
    for (let i = 0; i < buckets; i++) {
      let min = 1;
      let max = -1;
      const from = i * step;
      for (let j = 0; j < step; j += 8) {
        const v = channel[from + j] || 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      peaks[i * 2] = min;
      peaks[i * 2 + 1] = max;
    }
    return peaks;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- import */

const inflight = new Map();

export async function mediaFromFile(file, { quiet = false } = {}) {
  const key = fileKey(file);
  if (inflight.has(key)) return inflight.get(key);
  const kind = kindFromName(file.name, file.type || '');
  if (!kind) {
    if (!quiet) store.setStatus(`Skipped unsupported file: ${file.name}`, 'warn');
    return null;
  }
  const promise = (async () => {
    const url = URL.createObjectURL(file);
    let info = { duration: 0, width: 0, height: 0 };
    try {
      info = await probeMedia(url, kind);
    } catch (err) {
      console.warn('probe failed', file.name, err);
    }
    const [thumb, peaks] = await Promise.all([
      makeThumbnail(url, kind, info.duration),
      kind === 'image' ? Promise.resolve(null) : makePeaks(url),
    ]);
    const [c1, c2] = nextColor();
    return {
      id: uid('med'),
      name: file.name,
      kind,
      size: file.size,
      mime: file.type || '',
      file,
      url,
      duration: info.duration || (kind === 'image' ? 0 : 0),
      width: info.width,
      height: info.height,
      thumb,
      peaks,
      color: c1,
      color2: c2,
      persisted: false,
      serverUrl: null,
      key,
    };
  })().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** Media object backed by a URL on our own server (project re-open). */
export async function mediaFromServer(entry) {
  const kind = entry.kind || kindFromName(entry.name) || 'video';
  let info = { duration: 0, width: 0, height: 0 };
  try {
    info = await probeMedia(entry.url, kind === 'file' ? 'video' : kind);
  } catch (err) {
    console.warn('server media probe failed', entry.url, err);
  }
  const [thumb, peaks] = await Promise.all([
    makeThumbnail(entry.url, kind, info.duration),
    kind === 'video' || kind === 'audio' ? makePeaks(entry.url) : Promise.resolve(null),
  ]);
  const [c1, c2] = nextColor();
  return {
    id: uid('med'),
    name: entry.name,
    kind,
    size: entry.size || 0,
    mime: '',
    file: null,
    url: entry.url,
    duration: info.duration || entry.duration || 0,
    width: info.width || entry.width || 0,
    height: info.height || entry.height || 0,
    thumb,
    peaks,
    color: c1,
    color2: c2,
    persisted: true,
    serverUrl: entry.url,
    key: entry.name,
  };
}

/** Import a FileList: probe everything, add to the bin, optionally place on the timeline. */
export async function importFiles(files, { addToTimeline = false, trackId = null } = {}) {
  const list = Array.from(files).filter(isMediaFile);
  if (!list.length) {
    store.setStatus('No supported media in that drop', 'warn');
    return [];
  }
  store.setStatus(`Reading ${list.length} file${list.length > 1 ? 's' : ''}…`);
  const created = [];
  for (const file of list) {
    const media = await mediaFromFile(file);
    if (!media) continue;
    const duplicate = Array.from(store.media.values()).find((m) => m.key === media.key);
    if (duplicate) {
      created.push(duplicate);
      continue;
    }
    addMedia(media);
    created.push(media);
  }
  store.setStatus(`Imported ${created.length} file${created.length > 1 ? 's' : ''}`);
  if (addToTimeline && created.length) {
    const { placeMediaOnTimeline } = await import('./placement.js');
    for (const media of created) placeMediaOnTimeline(media, { trackId });
  }
  return created;
}

/* ------------------------------------------------------------- media bin UI */

export function mountMediaBin({ onAdd, onAddAll }) {
  const list = $('#mediaList');
  const empty = $('#mediaEmpty');
  const input = $('#fileInput');
  const dropzone = $('#dropZone');

  dropzone?.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    input.click();
  });
  input?.addEventListener('change', async () => {
    await importFiles(input.files);
    input.value = '';
  });

  dropzone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('active');
  });
  dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('active'));
  dropzone?.addEventListener('drop', async (event) => {
    event.preventDefault();
    dropzone.classList.remove('active');
    if (event.dataTransfer?.files?.length) await importFiles(event.dataTransfer.files);
  });

  function render() {
    const items = Array.from(store.media.values());
    list.innerHTML = '';
    empty.hidden = items.length > 0;
    for (const media of items) {
      const card = el('div', {
        class: 'media-card',
        draggable: 'true',
        title: `${media.name}\n${media.kind} · ${humanBytes(media.size)}${media.duration ? ` · ${fmtDuration(media.duration)}` : ''}`,
        dataset: { mediaId: media.id },
      }, [
        el('div', { class: 'media-thumb', style: { backgroundImage: `url(${media.thumb})` } }, [
          el('span', { class: 'media-kind', text: media.kind === 'video' ? '▶' : media.kind === 'audio' ? '♪' : '▣' }),
        ]),
        el('div', { class: 'media-meta' }, [
          el('strong', { class: 'media-name', text: media.name }),
          el('span', { class: 'media-sub', text: `${fmtDuration(media.duration)}${media.width ? ` · ${media.width}×${media.height}` : ''}` }),
        ]),
        el('div', { class: 'media-actions' }, [
          el('button', {
            class: 'icon-btn tiny', title: 'Add to timeline', html: '＋',
            onclick: (event) => { event.stopPropagation(); onAdd?.(media); },
          }),
          el('button', {
            class: 'icon-btn tiny danger', title: 'Remove from bin', html: '✕',
            onclick: (event) => { event.stopPropagation(); removeMedia(media.id); },
          }),
        ]),
      ]);

      card.addEventListener('dblclick', () => onAdd?.(media));
      card.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('application/x-clipforge-media', media.id);
        event.dataTransfer.setData('text/plain', media.name);
        event.dataTransfer.effectAllowed = 'copy';
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      list.append(card);
    }
    const info = $('#mediaInfo');
    if (info) {
      const total = items.reduce((sum, m) => sum + (m.size || 0), 0);
      info.textContent = items.length
        ? `${items.length} item${items.length > 1 ? 's' : ''} · ${humanBytes(total)}`
        : 'Nothing imported yet';
    }
  }

  const addAll = $('#btnAddAllMedia');
  addAll?.addEventListener('click', () => onAddAll?.());

  store.on('media', render);
  render();
  return { render };
}
