/* ==========================================================================
   ClipForge — project persistence: .clipforge.zip bundles, autosave JSON,
   and saving/loading projects on the ClipForge server
   ========================================================================== */

import { $, el, downloadBlob, deepClone } from './utils.js';
import { store, history, projectDuration } from './state.js';
import { mediaFromFile, mediaFromServer } from './media.js';
import { createZip, readZip } from './zip.js';
import { toast, confirmDialog } from './ui.js';

const BUNDLE_VERSION = 1;

/* ------------------------------------------------------------ serialising */

export function serializeProject({ includeMedia = true } = {}) {
  const media = [];
  const idMap = new Map();
  for (const item of store.media.values()) {
    idMap.set(item.id, item.id);
    if (!includeMedia) continue;
    media.push({
      id: item.id,
      name: item.name,
      kind: item.kind,
      size: item.size,
      duration: item.duration,
      width: item.width,
      height: item.height,
      serverUrl: item.persisted ? item.serverUrl : null,
    });
  }
  return {
    app: 'clipforge',
    version: BUNDLE_VERSION,
    savedAt: new Date().toISOString(),
    id: store.project.id,
    name: store.project.name,
    media,
    project: deepClone(store.project),
  };
}

export function posterDataUrl(maxWidth = 320) {
  try {
    const canvas = document.querySelector('#preview');
    if (!canvas || !canvas.width) return null;
    const scale = Math.min(1, maxWidth / canvas.width);
    const out = document.createElement('canvas');
    out.width = Math.round(canvas.width * scale);
    out.height = Math.round(canvas.height * scale);
    out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.62);
  } catch {
    return null;
  }
}

function safeName(name = 'project') {
  return name.replace(/[^\w\-. ]+/g, '_').slice(0, 60) || 'project';
}

/* ------------------------------------------------------------ file save */

export async function saveToFile() {
  const doc = serializeProject();
  const encoder = new TextEncoder();
  const entries = [{ name: 'project.json', data: encoder.encode(JSON.stringify(doc, null, 2)) }];

  let index = 0;
  for (const media of store.media.values()) {
    let bytes = null;
    if (media.file) {
      bytes = new Uint8Array(await media.file.arrayBuffer());
    } else if (media.url) {
      try {
        bytes = new Uint8Array(await (await fetch(media.url)).arrayBuffer());
      } catch { bytes = null; }
    }
    if (!bytes) continue;
    const entryName = `media/${String(index).padStart(3, '0')}-${safeName(media.name)}`;
    index++;
    const record = doc.media.find((m) => m.id === media.id);
    if (record) record.bundlePath = entryName;
    entries.push({ name: entryName, data: bytes });
  }

  // rewrite project.json now that bundlePath values are known
  entries[0] = { name: 'project.json', data: encoder.encode(JSON.stringify(doc, null, 2)) };

  const zip = await createZip(entries, {
    onProgress: (done, total) => store.setStatus(`Packing ${done}/${total}…`),
  });
  downloadBlob(zip, `${safeName(store.project.name)}.clipforge.zip`);
  store.setStatus('Project saved to disk');
  toast('Project downloaded — keep the .clipforge.zip together with its media', { kind: 'success' });
}

/* ------------------------------------------------------------ file open */

export async function openFromFile(file) {
  if (!file) return false;
  store.setStatus(`Opening ${file.name}…`);
  const lower = file.name.toLowerCase();
  let doc = null;
  let mediaBytes = new Map();

  if (lower.endsWith('.zip')) {
    const zip = await readZip(await file.arrayBuffer());
    const projectEntry = zip.get('project.json');
    if (!projectEntry) throw new Error('project.json missing from the bundle');
    doc = JSON.parse(new TextDecoder().decode(projectEntry));
    mediaBytes = zip;
  } else {
    doc = JSON.parse(await file.text());
  }
  return applyDocument(doc, mediaBytes);
}

export async function applyDocument(doc, zipEntries = new Map()) {
  if (!doc || !doc.project) throw new Error('That file is not a ClipForge project');
  const idMap = new Map();

  const previousMedia = Array.from(store.media.keys());
  store.media.clear();
  for (const id of previousMedia) void id;

  for (const record of doc.media || []) {
    const path = record.bundlePath;
    let media = null;
    if (path && zipEntries.has(path)) {
      const bytes = zipEntries.get(path);
      const blob = new Blob([bytes]);
      const file = new File([blob], record.name, { type: blob.type || '' });
      media = await mediaFromFile(file, { quiet: true });
    } else if (record.serverUrl) {
      media = await mediaFromServer({ ...record, url: record.serverUrl, kind: record.kind });
    }
    if (!media) continue;
    media.id = record.id || media.id;
    store.media.set(media.id, media);
    idMap.set(record.id, media.id);
  }

  const project = deepClone(doc.project);
  project.name = doc.name || project.name || 'Untitled project';
  // remap any media ids that were regenerated
  for (const track of project.tracks || []) {
    for (const clip of track.clips || []) {
      if (clip.mediaId && idMap.has(clip.mediaId)) clip.mediaId = idMap.get(clip.mediaId);
    }
  }
  history.clear();
  // media was rebuilt above — keep it, but reset the playhead and selection
  store.setProject(project, { keepMedia: true, keepTime: false, keepSelection: false });
  store.emit('media', { reason: 'replace' });
  store.setStatus(`Opened “${project.name}”`);
  toast(`Opened “${project.name}”`, { kind: 'success' });
  return true;
}

