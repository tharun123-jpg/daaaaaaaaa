/* ==========================================================================
   ClipForge — editor bootstrap: wires the DOM, store, player and panels
   ========================================================================== */

import { $, $$, el, clamp, debounce, fmtTimecode, fmtDuration, humanBytes, pickFile, isMediaFile } from './utils.js';
import {
  store, history, ASPECTS, TITLE_PRESETS, addTrack, removeSelected, duplicateClip,
  splitSelectionAt, allClips, projectDuration, findClip, selectedClips,
  clipsAt, mediaById, updateClip,
} from './state.js';
import { Renderer } from './renderer.js';
import { Player } from './player.js';
import { mountTimeline } from './timeline.js';
import { mountInspector } from './inspector.js';
import { mountMediaBin, importFiles, mediaFromFile } from './media.js';
import { mountExport } from './export.js';
import { mountLibrary } from './library.js';
import { placeMediaOnTimeline, placeTextClip, addAllMediaToTimeline } from './placement.js';
import {
  saveToFile, openFromFile, saveOnline, loadOnlineProject, listOnlineProjects,
  exportJsonOnly, markDirty, newProject, readAutosave, clearAutosave,
} from './storage.js';
import { toast, openModal, progressCard } from './ui.js';

/* ------------------------------------------------------------- bootstrap */

const canvas = $('#preview');
const renderer = new Renderer(canvas, $('#mediaPool'));
const player = new Player(renderer);

const timeline = mountTimeline({ onSeek: (t) => player.seek(t) });
const inspector = mountInspector({ player, onChanged: () => { timeline.refresh(); refreshStats(); } });
mountMediaBin({
  onAdd: (media) => placeMediaOnTimeline(media, { at: store.t, append: false }),
  onAddAll: () => addAllMediaToTimeline(),
});
mountExport({ player, renderer, onFinished: () => refreshStats() });
mountLibrary({ onChanged: () => { timeline.refresh(); refreshStats(); } });

store.on('status', ({ message, kind }) => {
  const node = $('#statusMessage');
  node.textContent = message;
  node.classList.toggle('warn', kind === 'warn');
});

/* ----------------------------------------------------------------- stage */

function syncCanvas() {
  const { width, height } = store.project.settings;
  renderer.setSize(width, height);
  renderer.bg = store.project.settings.bg || '#000000';
  player.renderOnce();
}

function refreshEmptyState() {
  const hasClips = allClips().length > 0;
  $('#stageEmpty').classList.toggle('hidden', hasClips);
}

function buildAspectOptions() {
  const options = ASPECTS.map((a) => el('option', { value: a.id, text: a.label }));
  const inline = $('#aspectSelect');
  const inPanel = $('#projAspect');
  inline.innerHTML = '';
  inPanel.innerHTML = '';
  options.forEach((option) => {
    inline.append(option.cloneNode(true));
    inPanel.append(option);
  });
}

function syncSettingsInputs() {
  const s = store.project.settings;
  $('#aspectSelect').value = s.aspect;
  $('#projAspect').value = s.aspect;
  $('#projFps').value = String(s.fps);
  $('#projBg').value = s.bg || '#000000';
  $('#projVolume').value = String(s.masterVolume ?? 1);
  $('#masterVolume').value = String(s.masterVolume ?? 1);
  $('#projectName').value = store.project.name;
  $('#projName').value = store.project.name;
}

function setAspect(aspectId) {
  const aspect = ASPECTS.find((a) => a.id === aspectId);
  if (!aspect) return;
  history.do(`Canvas ${aspect.id}`, () => {
    store.project.settings.aspect = aspect.id;
    store.project.settings.width = aspect.width;
    store.project.settings.height = aspect.height;
  });
  syncCanvas();
  syncSettingsInputs();
}

