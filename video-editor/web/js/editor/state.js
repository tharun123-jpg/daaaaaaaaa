/* ==========================================================================
   ClipForge — project model + reactive store + undo/redo history
   ========================================================================== */

import { deepClone, uid, clamp } from './utils.js';

export const MIN_CLIP_DURATION = 0.1;
export const MAX_ZOOM = 600;
export const MIN_ZOOM = 4;

/* ------------------------------------------------------------------ presets */

export const ASPECTS = [
  { id: '16:9', width: 1920, height: 1080, label: '16:9 · YouTube' },
  { id: '9:16', width: 1080, height: 1920, label: '9:16 · Reels / Shorts' },
  { id: '1:1', width: 1080, height: 1080, label: '1:1 · Feed' },
  { id: '4:5', width: 1080, height: 1350, label: '4:5 · Portrait' },
  { id: '4:3', width: 1440, height: 1080, label: '4:3 · Classic' },
];

export const EXPORT_QUALITIES = [
  { id: '480p', height: 480, bitrate: 2_500_000 },
  { id: '720p', height: 720, bitrate: 5_000_000 },
  { id: '1080p', height: 1080, bitrate: 9_000_000 },
  { id: 'source', height: 0, bitrate: 0 },
];

export const DEFAULT_ADJUSTMENTS = {
  brightness: 1, contrast: 1, saturation: 1, blur: 0,
  hue: 0, grayscale: 0, sepia: 0, opacity: 1,
};

export const FILTER_PRESETS = [
  { id: 'none', name: 'Original', adjust: {} },
  { id: 'vivid', name: 'Vivid', adjust: { saturation: 1.45, contrast: 1.12, brightness: 1.03 } },
  { id: 'warm', name: 'Golden', adjust: { saturation: 1.2, sepia: 0.28, brightness: 1.05 } },
  { id: 'cool', name: 'Arctic', adjust: { saturation: 1.05, hue: 12, brightness: 1.04, contrast: 1.06 } },
  { id: 'bw', name: 'Noir', adjust: { grayscale: 1, contrast: 1.22 } },
  { id: 'faded', name: 'Faded film', adjust: { saturation: 0.72, contrast: 0.9, brightness: 1.08, sepia: 0.12 } },
  { id: 'pop', name: 'Pop', adjust: { saturation: 1.6, contrast: 1.2 } },
  { id: 'dream', name: 'Dream', adjust: { blur: 2.4, saturation: 1.15, brightness: 1.06 } },
];

export const TITLE_PRESETS = [
  {
    id: 'bold-center', name: 'Bold centre',
    text: 'YOUR BIG MOMENT',
    style: { fontSize: 0.1, fontWeight: 900, color: '#ffffff', align: 'center', y: 0.5, letterSpacing: 0.06,
      outline: { width: 0.012, color: '#0a0a14' }, shadow: { blur: 18, color: 'rgba(0,0,0,.55)' }, uppercase: true },
  },
  {
    id: 'lower-third', name: 'Lower third',
    text: 'Name — Role',
    style: { fontSize: 0.055, fontWeight: 700, color: '#ffffff', align: 'left', x: 0.08, y: 0.82, letterSpacing: 0.01,
      outline: { width: 0, color: '#000' }, shadow: { blur: 12, color: 'rgba(0,0,0,.6)' }, bg: { color: 'rgba(124,92,255,.85)', pad: 0.02 } },
  },
  {
    id: 'caption', name: 'Caption',
    text: 'Subtitle goes here',
    style: { fontSize: 0.045, fontWeight: 600, color: '#ffffff', align: 'center', y: 0.9, letterSpacing: 0,
      outline: { width: 0.008, color: '#000000' }, shadow: { blur: 8, color: 'rgba(0,0,0,.7)' }, bg: { color: 'rgba(0,0,0,.42)', pad: 0.014 } },
  },
  {
    id: 'neon', name: 'Neon',
    text: 'NEON NIGHTS',
    style: { fontSize: 0.095, fontWeight: 900, color: '#e9d5ff', align: 'center', y: 0.44, letterSpacing: 0.12,
      outline: { width: 0.01, color: '#22d3ee' }, shadow: { blur: 34, color: 'rgba(124,92,255,.95)' }, uppercase: true },
  },
  {
    id: 'topbar', name: 'Top banner',
    text: 'BREAKING NEWS',
    style: { fontSize: 0.05, fontWeight: 800, color: '#0b0f1c', align: 'center', y: 0.12, letterSpacing: 0.05,
      bg: { color: 'rgba(244,114,182,.95)', pad: 0.018 }, outline: { width: 0, color: '#000' }, uppercase: true },
  },
];

/* ------------------------------------------------------------ project model */