/* ------------------------------------------------------------ server save */

async function uploadMedia(media, projectId, onProgress) {
  if (media.persisted && media.serverUrl) return media.serverUrl;
  if (!media.file) return null;
  const url = `/api/media/${encodeURIComponent(projectId)}/${encodeURIComponent(media.name)}`;
  const res = await fetch(url, { method: 'PUT', body: media.file });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  const data = await res.json();
  media.persisted = true;
  media.serverUrl = data.url;
  onProgress?.(1);
  return data.url;
}

export async function saveOnline({ silent = false } = {}) {
  const project = store.project;
  const id = project.id && /^[A-Za-z0-9_-]{1,64}$/.test(project.id) ? project.id : `p${Date.now().toString(36)}`;
  project.id = id;
  project.name = $('#projectName')?.value?.trim() || project.name;

  const mediaRecords = [];
  const items = Array.from(store.media.values());
  let done = 0;
  for (const media of items) {
    try {
      const url = await uploadMedia(media, id, () => {});
      mediaRecords.push({
        id: media.id, name: media.name, kind: media.kind, size: media.size,
        duration: media.duration, width: media.width, height: media.height,
        serverUrl: url, url: media.serverUrl || media.url,
      });
    } catch (err) {
      store.setStatus(`Could not upload ${media.name}`, 'warn');
    }
    done++;
    store.setStatus(`Uploading media ${done}/${items.length}…`);
  }

  const payload = {
    id,
    name: project.name,
    poster: posterDataUrl(320),
    project: deepClone(project),
    media: mediaRecords,
  };
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Save failed (${res.status})`);
  const data = await res.json();
  markDirty(false);
  if (!silent) {
    store.setStatus('Project saved on the server');
    toast('Saved online — open it any time from “Projects”', {
      kind: 'success',
      actions: [{ label: 'Open projects', onClick: () => window.open('/projects', '_blank') }],
    });
  }
  return data.id;
}

export async function loadOnlineProject(id) {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error('Project not found on this server');
  const doc = await res.json();
  const mediaRecords = (doc.media || []).map((item) => ({
    id: item.id || item.name,
    name: item.name,
    kind: item.kind,
    size: item.size,
    duration: item.duration,
    serverUrl: item.url,
  }));
  await applyDocument({ name: doc.name, project: doc.project, media: mediaRecords }, new Map());
  return doc;
}

export async function listOnlineProjects() {
  const res = await fetch('/api/projects');
  if (!res.ok) throw new Error('Could not list projects');
  const data = await res.json();
  return data.projects || [];
}

export async function deleteOnlineProject(id) {
  const ok = await confirmDialog({
    title: 'Delete project?',
    message: 'This removes the saved project and its uploaded media from the server. It cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return false;
  await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return true;
}

/* ------------------------------------------------------------ dirty flag */

let dirty = false;
export function markDirty(value = true) {
  if (value) dirty = true;
  if (!value) dirty = false;
  const node = $('#saveState');
  if (node) {
    node.textContent = dirty ? 'Unsaved changes' : 'Saved';
    node.classList.toggle('dirty', dirty);
  }
}
export const isDirty = () => dirty;

export function newProject(name = 'Untitled project') {
  if (dirty) {
    const proceed = window.confirm('Discard unsaved changes and start a new project?');
    if (!proceed) return false;
  }
  history.clear();
  store.media.clear();
  store.setProject(createEmptyProject(name), { keepMedia: true, keepTime: false, keepSelection: false });
  store.emit('media', { reason: 'replace' });
  markDirty(false);
  toast('New project ready');
  return true;
}

function createEmptyProject(name) {
  // imported lazily to avoid a circular import at module load
  const tracks = [
    { id: `trk_${Math.random().toString(36).slice(2, 9)}`, type: 'video', name: 'V1', muted: false, hidden: false, locked: false, clips: [] },
    { id: `trk_${Math.random().toString(36).slice(2, 9)}`, type: 'text', name: 'T1', muted: false, hidden: false, locked: false, clips: [] },
  ];
  return {
    version: 1,
    id: `proj_${Math.random().toString(36).slice(2, 9)}`,
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings: { width: 1920, height: 1080, aspect: '16:9', fps: 30, bg: '#000000', masterVolume: 1 },
    tracks,
  };
}

/* ------------------------------------------------------------ autosave */

const AUTOSAVE_KEY = 'clipforge.autosave.v1';

export function autosaveLocal() {
  try {
    const doc = serializeProject({ includeMedia: false });
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ ...doc, poster: posterDataUrl(240) }));
  } catch { /* storage full or blocked — not critical */ }
}

export function readAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearAutosave() {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
}

export function projectSummary() {
  return {
    name: store.project.name,
    duration: projectDuration(),
    clips: store.project.tracks.reduce((n, t) => n + t.clips.length, 0),
    media: store.media.size,
  };
}

export function exportJsonOnly() {
  const doc = serializeProject();
  downloadBlob(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), `${safeName(doc.name)}.clipforge.json`);
  toast('Project JSON downloaded (media files are not included)', { kind: 'warn' });
}

export { el };