$('#aspectSelect').addEventListener('change', (event) => setAspect(event.target.value));
$('#projAspect').addEventListener('change', (event) => setAspect(event.target.value));
$('#projFps').addEventListener('change', (event) => {
  history.do('Frame rate', () => { store.project.settings.fps = Number(event.target.value); });
  player.renderOnce();
});
$('#projBg').addEventListener('input', (event) => {
  store.project.settings.bg = event.target.value;
  renderer.bg = event.target.value;
  player.requestRender();
});
$('#projBg').addEventListener('change', () => history.commit('Background colour', null));
$('#projVolume').addEventListener('input', (event) => {
  const value = Number(event.target.value);
  store.project.settings.masterVolume = value;
  renderer.setMasterVolume(value);
  $('#masterVolume').value = String(value);
});
$('#masterVolume').addEventListener('input', (event) => {
  const value = Number(event.target.value);
  store.project.settings.masterVolume = value;
  renderer.setMasterVolume(value);
});

$('#fitSelect').addEventListener('change', (event) => {
  $('#previewArea').dataset.fit = event.target.value;
});
$('#btnFullscreen').addEventListener('click', () => {
  const area = $('#previewArea');
  if (document.fullscreenElement) document.exitFullscreen();
  else area.requestFullscreen?.().catch(() => toast('Fullscreen was blocked', { kind: 'warn' }));
});
$('#btnStageImport').addEventListener('click', () => $('#fileInput').click());

/* ------------------------------------------------------------ transport */

$('#btnPlay').addEventListener('click', () => player.toggle());
$('#btnPrevFrame').addEventListener('click', () => player.stepFrame(-1));
$('#btnNextFrame').addEventListener('click', () => player.stepFrame(1));
$('#btnJumpStart').addEventListener('click', () => player.seek(0));
$('#btnJumpEnd').addEventListener('click', () => player.seek(projectDuration()));
$('#rateSelect').addEventListener('change', (event) => { store.rate = Number(event.target.value); });
$('#btnLoop').addEventListener('click', (event) => {
  store.loop = !store.loop;
  event.currentTarget.classList.toggle('active', store.loop);
  store.setStatus(`Loop ${store.loop ? 'on' : 'off'}`);
});
$('#btnMute').addEventListener('click', (event) => {
  renderer.resumeAudio();
  renderer.setListen(!renderer.listen);
  event.currentTarget.textContent = renderer.listen ? '🔊' : '🔇';
  event.currentTarget.classList.toggle('active', !renderer.listen);
});

store.on('playing', ({ playing }) => {
  const button = $('#btnPlay');
  button.textContent = playing ? '⏸' : '▶';
  button.classList.toggle('playing', playing);
});

store.on('time', () => {
  $('#timeCurrent').textContent = fmtTimecode(store.t, store.project.settings.fps);
});

/* --------------------------------------------------------------- topbar */

$('#btnUndo').addEventListener('click', () => { history.undo(); timeline.refresh(); });
$('#btnRedo').addEventListener('click', () => { history.redo(); timeline.refresh(); });
store.on('history', ({ canUndo, canRedo }) => {
  $('#btnUndo').disabled = !canUndo;
  $('#btnRedo').disabled = !canRedo;
});
$('#btnUndo').disabled = true;
$('#btnRedo').disabled = true;

$('#btnNew').addEventListener('click', () => {
  if (!newProject()) return;
  syncCanvas();
  syncSettingsInputs();
  timeline.refresh();
  refreshStats();
  refreshEmptyState();
});

$('#btnOpenFile').addEventListener('click', async () => {
  const [file] = await pickFile({ accept: '.zip,.json,application/zip,application/json' });
  if (!file) return;
  try {
    await openFromFile(file);
    syncCanvas();
    syncSettingsInputs();
    timeline.refresh();
    refreshStats();
    refreshEmptyState();
    markDirty(false);
  } catch (err) {
    console.error(err);
    toast(`Could not open that project: ${err.message}`, { kind: 'warn', timeout: 5000 });
  }
});

$('#btnSaveFile').addEventListener('click', async () => {
  try {
    const card = progressCard({ title: 'Packing project', icon: '💾' });
    card.update(10, 'Collecting media…');
    await saveToFile();
    card.close();
  } catch (err) {
    console.error(err);
    toast(`Save failed: ${err.message}`, { kind: 'warn', timeout: 5000 });
  }
});