export function createProject(name = 'Untitled project', aspect = '16:9') {
  const ratio = ASPECTS.find((a) => a.id === aspect) || ASPECTS[0];
  return {
    version: 1,
    id: uid('proj'),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings: {
      width: ratio.width,
      height: ratio.height,
      aspect: ratio.id,
      fps: 30,
      bg: '#000000',
      masterVolume: 1,
    },
    tracks: [
      makeTrack('video', 1),
      makeTrack('text', 1),
    ],
  };
}

export function makeTrack(type = 'video', index = 1) {
  return {
    id: uid('trk'),
    type,
    name: type === 'text' ? `T${index}` : `V${index}`,
    muted: false,
    hidden: false,
    locked: false,
    clips: [],
  };
}

/* ------------------------------------------------------------ store */

class Store {
  constructor() {
    this.project = createProject();
    this.media = new Map();          // id -> media object
    this.selection = new Set();      // clip ids
    this.t = 0;                      // playhead seconds
    this.playing = false;
    this.zoom = 80;                  // pixels per second
    this.snap = true;
    this.loop = false;
    this.rate = 1;
    this.listeners = new Map();
    this.status = 'Ready';
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event, detail) {
    const fns = this.listeners.get(event);
    if (!fns) return;
    for (const fn of Array.from(fns)) {
      try { fn(detail); } catch (err) { console.error(`[store:${event}]`, err); }
    }
  }

  setStatus(message, kind = 'info') {
    this.status = message;
    this.emit('status', { message, kind });
  }

  setTime(t, { silent = false } = {}) {
    const next = Math.max(0, t);
    if (Math.abs(next - this.t) < 1e-6) return;
    this.t = next;
    if (!silent) this.emit('time', { t: next });
  }

  select(ids, { additive = false } = {}) {
    if (!additive) this.selection.clear();
    for (const id of [].concat(ids)) if (id) this.selection.add(id);
    this.emit('selection', { selection: this.selection });
  }

  toggleSelect(id) {
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    this.emit('selection', { selection: this.selection });
  }

  clearSelection() {
    this.selection.clear();
    this.emit('selection', { selection: this.selection });
  }

  /** Replace the whole project (open / undo / new). */
  setProject(project, { keepMedia = true, silent = false, keepTime = false, keepSelection = false } = {}) {
    this.project = project;
    if (!keepSelection) this.selection.clear();
    else {
      // drop selection entries whose clips are gone
      const ids = new Set(project.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
      for (const id of Array.from(this.selection)) if (!ids.has(id)) this.selection.delete(id);
    }
    if (!keepTime) this.t = 0;
    if (!keepMedia) this.media.clear();
    if (!silent) {
      this.emit('project', { reason: 'replace' });
      this.emit('media', { reason: 'replace' });
      this.emit('selection', { selection: this.selection });
      this.emit('time', { t: this.t });
    }
  }
}

export const store = new Store();

/* ------------------------------------------------------------ history */

const past = [];
const future = [];
const HISTORY_LIMIT = 100;
let pending = null;

export const history = {
  /** take a snapshot before a live interaction (drag, slider) */
  begin() {
    pending = deepClone(store.project);
    return pending;
  },

  /** push the pending snapshot as one undo step (no-op when nothing changed) */
  commit(label = 'Edit', before = null) {
    const snapshot = before || pending;
    pending = null;
    if (!snapshot) return false;
    if (JSON.stringify(snapshot) === JSON.stringify(store.project)) return false;
    past.push({ label, project: snapshot });
    if (past.length > HISTORY_LIMIT) past.shift();
    future.length = 0;
    store.emit('history', { canUndo: past.length > 0, canRedo: false, label });
    return true;
  },

  /** discard a live interaction */
  cancel() {
    if (pending) store.setProject(pending, { keepTime: true, keepSelection: true });
    pending = null;
  },

  /** run a mutation and record one undo step */
  do(label, fn) {
    const before = deepClone(store.project);
    const result = fn();
    history.commit(label, before);
    store.emit('project', { reason: label });
    return result;
  },

  undo() {
    const entry = past.pop();
    if (!entry) return false;
    future.push({ label: 'redo', project: deepClone(store.project) });
    store.setProject(entry.project, { keepTime: true, keepSelection: true });
    store.emit('history', { canUndo: past.length > 0, canRedo: true, label: entry.label });
    store.setStatus(`Undo: ${entry.label}`);
    return true;
  },

  redo() {
    const entry = future.pop();
    if (!entry) return false;
    past.push({ label: 'undo', project: deepClone(store.project) });
    store.setProject(entry.project, { keepTime: true, keepSelection: true });
    store.emit('history', { canUndo: true, canRedo: future.length > 0, label: entry.label });
    store.setStatus('Redo');
    return true;
  },

  get canUndo() { return past.length > 0; },
  get canRedo() { return future.length > 0; },
  clear() { past.length = 0; future.length = 0; pending = null; },
};

/* ------------------------------------------------------------ queries */

export function projectDuration(project = store.project) {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clip.start + clip.duration);
    }
  }
  return end;
}