async function doSaveOnline() {
  const card = progressCard({ title: 'Saving online', icon: '☁' });
  try {
    card.update(5, 'Uploading media…');
    const id = await saveOnline();
    card.update(100, 'Saved');
    card.setActions([{ label: 'Close', onClick: (api) => api.close() }]);
    setTimeout(() => card.close(), 2500);
    return id;
  } catch (err) {
    card.close();
    toast(`Could not save online: ${err.message}`, { kind: 'warn', timeout: 5000 });
    return null;
  }
}
$('#btnSaveOnline').addEventListener('click', doSaveOnline);
$('#btnSaveOnline2').addEventListener('click', doSaveOnline);
$('#btnSaveJson').addEventListener('click', () => exportJsonOnly());

$('#btnLoadFromServer').addEventListener('click', async () => {
  try {
    const projects = await listOnlineProjects();
    const body = projects.length
      ? el('div', { class: 'guide-list' }, projects.map((project) => el('button', {
          class: 'btn',
          style: { justifyContent: 'space-between' },
          onclick: async () => {
            try {
              await loadOnlineProject(project.id);
              syncCanvas();
              syncSettingsInputs();
              timeline.refresh();
              refreshStats();
              refreshEmptyState();
              markDirty(false);
              modal.close();
              toast(`Opened “${project.name}”`, { kind: 'success' });
            } catch (err) {
              toast(err.message, { kind: 'warn' });
            }
          },
        }, [
          el('span', { text: project.name }),
          el('span', { class: 'muted small', text: `${project.clips} clips · ${fmtDuration(project.duration)} · ${new Date(project.updatedAt).toLocaleString()}` }),
        ])))
      : el('p', { class: 'modal-text', text: 'No saved projects yet. Use “Save online” to store this project on the server.' });
    const modal = openModal({ title: 'Open a saved project', body, width: 560 });
  } catch (err) {
    toast(err.message, { kind: 'warn' });
  }
});

$('#projectName').addEventListener('input', (event) => {
  store.project.name = event.target.value;
  $('#projName').value = event.target.value;
  markDirty(true);
});
$('#projName').addEventListener('input', (event) => {
  store.project.name = event.target.value;
  $('#projectName').value = event.target.value;
  markDirty(true);
});

/* --------------------------------------------------------- project pane */

$('#btnAddVideoTrack').addEventListener('click', () => addTrack('video'));
$('#btnAddTextTrack').addEventListener('click', () => addTrack('text'));
$('#btnClearTimeline').addEventListener('click', () => {
  if (!allClips().length) return;
  if (!window.confirm('Remove every clip from the timeline? (Undo still works)')) return;
  history.do('Clear timeline', () => {
    for (const track of store.project.tracks) track.clips = [];
    store.selection.clear();
  });
  store.emit('project', { reason: 'clear' });
});

function refreshStats() {
  const clips = allClips();
  const duration = projectDuration();
  const size = Array.from(store.media.values()).reduce((sum, m) => sum + (m.size || 0), 0);
  const grid = $('#projStats');
  if (grid) {
    grid.innerHTML = '';
    const cells = [
      ['Clips', String(clips.length)],
      ['Duration', fmtDuration(duration)],
      ['Tracks', String(store.project.tracks.length)],
      ['Media', `${store.media.size} · ${humanBytes(size)}`],
    ];
    for (const [label, value] of cells) {
      grid.append(el('div', { class: 'stat-cell' }, [el('b', { text: value }), el('span', { text: label })]));
    }
  }
  const status = $('#statusStats');
  if (status) {
    status.textContent = `${clips.length} clips · ${fmtDuration(duration)} · ${store.project.settings.width}×${store.project.settings.height} · ${store.project.settings.fps}fps`;
  }
  $('#timeTotal').textContent = fmtTimecode(duration, store.project.settings.fps);
  refreshEmptyState();
}

/* --------------------------------------------------------- left panels */

// generic tab groups: any .tabs inside a .panel switches that panel's panes
for (const tabs of $$('.tabs')) {
  tabs.addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (!tab) return;
    const panel = tabs.closest('.panel') || document;
    $$('.tab', tabs).forEach((node) => node.classList.toggle('active', node === tab));
    $$('.tab-pane', panel).forEach((pane) => {
      pane.classList.toggle('active', pane.id === `tab-${tab.dataset.tab}`);
    });
  });
}

function renderTitlePresets() {
  const host = $('#titlePresets');
  host.innerHTML = '';
  for (const preset of TITLE_PRESETS) {
    host.append(el('div', {
      class: `title-preset t-${preset.id}`,
      title: `Add “${preset.text}” at the playhead`,
      onclick: () => { placeTextClip(preset, { at: store.t }); timeline.refresh(); refreshStats(); },
    }, [el('span', { text: preset.text })]));
  }
}

$('#btnImportAudio')?.addEventListener('click', async () => {
  const files = await pickFile({ accept: 'audio/*', multiple: true });
  if (!files.length) return;
  const created = await importFiles(files);
  let cursor = store.t;
  const { placeMediaOnTimeline: place } = await import('./placement.js');
  for (const media of created) {
    const clip = place(media, { at: cursor, append: false });
    cursor += clip?.duration || 0;
  }
  timeline.refresh();
  refreshStats();
});

/* ------------------------------------------------- generated music bed */

function encodeWav(samples, sampleRate = 44100) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = clamp(samples[i], -1, 1);
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function makeMusicBed(seconds = 24, sampleRate = 44100) {
  const total = Math.floor(seconds * sampleRate);
  const samples = new Float32Array(total);
  const chords = [
    [220.0, 261.63, 329.63],   // Am
    [174.61, 220.0, 261.63],   // F
    [196.0, 246.94, 293.66],   // G
    [130.81, 164.81, 196.0],   // C
  ];
  const barLength = seconds / 8;
  for (let i = 0; i < total; i++) {
    const t = i / sampleRate;
    const bar = Math.floor(t / barLength) % chords.length;
    const localT = t % barLength;
    const env = Math.min(1, localT / 0.35) * Math.exp(-localT * 0.55) * 0.8 + 0.14;
    let value = 0;
    for (let v = 0; v < chords[bar].length; v++) {
      const f = chords[bar][v];
      value += Math.sin(2 * Math.PI * f * t) * 0.32;
      value += Math.sin(2 * Math.PI * f * 2 * t) * 0.06;
    }
    const shimmer = Math.sin(2 * Math.PI * 0.35 * t) * 0.05;
    const fade = Math.min(1, t / 1.2, (seconds - t) / 1.6);
    samples[i] = (value * env * 0.5 + shimmer) * clamp(fade, 0, 1);
  }
  return new File([encodeWav(samples, sampleRate)], 'clipforge-music-bed.wav', { type: 'audio/wav' });
}

$('#btnAddMusic')?.addEventListener('click', async () => {
  const card = progressCard({ title: 'Generating music', icon: '🎹' });
  card.update(20, 'Synthesising a 24 second bed…');
  const file = makeMusicBed(24);
  const media = await mediaFromFile(file);
  card.update(80, 'Analysing waveform…');
  if (media) {
    store.media.set(media.id, media);
    store.emit('media', { reason: 'add' });
    const clip = placeMediaOnTimeline(media, { at: 0, append: false });
    if (clip) { clip.volume = 0.45; clip.fadeIn = 1.2; clip.fadeOut = 1.5; }
    timeline.refresh();
    refreshStats();
  }
  card.close();
  toast('Music bed added to track V1 — lower its volume in the inspector', { kind: 'success', timeout: 4200 });
});

/* ------------------------------------------------------------ canvas UX */

let canvasDrag = null;

function pointOnCanvas(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    nx: clamp((event.clientX - rect.left) / rect.width, -0.5, 1.5),
    ny: clamp((event.clientY - rect.top) / rect.height, -0.5, 1.5),
  };
}

function clipBounds(clip) {
  const media = mediaById(clip.mediaId);
  const W = store.project.settings.width;
  const H = store.project.settings.height;
  const sw = media?.width || W;
  const sh = media?.height || H;
  const cover = Math.max(W / sw, H / sh) * (clip.scale || 1);
  return { halfW: (sw * cover) / (2 * W), halfH: (sh * cover) / (2 * H) };
}