export function findClip(clipId, project = store.project) {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { clip, track };
  }
  return null;
}

export function trackById(trackId, project = store.project) {
  return project.tracks.find((t) => t.id === trackId) || null;
}

export function allClips(project = store.project) {
  return project.tracks.flatMap((track) => track.clips.map((clip) => ({ clip, track })));
}

export function selectedClips() {
  return allClips().filter(({ clip }) => store.selection.has(clip.id));
}

/** Clips active at time t, ordered bottom -> top (render order). */
export function clipsAt(t, { includeHidden = false, kinds = null } = {}) {
  const out = [];
  for (const track of store.project.tracks) {
    if (!includeHidden && track.hidden) continue;
    if (track.type === 'text' && !includeHidden) { /* text tracks still render */ }
    for (const clip of track.clips) {
      if (t >= clip.start - 1e-6 && t < clip.start + clip.duration - 1e-6) {
        if (kinds && !kinds.includes(clip.kind)) continue;
        out.push({ clip, track });
      }
    }
  }
  return out;
}

export function mediaById(id) {
  return store.media.get(id) || null;
}

/** Longest duration this clip can occupy given its source length. */
export function maxClipDuration(clip) {
  const media = clip.mediaId ? mediaById(clip.mediaId) : null;
  if (!media || !media.duration || !isFinite(media.duration)) return Infinity;
  const speed = clip.speed || 1;
  return Math.max(MIN_CLIP_DURATION, (media.duration - (clip.in || 0)) / speed);
}

export function sourceLength(clip) {
  return clip.duration * (clip.speed || 1);
}

/* ------------------------------------------------------------ mutations */

function withHistory(label, fn) {
  return history.do(label, fn);
}

export function addMedia(media) {
  store.media.set(media.id, media);
  store.emit('media', { reason: 'add' });
  return media;
}

export function removeMedia(mediaId) {
  const used = allClips().some(({ clip }) => clip.mediaId === mediaId);
  if (used) {
    store.setStatus('Clip still used on the timeline — remove those clips first', 'warn');
    return false;
  }
  const media = store.media.get(mediaId);
  if (media?.url?.startsWith('blob:')) URL.revokeObjectURL(media.url);
  store.media.delete(mediaId);
  store.emit('media', { reason: 'remove' });
  return true;
}

export function addTrack(type = 'video') {
  return withHistory(`Add ${type} track`, () => {
    const count = store.project.tracks.filter((t) => t.type === type).length + 1;
    const track = makeTrack(type, count);
    store.project.tracks.push(track);
    return track;
  });
}

export function removeTrack(trackId) {
  const index = store.project.tracks.findIndex((t) => t.id === trackId);
  if (index === -1) return false;
  if (store.project.tracks.length <= 1) {
    store.setStatus('At least one track is required', 'warn');
    return false;
  }
  return withHistory('Remove track', () => {
    const [track] = store.project.tracks.splice(index, 1);
    for (const clip of track.clips) store.selection.delete(clip.id);
    return true;
  });
}

export function setTrackFlag(trackId, flag, value) {
  return withHistory(`Track ${flag}`, () => {
    const track = trackById(trackId);
    if (track) track[flag] = value;
  });
}

/** Build a clip object for a media item. */
export function makeClip(media, { start = 0, trackId = null, duration = null } = {}) {
  const kind = media.kind;
  const maxDur = kind === 'image' || !media.duration ? Infinity : media.duration;
  const dur = clamp(duration ?? (kind === 'image' ? 5 : maxDur), MIN_CLIP_DURATION, maxDur);
  return {
    id: uid('clip'),
    kind,
    mediaId: media.id,
    label: media.name,
    start: Math.max(0, start),
    duration: dur,
    in: 0,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    opacity: 1,
    rotate: 0,
    scale: 1,
    x: 0.5,
    y: 0.5,
    adjust: {},
    text: null,
  };
}

export function makeTextClip({ start = 0, duration = 3, preset = TITLE_PRESETS[0], text = null } = {}) {
  return {
    id: uid('clip'),
    kind: 'text',
    mediaId: null,
    label: text || preset.text,
    start: Math.max(0, start),
    duration,
    in: 0,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0.35,
    fadeOut: 0.35,
    opacity: 1,
    rotate: 0,
    scale: 1,
    x: 0.5,
    y: 0.5,
    adjust: {},
    text: {
      preset: preset.id,
      value: text || preset.text,
      style: deepClone(preset.style),
    },
  };
}