function hitTest(nx, ny) {
  const items = clipsAt(store.t);
  for (let i = items.length - 1; i >= 0; i--) {
    const { clip } = items[i];
    if (clip.kind === 'audio') continue;
    if (clip.kind === 'text') {
      const style = clip.text?.style || {};
      const halfW = 0.34;
      const halfH = ((style.fontSize || 0.08) * 1.4) / 2;
      const cx = style.x ?? 0.5;
      const cy = style.y ?? 0.5;
      if (Math.abs(nx - cx) <= halfW && Math.abs(ny - cy) <= halfH) return clip;
      continue;
    }
    const { halfW, halfH } = clipBounds(clip);
    const cx = clip.x ?? 0.5;
    const cy = clip.y ?? 0.5;
    if (Math.abs(nx - cx) <= halfW && Math.abs(ny - cy) <= halfH) return clip;
  }
  return null;
}

canvas.addEventListener('pointerdown', (event) => {
  if (store.playing) player.pause();
  const { nx, ny } = pointOnCanvas(event);
  const clip = hitTest(nx, ny);
  if (!clip) {
    store.clearSelection();
    return;
  }
  if (!store.selection.has(clip.id)) store.select(clip.id);
  canvasDrag = {
    startX: nx,
    startY: ny,
    snapshot: history.begin(),
    clips: selectedClips().map(({ clip: c }) => ({ clip: c, x: c.kind === 'text' ? (c.text.style.x ?? 0.5) : (c.x ?? 0.5), y: c.kind === 'text' ? (c.text.style.y ?? 0.5) : (c.y ?? 0.5) })),
  };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  if (!canvasDrag) return;
  const { nx, ny } = pointOnCanvas(event);
  const dx = nx - canvasDrag.startX;
  const dy = ny - canvasDrag.startY;
  for (const item of canvasDrag.clips) {
    const nextX = clamp(item.x + dx, -0.2, 1.2);
    const nextY = clamp(item.y + dy, -0.2, 1.2);
    if (item.clip.kind === 'text') {
      item.clip.text.style = { ...item.clip.text.style, x: nextX, y: nextY };
    } else {
      item.clip.x = nextX;
      item.clip.y = nextY;
    }
  }
  player.requestRender();
  inspector.refresh();
});

function endCanvasDrag() {
  if (!canvasDrag) return;
  const moved = true;
  const snapshot = canvasDrag.snapshot;
  canvasDrag = null;
  if (moved) {
    history.commit('Move on canvas', snapshot);
    store.emit('project', { reason: 'canvas-move' });
  }
}
canvas.addEventListener('pointerup', endCanvasDrag);
canvas.addEventListener('pointercancel', endCanvasDrag);

canvas.addEventListener('wheel', (event) => {
  const clip = selectedClips()[0]?.clip;
  if (!clip) return;
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.06 : 1 / 1.06;
  history.do('Scale clip', () => {
    clip.scale = clamp((clip.scale || 1) * factor, 0.1, 4);
  });
  player.requestRender();
}, { passive: false });

canvas.addEventListener('dblclick', () => {
  const clip = selectedClips()[0]?.clip;
  if (!clip) return;
  history.do('Reset transform', () => {
    Object.assign(clip, { scale: 1, x: 0.5, y: 0.5 });
    if (clip.kind === 'text') clip.text.style = { ...clip.text.style, x: 0.5, y: 0.5 };
  });
  player.renderOnce();
});

/* ------------------------------------------------------ global D&D files */

// The hint overlay is driven by a heartbeat instead of enter/leave counters:
// a counter can drift (nested elements, drags that leave the iframe, cancelled
// drags) and leave the overlay stuck on screen. `dragover` keeps firing while a
// drag is really over the page, so when it goes quiet we hide the hint.
const dropOverlay = $('#dropOverlay');
let lastDragOver = 0;
let overlayWatch = 0;

function showDropHint() {
  if (dropOverlay.hidden) dropOverlay.hidden = false;
  lastDragOver = performance.now();
  if (!overlayWatch) {
    overlayWatch = window.setInterval(() => {
      if (performance.now() - lastDragOver > 350) hideDropHint();
    }, 150);
  }
}

function hideDropHint() {
  if (overlayWatch) { clearInterval(overlayWatch); overlayWatch = 0; }
  dropOverlay.hidden = true;
}

const dragHasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');

window.addEventListener('dragenter', (event) => {
  if (!dragHasFiles(event)) return;
  showDropHint();
});

window.addEventListener('dragover', (event) => {
  if (dragHasFiles(event)) {
    event.preventDefault();    // required so the browser drops instead of opening the file
    showDropHint();
  } else if (!event.target.closest('.tl-tracks, #dropZone')) {
    hideDropHint();
  }
});

// leaving an iframe does not always deliver a matching dragleave — the heartbeat covers it
window.addEventListener('dragleave', (event) => {
  if (!event.relatedTarget) hideDropHint();
});
window.addEventListener('dragend', hideDropHint);
window.addEventListener('blur', hideDropHint);
document.addEventListener('mouseleave', hideDropHint);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideDropHint(); });

window.addEventListener('drop', async (event) => {
  hideDropHint();
  if (event.target.closest('.tl-tracks') || event.target.closest('#dropZone')) return;
  event.preventDefault();
  const files = Array.from(event.dataTransfer?.files || []).filter(isMediaFile);
  if (!files.length) return;
  const created = await importFiles(files);
  let cursor = store.t;
  for (const media of created) {
    const clip = placeMediaOnTimeline(media, { at: cursor, append: false });
    cursor += clip?.duration || 5;
  }
  timeline.refresh();
  refreshStats();
});

/* -------------------------------------------------------------- shortcuts */

function isTyping() {
  const node = document.activeElement;
  return node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable);
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    store.clearSelection();
    return;
  }
  if (isTyping()) return;
  const mod = event.ctrlKey || event.metaKey;

  if (mod && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) history.redo(); else history.undo();
    timeline.refresh();
    return;
  }
  if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); history.redo(); timeline.refresh(); return; }
  if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); doSaveOnline(); return; }
  if (mod && event.key.toLowerCase() === 'e') { event.preventDefault(); $('#btnExport').click(); return; }
  if (mod && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    for (const { clip } of selectedClips()) duplicateClip(clip.id);
    return;
  }
  if (mod && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    store.select(allClips().map(({ clip }) => clip.id));
    return;
  }

  switch (event.key) {
    case ' ':
      event.preventDefault();
      player.toggle();
      break;
    case 'ArrowLeft':
      event.preventDefault();
      event.shiftKey ? player.jump(-1) : player.stepFrame(-1);
      break;
    case 'ArrowRight':
      event.preventDefault();
      event.shiftKey ? player.jump(1) : player.stepFrame(1);
      break;
    case 'Home': player.seek(0); break;
    case 'End': player.seek(projectDuration()); break;
    case 'Delete':
    case 'Backspace':
      event.preventDefault();
      removeSelected();
      break;
    case '+': case '=': timeline.zoomBy(1.25); break;
    case '-': case '_': timeline.zoomBy(1 / 1.25); break;
    case 'f': case 'F': timeline.fit(); break;
    default: break;
  }

  const key = event.key.toLowerCase();
  if (key === 's') {
    if (store.selection.size) splitSelectionAt(store.t);
    store.emit('project', { reason: 'split' });
  }
  if (key === 't') { placeTextClip(TITLE_PRESETS[0], { at: store.t }); timeline.refresh(); }
  if (key === 'm') $('#btnMute').click();
  if (key === 'l') $('#btnLoop').click();
  if (key === 'i') {
    for (const { clip } of selectedClips()) updateClip(clip.id, { start: Math.max(0, store.t) }, { historyLabel: 'Set start' });
  }
  if (key === 'o') {
    for (const { clip } of selectedClips()) {
      if (store.t > clip.start) updateClip(clip.id, { duration: store.t - clip.start }, { historyLabel: 'Set end' });
    }
  }
  if (key === '?') openGuide();
});

/* ---------------------------------------------------------------- guide */