export function addClip(clip, trackId) {
  let track = trackById(trackId);
  if (!track) {
    track = store.project.tracks.find((t) => (clip.kind === 'text' ? t.type === 'text' : t.type === 'video'))
      || store.project.tracks[store.project.tracks.length - 1];
  }
  return withHistory(`Add ${clip.kind} clip`, () => {
    track.clips.push(clip);
    track.clips.sort((a, b) => a.start - b.start);
    store.selection.clear();
    store.selection.add(clip.id);
    return clip;
  });
}

export function removeClip(clipId) {
  const found = findClip(clipId);
  if (!found) return false;
  return withHistory('Delete clip', () => {
    const index = found.track.clips.indexOf(found.clip);
    found.track.clips.splice(index, 1);
    store.selection.delete(clipId);
  });
}

export function removeSelected() {
  if (!store.selection.size) return false;
  return withHistory('Delete selection', () => {
    for (const track of store.project.tracks) {
      track.clips = track.clips.filter((clip) => !store.selection.has(clip.id));
    }
    store.selection.clear();
  });
}

export function duplicateClip(clipId) {
  const found = findClip(clipId);
  if (!found) return false;
  return withHistory('Duplicate clip', () => {
    const copy = deepClone(found.clip);
    copy.id = uid('clip');
    copy.start = found.clip.start + found.clip.duration;
    found.track.clips.push(copy);
    found.track.clips.sort((a, b) => a.start - b.start);
    store.selection.clear();
    store.selection.add(copy.id);
  });
}

/** Split the clip under the playhead (or at an explicit time). */
export function splitClipAt(clipId, time) {
  const found = findClip(clipId);
  if (!found) return false;
  const { clip, track } = found;
  const t = clamp(time, clip.start + MIN_CLIP_DURATION, clip.start + clip.duration - MIN_CLIP_DURATION);
  if (t <= clip.start || t >= clip.start + clip.duration) return false;
  return withHistory('Split clip', () => {
    const offset = t - clip.start;
    const speed = clip.speed || 1;
    const right = deepClone(clip);
    right.id = uid('clip');
    right.start = t;
    right.duration = clip.duration - offset;
    right.in = (clip.in || 0) + offset * speed;
    clip.duration = offset;
    track.clips.push(right);
    track.clips.sort((a, b) => a.start - b.start);
    return right;
  });
}

export function splitSelectionAt(time) {
  const targets = selectedClips().filter(({ clip }) => time > clip.start && time < clip.start + clip.duration);
  if (!targets.length) {
    store.setStatus('Put the playhead inside a selected clip to split', 'warn');
    return false;
  }
  const before = deepClone(store.project);
  for (const { clip } of targets) {
    const offset = time - clip.start;
    const speed = clip.speed || 1;
    const found = findClip(clip.id);
    if (!found) continue;
    const right = deepClone(clip);
    right.id = uid('clip');
    right.start = time;
    right.duration = clip.duration - offset;
    right.in = (clip.in || 0) + offset * speed;
    clip.duration = offset;
    found.track.clips.push(right);
    found.track.clips.sort((a, b) => a.start - b.start);
  }
  history.commit(`Split ${targets.length} clip${targets.length > 1 ? 's' : ''}`, before);
  store.emit('project', { reason: 'split' });
  return true;
}

export function updateClip(clipId, patch, { historyLabel = 'Edit clip', record = true } = {}) {
  const found = findClip(clipId);
  if (!found) return false;
  const before = record ? deepClone(store.project) : null;
  Object.assign(found.clip, patch);
  if (record) {
    history.commit(historyLabel, before);
    store.emit('project', { reason: historyLabel });
  }
  return true;
}

export function moveClip(clipId, { trackId, start }) {
  const found = findClip(clipId);
  if (!found) return false;
  const { clip } = found;
  const targetTrack = trackId ? trackById(trackId) : found.track;
  if (!targetTrack || targetTrack.locked) return false;
  const before = deepClone(store.project);
  if (targetTrack !== found.track) {
    found.track.clips.splice(found.track.clips.indexOf(clip), 1);
    targetTrack.clips.push(clip);
  }
  if (typeof start === 'number') clip.start = Math.max(0, start);
  found.track.clips.sort((a, b) => a.start - b.start);
  targetTrack.clips.sort((a, b) => a.start - b.start);
  history.commit('Move clip', before);
  store.emit('project', { reason: 'move' });
  return true;
}

export function totalStats() {
  const clips = allClips();
  return {
    clips: clips.length,
    tracks: store.project.tracks.length,
    media: store.media.size,
    duration: projectDuration(),
  };
}