function openGuide() {
  openModal({
    title: 'How to use ClipForge',
    width: 620,
    body: el('div', {}, [
      el('div', { class: 'guide-list' }, [
        el('p', { html: '<b>1 · Import</b> — drop video, audio or images anywhere on this page (or use the Media panel). Files are read locally, nothing is uploaded.' }),
        el('p', { html: '<b>2 · Arrange</b> — drag clips from the bin onto the timeline, drag their edges to trim, double-click a clip to split it, and drag the playhead to scrub.' }),
        el('p', { html: '<b>3 · Style</b> — select a clip and use the Clip panel for colour, transforms, volume and fades. Add titles from the Titles panel.' }),
        el('p', { html: '<b>4 · Export</b> — press Export. The timeline records in real time, so keep this tab visible until the download button appears.' }),
      ]),
      el('h3', { class: 'insp-title', style: { marginTop: '18px' }, text: 'Keyboard shortcuts' }),
      el('div', { class: 'key-list' }, [
        el('kbd', { text: 'Space' }), el('span', { text: 'Play / pause' }),
        el('kbd', { text: '← →' }), el('span', { text: 'Step one frame (Shift for one second)' }),
        el('kbd', { text: 'S' }), el('span', { text: 'Split selected clip at the playhead' }),
        el('kbd', { text: 'T' }), el('span', { text: 'Add a title' }),
        el('kbd', { text: 'I / O' }), el('span', { text: 'Set clip start / end to the playhead' }),
        el('kbd', { text: 'Ctrl + D' }), el('span', { text: 'Duplicate selection' }),
        el('kbd', { text: 'Ctrl + Z' }), el('span', { text: 'Undo (add Shift for redo)' }),
        el('kbd', { text: 'Del' }), el('span', { text: 'Delete selection' }),
        el('kbd', { text: '+ / -' }), el('span', { text: 'Zoom the timeline (F to fit)' }),
        el('kbd', { text: 'Ctrl + wheel' }), el('span', { text: 'Zoom the timeline around the pointer' }),
        el('kbd', { text: 'Ctrl + E' }), el('span', { text: 'Export video' }),
        el('kbd', { text: 'Ctrl + S' }), el('span', { text: 'Save project on this server' }),
      ]),
    ]),
    actions: [{ label: 'Got it', primary: true }],
  });
}

$('#btnGuide').addEventListener('click', openGuide);

/* --------------------------------------------------------------- startup */

function applyProjectToUI() {
  syncCanvas();
  syncSettingsInputs();
  timeline.refresh();
  refreshStats();
  refreshEmptyState();
  player.renderOnce();
}

store.on('project', () => { refreshStats(); markDirty(true); });
store.on('media', refreshStats);
store.on('selection', () => {});
window.addEventListener('resize', debounce(() => player.requestRender(), 120));

buildAspectOptions();
renderTitlePresets();
applyProjectToUI();
markDirty(false);

const params = new URLSearchParams(location.search);
const projectParam = params.get('project');
if (projectParam) {
  const card = progressCard({ title: 'Loading project', icon: '🗂' });
  loadOnlineProject(projectParam)
    .then(() => { applyProjectToUI(); markDirty(false); card.close(); })
    .catch((err) => { card.close(); toast(err.message, { kind: 'warn', timeout: 5000 }); });
} else {
  const autosave = readAutosave();
  if (autosave?.project && autosave.project.tracks?.some((t) => t.clips.length)) {
    toast('Unsaved timeline found from an earlier session.', {
      kind: 'info',
      timeout: 9000,
      actions: [{
        label: 'Recover',
        onClick: async () => {
          const { applyDocument } = await import('./storage.js');
          try {
            await applyDocument(autosave, new Map());
            applyProjectToUI();
            clearAutosave();
            toast('Timeline recovered — re-import the media files to see them again', { kind: 'success', timeout: 5000 });
          } catch (err) {
            toast(err.message, { kind: 'warn' });
          }
        },
      }],
    });
  }
}

window.addEventListener('beforeunload', (event) => {
  if (allClips().length && !window.__clipforgeClosing) {
    event.preventDefault();
    event.returnValue = '';
  }
});

window.addEventListener('pagehide', () => {
  import('./storage.js').then(({ autosaveLocal }) => autosaveLocal());
});

// expose a tiny debug handle (handy for the browser console and tests)
window.clipforge = { store, renderer, player, timeline, history, findClip, projectDuration };
