/* ==========================================================================
   ClipForge — timeline: rulers, tracks, clips, drag / trim / snap / zoom
   ========================================================================== */

import { $, $$, el, clamp, fmtDuration, roundToFrame, throttle } from './utils.js';
import {
  store, history, findClip, projectDuration, MAX_ZOOM, MIN_ZOOM,
  MIN_CLIP_DURATION, maxClipDuration, splitClipAt, removeSelected, duplicateClip,
  splitSelectionAt, addTrack, setTrackFlag, removeTrack,
} from './state.js';
import { keyframeTimes, keyframesOf, retimeKeyframes, sampleProperty } from './anim.js';

const HEAD_WIDTH = 132;
const TRACK_HEIGHT = { video: 62, audio: 54, text: 42 };
const SNAP_PX = 9;
const RULER_HEIGHT = 26;

const trackHeight = (track) => TRACK_HEIGHT[track.type] || 56;

/* --------------------------------------------------------------- geometry */

export function createGeometry() {
  const tracks = () => store.project.tracks;
  /** display order is reversed: last track in the array appears at the top */
  const displayIndex = (index) => tracks().length - 1 - index;
  const arrayIndexFromDisplay = (display) => tracks().length - 1 - display;

  function rowTop(displayRow) {
    let y = 0;
    const list = tracks();
    for (let d = 0; d < displayRow; d++) y += trackHeight(list[arrayIndexFromDisplay(d)]);
    return y;
  }

  function trackTop(trackId) {
    const index = tracks().findIndex((t) => t.id === trackId);
    if (index === -1) return 0;
    return rowTop(displayIndex(index));
  }

  function totalHeight() {
    return tracks().reduce((sum, t) => sum + trackHeight(t), 0);
  }

  function trackAt(y) {
    let acc = 0;
    const list = tracks();
    for (let d = 0; d < list.length; d++) {
      const track = list[arrayIndexFromDisplay(d)];
      const h = trackHeight(track);
      if (y >= acc && y < acc + h) return track;
      acc += h;
    }
    return list[0] || null;
  }

  return { displayIndex, arrayIndexFromDisplay, rowTop, trackTop, totalHeight, trackAt };
}

/* --------------------------------------------------------------- mounting */

export function mountTimeline({ onSeek, getPxPerSec }) {
  const inner = $('#tlInner');
  const ruler = $('#tlRuler');
  const tracksEl = $('#tlTracks');
  const headsEl = $('#tlHeadsList');
  const scrollEl = $('#tlScroll');
  const playhead = $('#tlPlayhead');
  const geo = createGeometry();

  let dragging = null;
  let rulerDragging = false;

  const pps = () => clamp(store.zoom, MIN_ZOOM, MAX_ZOOM);
  const timeToX = (t) => t * pps();
  const xToTime = (x) => x / pps();
  const contentWidth = () => Math.max(600, (projectDuration() + 6) * pps() + 120);

  /* ------------------------------------------------------------- render */

  function niceStep(ppsValue) {
    const targetPx = 90;
    const raw = targetPx / ppsValue;
    const steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    for (const s of steps) if (s >= raw) return s;
    return 900;
  }

  function renderRuler() {
    const step = niceStep(pps());
    const dur = projectDuration();
    const width = contentWidth();
    const total = Math.ceil(width / pps());
    const frag = document.createDocumentFragment();
    const sub = step / 4;
    for (let t = 0; t <= total + step; t += sub) {
      const x = timeToX(t);
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      frag.append(el('i', {
        class: `tick${major ? ' major' : ''}`,
        style: { left: `${x}px` },
      }));
      if (major) {
        frag.append(el('span', {
          class: 'tick-label',
          text: step >= 1 ? fmtDuration(Math.round(t)) : `${t.toFixed(1)}s`,
          style: { left: `${x + 4}px` },
        }));
      }
    }
    ruler.innerHTML = '';
    ruler.append(frag);
    ruler.classList.toggle('over-end', false);
    void dur;
  }

  function renderTrackBackgrounds() {
    const frag = document.createDocumentFragment();
    const list = store.project.tracks;
    for (let d = 0; d < list.length; d++) {
      const track = list[geo.arrayIndexFromDisplay(d)];
      frag.append(el('div', {
        class: `tl-row${track.hidden ? ' is-hidden' : ''}${track.locked ? ' is-locked' : ''}`,
        dataset: { trackId: track.id, row: String(d) },
        style: { top: `${geo.rowTop(d)}px`, height: `${trackHeight(track)}px` },
      }));
    }
    const existing = $$('.tl-row', tracksEl);
    existing.forEach((node) => node.remove());
    tracksEl.prepend(frag);
  }

  function renderHeads() {
    headsEl.innerHTML = '';
    const list = store.project.tracks;
    for (let d = 0; d < list.length; d++) {
      const track = list[geo.arrayIndexFromDisplay(d)];
      const row = el('div', {
        class: 'tl-head',
        style: { height: `${trackHeight(track)}px` },
        dataset: { trackId: track.id },
      }, [
        el('span', { class: 'tl-head-name', text: track.name, title: track.type === 'text' ? 'Text overlay track' : 'Video / audio track' }),
        el('div', { class: 'tl-head-btns' }, [
          el('button', {
            class: `icon-btn tiny${track.hidden ? ' active' : ''}`,
            title: track.hidden ? 'Show track' : 'Hide track',
            html: track.hidden ? '🚫' : '👁',
            onclick: (e) => { e.stopPropagation(); setTrackFlag(track.id, 'hidden', !track.hidden); },
          }),
          el('button', {
            class: `icon-btn tiny${track.muted ? ' active' : ''}`,
            title: track.muted ? 'Unmute track' : 'Mute track',
            html: track.muted ? '🔇' : '🔊',
            onclick: (e) => { e.stopPropagation(); setTrackFlag(track.id, 'muted', !track.muted); },
          }),
          el('button', {
            class: `icon-btn tiny${track.locked ? ' active' : ''}`,
            title: track.locked ? 'Unlock track' : 'Lock track',
            html: track.locked ? '🔒' : '🔓',
            onclick: (e) => { e.stopPropagation(); setTrackFlag(track.id, 'locked', !track.locked); },
          }),
          el('button', {
            class: 'icon-btn tiny danger', title: 'Delete track', html: '🗑',
            onclick: (e) => { e.stopPropagation(); removeTrack(track.id); },
          }),
        ]),
      ]);
      headsEl.append(row);
    }
  }

  function clipElement(clip, track) {
    const node = el('div', {
      class: `tl-clip kind-${clip.kind}${store.selection.has(clip.id) ? ' selected' : ''}${track.locked ? ' locked' : ''}${clip.muted ? ' muted' : ''}`,
      dataset: { clipId: clip.id, trackId: track.id, kind: clip.kind },
    });

    const body = el('div', { class: 'tl-clip-body' });
    if (clip.kind === 'video' || clip.kind === 'image') {
      const media = clip.mediaId ? store.media.get(clip.mediaId) : null;
      if (media?.thumb) body.style.backgroundImage = `url(${media.thumb})`;
      else body.style.background = `linear-gradient(135deg, ${media?.color || '#7c5cff'}, ${media?.color2 || '#5b46d6'})`;
    } else if (clip.kind === 'audio') {
      body.append(el('canvas', { class: 'tl-wave' }));
    } else if (clip.kind === 'text') {
      body.append(el('span', { class: 'tl-text-badge', text: 'T' }));
    }
    node.append(body);

    const label = el('span', {
      class: 'tl-clip-label',
      text: clip.kind === 'text' ? (clip.text?.value || clip.label || 'Text') : (clip.label || 'clip'),
    });
    node.append(label);

    if (clip.kind === 'video' || clip.kind === 'audio') {
      const media = clip.mediaId ? store.media.get(clip.mediaId) : null;
      if (media?.peaks && clip.kind === 'audio') node.dataset.peaks = '1';
      if (clip.kind === 'video' && media?.peaks) node.dataset.peaks = '1';
    }

    if (clip.muted) node.append(el('span', { class: 'tl-clip-badge', text: 'M' }));
    if ((clip.speed || 1) !== 1) node.append(el('span', { class: 'tl-clip-badge speed', text: `${clip.speed}×` }));

    node.append(el('i', { class: 'tl-handle left', dataset: { handle: 'left' } }));
    node.append(el('i', { class: 'tl-handle right', dataset: { handle: 'right' } }));
    return node;
  }

  /**
   * Keyframe diamonds, fade handles, fade shading and the volume automation
   * curve. Rebuilt on every layout pass so clips that already have a DOM node
   * still pick up new keyframes / fades.
   */
  function updateClipDecorations(node, clip) {
    if (!node) return;
    const per = pps();

    for (const selector of ['.kf-dot', '.tl-kf-badge', '.tl-fade', '.tl-fade-knob', '.tl-vol-line']) {
      for (const old of Array.from(node.querySelectorAll(selector))) old.remove();
    }

    const times = keyframeTimes(clip);
    node.classList.toggle('has-kf', times.length > 0);

    // volume automation curve
    if (keyframesOf(clip, 'volume').length) {
      const svg = el('svg', { class: 'tl-vol-line', viewBox: '0 0 100 100', preserveAspectRatio: 'none' });
      const width = Math.max(8, timeToX(clip.duration));
      const steps = Math.max(2, Math.min(80, Math.round(width / 12)));
      const points = [];
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * clip.duration;
        const value = sampleProperty(clip, 'volume', t);
        points.push(`${(i / steps) * 100},${clamp(100 - (value / 2) * 96, 2, 100)}`);
      }
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      poly.setAttribute('points', points.join(' '));
      svg.append(poly);
      node.append(svg);
    }

    // fade shading + draggable knobs
    if (clip.kind !== 'text') {
      const fadeIn = clamp(clip.fadeIn || 0, 0, clip.duration);
      const fadeOut = clamp(clip.fadeOut || 0, 0, clip.duration);
      const shadeIn = el('i', { class: 'tl-fade fade-in', style: { width: `${fadeIn * per}px` } });
      const shadeOut = el('i', { class: 'tl-fade fade-out', style: { width: `${fadeOut * per}px` } });
      const knobIn = el('i', { class: 'tl-fade-knob knob-in', dataset: { fade: 'in' }, title: `Fade in ${fadeIn.toFixed(2)}s — drag to change` });
      const knobOut = el('i', { class: 'tl-fade-knob knob-out', dataset: { fade: 'out' }, title: `Fade out ${fadeOut.toFixed(2)}s — drag to change` });
      knobIn.style.left = `${fadeIn * per}px`;
      knobOut.style.right = `${fadeOut * per}px`;
      node.append(shadeIn, shadeOut, knobIn, knobOut);
    }

    // keyframe diamonds for the selected clip, badge otherwise
    if (times.length) {
      if (store.selection.has(clip.id)) {
        for (const time of times) {
          node.append(el('i', {
            class: 'kf-dot',
            dataset: { kfT: String(time) },
            title: `Keyframes at ${fmtDuration(time)} — drag to retime`,
            style: { left: `${time * per}px` },
          }));
        }
      } else {
        node.append(el('span', { class: 'tl-kf-badge', text: '◆' }));
      }
    }
  }

  function layoutClip(node, clip, track) {
    node.style.left = `${timeToX(clip.start)}px`;
    node.style.width = `${Math.max(8, timeToX(clip.duration))}px`;
    const index = store.project.tracks.indexOf(track);
    node.style.top = `${geo.trackTop(track.id) + 3}px`;
    node.style.height = `${trackHeight(track) - 6}px`;
    node.dataset.trackId = track.id;
    node.dataset.index = String(index);
    updateClipDecorations(node, clip);
  }

  function drawWaveform(node, clip) {
    const canvas = node.querySelector('canvas.tl-wave');
    if (!canvas) return;
    const media = clip.mediaId ? store.media.get(clip.mediaId) : null;
    const peaks = media?.peaks;
    const w = Math.max(2, Math.floor(timeToX(clip.duration)));
    const h = Math.max(10, trackHeight({ type: 'audio' }) - 22);
    canvas.width = w * 2;
    canvas.height = h * 2;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    const mid = canvas.height / 2;
    const total = media?.duration || clip.duration;
    const inSec = clip.in || 0;
    const spanSec = clip.duration * (clip.speed || 1);
    const stepX = 2;
    if (peaks && peaks.length) {
      const buckets = peaks.length / 2;
      for (let x = 0; x < canvas.width; x += stepX) {
        const t = inSec + (x / canvas.width) * spanSec;
        const b = clamp(Math.floor((t / (total || 1)) * buckets), 0, buckets - 1);
        const min = peaks[b * 2];
        const max = peaks[b * 2 + 1];
        const y0 = mid + min * mid;
        const y1 = mid + max * mid;
        ctx.fillRect(x, Math.min(y0, y1), stepX - 1, Math.max(2, Math.abs(y1 - y0)));
      }
    } else {
      for (let x = 0; x < canvas.width; x += stepX) {
        const amp = (Math.sin(x / 9) * 0.5 + 0.5) * 0.6 * mid * (0.6 + 0.4 * Math.sin(x / 31));
        ctx.fillRect(x, mid - amp, stepX - 1, amp * 2);
      }
    }
  }

  function render() {
    if (dragging) return; // never rebuild mid-drag (pointer capture would be lost)
    inner.style.width = `${contentWidth()}px`;
    renderTrackBackgrounds();
    tracksEl.style.height = `${geo.totalHeight()}px`;
    renderHeads();
    renderRuler();

    const oldNodes = new Map();
    for (const node of $$('.tl-clip', tracksEl)) oldNodes.set(node.dataset.clipId, node);

    for (const track of store.project.tracks) {
      for (const clip of track.clips) {
        let node = oldNodes.get(clip.id);
        if (node) oldNodes.delete(clip.id);
        else node = clipElement(clip, track);
        // refresh selection class
        node.classList.toggle('selected', store.selection.has(clip.id));
        node.classList.toggle('locked', track.locked);
        node.classList.toggle('muted', Boolean(clip.muted));
        tracksEl.append(node);
        layoutClip(node, clip, track);
        drawWaveform(node, clip);
      }
    }
    for (const node of oldNodes.values()) node.remove();

    updateInfo();
    updatePlayhead();
  }

  function updateInfo() {
    const info = $('#tlInfo');
    if (!info) return;
    const clips = store.project.tracks.reduce((n, t) => n + t.clips.length, 0);
    info.textContent = `${clips} clip${clips === 1 ? '' : 's'} · ${fmtDuration(projectDuration())} · ${store.project.settings.width}×${store.project.settings.height}`;
  }

  function updatePlayhead() {
    playhead.style.left = `${timeToX(store.t)}px`;
    playhead.style.height = `${geo.totalHeight()}px`;
  }

  function scrollPlayheadIntoView() {
    const x = timeToX(store.t);
    const viewLeft = scrollEl.scrollLeft;
    const viewRight = viewLeft + scrollEl.clientWidth - 40;
    if (x < viewLeft || x > viewRight) {
      scrollEl.scrollLeft = Math.max(0, x - scrollEl.clientWidth * 0.4);
    }
  }

  /* ------------------------------------------------------------- snapping */

  function snapPoints(ignoreIds = []) {
    const points = [0, store.t, projectDuration()];
    for (const { clip } of allClipsSafe()) {
      if (ignoreIds.includes(clip.id)) continue;
      points.push(clip.start, clip.start + clip.duration);
    }
    return points;
  }

  function allClipsSafe() {
    return store.project.tracks.flatMap((track) => track.clips.map((clip) => ({ clip, track })));
  }

  function applySnap(value, points) {
    if (!store.snap) return value;
    const threshold = SNAP_PX / pps();
    let best = value;
    let bestDist = threshold;
    for (const p of points) {
      const d = Math.abs(p - value);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    return best;
  }

  /* ------------------------------------------------------------- pointer */

  function localPoint(event) {
    const rect = tracksEl.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function rowFromY(y) {
    const track = geo.trackAt(y);
    return track;
  }

  function beginClipDrag(event, node, clip, track) {
    const handle = event.target.closest('.tl-handle');
    const mode = handle ? `trim-${handle.dataset.handle}` : 'move';
    if (track.locked) {
      store.setStatus(`${track.name} is locked`, 'warn');
      return;
    }
    if (!store.selection.has(clip.id)) store.select(clip.id, { additive: event.shiftKey });
    else if (event.shiftKey) store.toggleSelect(clip.id);

    const startX = event.clientX;
    const startY = event.clientY;
    const selected = mode === 'move' ? new Set(store.selection) : new Set([clip.id]);
    const snapshot = history.begin();
    const originals = new Map();
    for (const id of selected) {
      const found = findClip(id);
      if (!found) continue;
      originals.set(id, {
        start: found.clip.start,
        duration: found.clip.duration,
        in: found.clip.in || 0,
        trackIndex: store.project.tracks.indexOf(found.track),
        speed: found.clip.speed || 1,
        maxDur: maxClipDuration(found.clip),
        clip: found.clip,
        track: found.track,
        node: trackIdNode(found.clip.id),
      });
    }
    dragging = { mode, startX, startY, snapshot, originals, primaryId: clip.id, moved: false };
    node.setPointerCapture(event.pointerId);
    document.body.classList.add('is-dragging');
  }

  function trackIdNode(clipId) {
    return tracksEl.querySelector(`.tl-clip[data-clip-id="${clipId}"]`);
  }

  function onPointerMove(event) {
    if (!dragging) return;
    const dx = event.clientX - dragging.startX;
    const dy = event.clientY - dragging.startY;
    if (!dragging.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    dragging.moved = true;

    const ignore = Array.from(dragging.originals.keys());
    const points = snapPoints(ignore);
    const dt = xToTime(dx);
    const fps = store.project.settings.fps || 30;

    if (dragging.mode === 'move') {
      const primary = dragging.originals.get(dragging.primaryId);
      if (!primary) return;
      let newStart = Math.max(0, roundToFrame(primary.start + dt, fps));
      newStart = applySnap(newStart, points);
      newStart = Math.max(0, roundToFrame(newStart, fps));
      const shift = newStart - primary.start;

      // vertical: which row is under the pointer?
      const local = localPoint(event);
      const targetTrack = rowFromY(clamp(local.y, 0, geo.totalHeight() - 1));
      const targetIndex = targetTrack ? store.project.tracks.indexOf(targetTrack) : primary.trackIndex;
      const indexDelta = targetIndex - primary.trackIndex;

      for (const [id, original] of dragging.originals) {
        const { clip } = original;
        clip.start = Math.max(0, original.start + shift);
        if (indexDelta !== 0) {
          const newIndex = clamp(original.trackIndex + indexDelta, 0, store.project.tracks.length - 1);
          const newTrack = store.project.tracks[newIndex];
          if (newTrack && newTrack.id !== original.track.id) {
            const from = original.track.clips.indexOf(clip);
            if (from !== -1) original.track.clips.splice(from, 1);
            newTrack.clips.push(clip);
            original.track = newTrack;
            const node = trackIdNode(id);
            if (node) node.dataset.trackId = newTrack.id;
          }
        }
        const node = trackIdNode(id);
        const cur = findClip(id);
        if (node && cur) layoutClip(node, clip, cur.track);
      }
    } else if (dragging.mode.startsWith('trim')) {
      const side = dragging.mode === 'trim-left' ? 'left' : 'right';
      for (const [id, original] of dragging.originals) {
        const { clip } = original;
        if (side === 'left') {
          let newStart = roundToFrame(clamp(original.start + dt, 0, original.start + original.duration - MIN_CLIP_DURATION), fps);
          newStart = applySnap(newStart, points);
          if (original.in === 0 && original.maxDur !== Infinity) {
            // can't extend further left than the source allows
            const maxExtend = original.in / original.speed;
            newStart = Math.max(newStart, original.start - maxExtend);
          }
          const delta = newStart - original.start;
          clip.start = newStart;
          clip.duration = Math.max(MIN_CLIP_DURATION, original.duration - delta);
          clip.in = Math.max(0, original.in + delta * original.speed);
        } else {
          let newEnd = original.start + original.duration + dt;
          const edgePoints = points.map((p) => p - original.duration + original.duration);
          newEnd = roundToFrame(Math.max(original.start + MIN_CLIP_DURATION, newEnd), fps);
          newEnd = applySnap(newEnd, edgePoints.filter((p) => p > original.start + MIN_CLIP_DURATION).map((p) => p));
          const maxEnd = original.start + original.maxDur;
          newEnd = Math.min(newEnd, maxEnd);
          clip.duration = Math.max(MIN_CLIP_DURATION, newEnd - original.start);
        }
        const node = trackIdNode(id);
        const cur = findClip(id);
        if (node && cur) {
          layoutClip(node, clip, cur.track);
          drawWaveform(node, clip);
        }
      }
      store.emit('time', { t: store.t }); // refresh dependent readouts (no-op)
    }
    renderInspectorLive();
  }

  function endDrag() {
    if (!dragging) return;
    const mode = dragging.mode;
    const snapshot = dragging.snapshot;
    const moved = dragging.moved;
    dragging = null;
    document.body.classList.remove('is-dragging');
    if (moved) {
      const label = mode === 'move' ? 'Move clip' : 'Trim clip';
      history.commit(label, snapshot);
      store.emit('project', { reason: label });
      store.emit('selection', { selection: store.selection });
    } else {
      history.commit('Select', null);
    }
  }

  function renderInspectorLive() {
    // live numeric readouts in the inspector while dragging
    window.dispatchEvent(new CustomEvent('clipforge:livedrag'));
  }

  /* ------------------------------------------------------------- events */

  /** Drag a keyframe diamond to retime every keyframe at that instant. */
  function beginKeyframeDrag(event, dot, clipNode) {
    const found = findClip(clipNode.dataset.clipId);
    if (!found) return;
    const { clip, track } = found;
    if (track.locked) return;
    event.preventDefault();
    event.stopPropagation();
    store.select(clip.id);
    const from = Number(dot.dataset.kfT);
    const snapshot = history.begin();
    const startX = event.clientX;
    let current = from;
    dot.setPointerCapture(event.pointerId);
    dot.classList.add('dragging');

    const move = (moveEvent) => {
      const dt = (moveEvent.clientX - startX) / pps();
      const next = clamp(from + dt, 0, clip.duration);
      retimeKeyframes(clip, current, next);
      current = Number(next.toFixed(3));
      const node = trackIdNode(clip.id);
      if (node) {
        // every diamond sitting at the old instant moves with the pointer
        for (const other of node.querySelectorAll('.kf-dot')) {
          if (Math.abs(Number(other.dataset.kfT) - from) < 0.02) {
            other.dataset.kfT = String(current);
            other.style.left = `${current * pps()}px`;
          }
        }
      }
      store.setStatus(`Keyframe at ${current.toFixed(2)}s`);
    };
    const up = () => {
      dot.classList.remove('dragging');
      dot.removeEventListener('pointermove', move);
      dot.removeEventListener('pointerup', up);
      dot.removeEventListener('pointercancel', up);
      history.commit('Retime keyframe', snapshot);
      store.emit('project', { reason: 'keyframe' });
      store.emit('selection', { selection: store.selection });
    };
    dot.addEventListener('pointermove', move);
    dot.addEventListener('pointerup', up);
    dot.addEventListener('pointercancel', up);
  }

  /** Drag a fade knob to change the clip's fade in / fade out. */
  function beginFadeDrag(event, knob, clipNode) {
    const found = findClip(clipNode.dataset.clipId);
    if (!found) return;
    const { clip } = found;
    event.preventDefault();
    event.stopPropagation();
    store.select(clip.id);
    const side = knob.dataset.fade;
    const snapshot = history.begin();
    const startX = event.clientX;
    const original = side === 'in' ? (clip.fadeIn || 0) : (clip.fadeOut || 0);
    let current = original;
    knob.setPointerCapture(event.pointerId);

    const move = (moveEvent) => {
      const delta = (moveEvent.clientX - startX) / pps();
      const next = clamp(original + (side === 'in' ? delta : -delta), 0, clip.duration);
      current = next;
      if (side === 'in') clip.fadeIn = next;
      else clip.fadeOut = next;
      const node = trackIdNode(clip.id);
      if (node) {
        const fi = node.querySelector('.tl-fade.fade-in');
        const fo = node.querySelector('.tl-fade.fade-out');
        const ki = node.querySelector('.knob-in');
        const ko = node.querySelector('.knob-out');
        if (fi) fi.style.width = `${(clip.fadeIn || 0) * pps()}px`;
        if (fo) fo.style.width = `${(clip.fadeOut || 0) * pps()}px`;
        if (ki) ki.style.left = `${(clip.fadeIn || 0) * pps()}px`;
        if (ko) ko.style.right = `${(clip.fadeOut || 0) * pps()}px`;
      }
      store.setStatus(`Fade ${side}: ${current.toFixed(2)}s`);
    };
    const up = () => {
      knob.removeEventListener('pointermove', move);
      knob.removeEventListener('pointerup', up);
      knob.removeEventListener('pointercancel', up);
      history.commit(`Fade ${side}`, snapshot);
      store.emit('project', { reason: 'fade' });
      store.emit('selection', { selection: store.selection });
    };
    knob.addEventListener('pointermove', move);
    knob.addEventListener('pointerup', up);
    knob.addEventListener('pointercancel', up);
  }

  tracksEl.addEventListener('pointerdown', (event) => {
    const dot = event.target.closest('.kf-dot');
    if (dot) {
      beginKeyframeDrag(event, dot, dot.closest('.tl-clip'));
      return;
    }
    const knob = event.target.closest('.tl-fade-knob');
    if (knob) {
      beginFadeDrag(event, knob, knob.closest('.tl-clip'));
      return;
    }
    const clipNode = event.target.closest('.tl-clip');
    if (clipNode) {
      const { clipId } = clipNode.dataset;
      const found = findClip(clipId);
      if (!found) return;
      event.preventDefault();
      if (event.button === 2) return; // handled by contextmenu
      beginClipDrag(event, clipNode, found.clip, found.track);
      return;
    }
    // background click: move playhead + clear selection
    const local = localPoint(event);
    onSeek?.(Math.max(0, xToTime(local.x)));
    store.clearSelection();
  });

  tracksEl.addEventListener('pointermove', onPointerMove);
  tracksEl.addEventListener('pointerup', endDrag);
  tracksEl.addEventListener('pointercancel', endDrag);
  window.addEventListener('pointerup', endDrag);

  tracksEl.addEventListener('dblclick', (event) => {
    const clipNode = event.target.closest('.tl-clip');
    if (!clipNode) return;
    const local = localPoint(event);
    splitClipAt(clipNode.dataset.clipId, xToTime(local.x));
    store.emit('project', { reason: 'split' });
  });

  /* context menu */
  const menu = $('#tlMenu');
  tracksEl.addEventListener('contextmenu', (event) => {
    const clipNode = event.target.closest('.tl-clip');
    event.preventDefault();
    if (!clipNode) { menu.hidden = true; return; }
    const clipId = clipNode.dataset.clipId;
    store.select(clipId);
    menu.hidden = false;
    const local = localPoint(event);
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 190)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - 240)}px`;
    menu.dataset.clipId = clipId;
    menu.dataset.time = String(xToTime(local.x));
  });

  document.addEventListener('pointerdown', (event) => {
    if (!menu.hidden && !event.target.closest('#tlMenu')) menu.hidden = true;
  });

  menu?.addEventListener('click', (event) => {
    const action = event.target.closest('button')?.dataset.action;
    const clipId = menu.dataset.clipId;
    const time = Number(menu.dataset.time || 0);
    menu.hidden = true;
    if (!action) return;
    const found = findClip(clipId);
    if (!found) return;
    const { clip } = found;
    switch (action) {
      case 'split': splitClipAt(clipId, time); break;
      case 'duplicate': duplicateClip(clipId); break;
      case 'delete': removeSelected(); break;
      case 'fadein': history.do('Fade in', () => { clip.fadeIn = Math.min(clip.duration / 2, 0.6); }); break;
      case 'fadeout': history.do('Fade out', () => { clip.fadeOut = Math.min(clip.duration / 2, 0.6); }); break;
      case 'mute': history.do('Mute toggle', () => { clip.muted = !clip.muted; }); break;
      case 'full': history.do('Reset transform', () => { Object.assign(clip, { scale: 1, x: 0.5, y: 0.5, rotate: 0, opacity: 1 }); }); break;
      case 'move-playhead': onSeek?.(clip.start); return;
    }
    store.emit('project', { reason: action });
    store.emit('selection', { selection: store.selection });
  });

  /* ruler scrubbing */
  function scrubFromEvent(event) {
    const rect = tracksEl.getBoundingClientRect();
    onSeek?.(Math.max(0, xToTime(event.clientX - rect.left)));
  }
  ruler.addEventListener('pointerdown', (event) => {
    rulerDragging = true;
    ruler.setPointerCapture(event.pointerId);
    scrubFromEvent(event);
  });
  ruler.addEventListener('pointermove', (event) => { if (rulerDragging) scrubFromEvent(event); });
  ruler.addEventListener('pointerup', () => { rulerDragging = false; });

  /* drop media onto the timeline */
  function dropTarget(event) {
    const local = localPoint(event);
    const track = rowFromY(clamp(local.y, 0, geo.totalHeight() - 1)) || store.project.tracks[0];
    const time = Math.max(0, xToTime(local.x));
    return { track, time };
  }

  ['dragenter', 'dragover'].forEach((type) => {
    tracksEl.addEventListener(type, (event) => {
      if (!event.dataTransfer) return;
      const mediaId = event.dataTransfer.types.includes('application/x-clipforge-media') || event.dataTransfer.types.includes('Files');
      if (!mediaId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      const { track } = dropTarget(event);
      $$('.tl-row', tracksEl).forEach((row) => row.classList.toggle('drop-target', row.dataset.trackId === track.id));
    });
  });
  tracksEl.addEventListener('dragleave', () => $$('.tl-row', tracksEl).forEach((r) => r.classList.remove('drop-target')));
  tracksEl.addEventListener('drop', async (event) => {
    event.preventDefault();
    $$('.tl-row', tracksEl).forEach((r) => r.classList.remove('drop-target'));
    const { track, time } = dropTarget(event);
    const mediaId = event.dataTransfer.getData('application/x-clipforge-media');
    if (mediaId) {
      const { placeMediaOnTimeline } = await import('./placement.js');
      placeMediaOnTimeline(store.media.get(mediaId), { trackId: track.id, at: time, append: false });
      return;
    }
    if (event.dataTransfer.files?.length) {
      const { importFiles } = await import('./media.js');
      const created = await importFiles(event.dataTransfer.files);
      const { placeMediaOnTimeline } = await import('./placement.js');
      let cursor = time;
      for (const media of created) {
        placeMediaOnTimeline(media, { trackId: track.id, at: cursor, append: false });
        cursor += media.kind === 'image' ? 5 : (media.duration || 5);
      }
    }
  });

  /* wheel: scroll / zoom */
  scrollEl.addEventListener('wheel', (event) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const anchorTime = xToTime(event.clientX - tracksEl.getBoundingClientRect().left);
      const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18;
      store.zoom = clamp(pps() * factor, MIN_ZOOM, MAX_ZOOM);
      render();
      scrollEl.scrollLeft = Math.max(0, anchorTime * pps() - (event.clientX - scrollEl.getBoundingClientRect().left));
      syncZoomInput();
    } else if (event.shiftKey) {
      event.preventDefault();
      scrollEl.scrollLeft += event.deltaY;
    }
  }, { passive: false });

  scrollEl.addEventListener('scroll', () => {
    headsEl.style.transform = `translateY(${-scrollEl.scrollTop}px)`;
  });

  /* toolbar */
  function syncZoomInput() {
    const input = $('#tlZoom');
    if (input) input.value = String(Math.round(pps()));
    const label = $('#tlZoomLabel');
    if (label) label.textContent = `${Math.round(pps())}px/s`;
  }

  function zoomBy(factor, anchorTime = store.t) {
    const before = scrollEl.scrollLeft;
    const anchorX = timeToX(anchorTime) - before;
    store.zoom = clamp(pps() * factor, MIN_ZOOM, MAX_ZOOM);
    render();
    scrollEl.scrollLeft = Math.max(0, timeToX(anchorTime) - anchorX);
    syncZoomInput();
  }

  function fit() {
    const dur = Math.max(1, projectDuration());
    const width = scrollEl.clientWidth - 40;
    store.zoom = clamp(width / dur, MIN_ZOOM, MAX_ZOOM);
    render();
    scrollEl.scrollLeft = 0;
    syncZoomInput();
  }

  $('#tlZoomIn')?.addEventListener('click', () => zoomBy(1.35));
  $('#tlZoomOut')?.addEventListener('click', () => zoomBy(1 / 1.35));
  $('#tlFit')?.addEventListener('click', fit);
  $('#tlZoom')?.addEventListener('input', (event) => {
    store.zoom = clamp(Number(event.target.value), MIN_ZOOM, MAX_ZOOM);
    render();
    syncZoomInput();
  });

  $('#tlSplit')?.addEventListener('click', () => {
    if (store.selection.size) splitSelectionAt(store.t);
    else {
      const under = store.project.tracks
        .flatMap((t) => t.clips)
        .find((c) => store.t > c.start && store.t < c.start + c.duration);
      if (under) splitClipAt(under.id, store.t);
      else store.setStatus('Nothing under the playhead to split', 'warn');
    }
    store.emit('project', { reason: 'split' });
  });
  $('#tlDelete')?.addEventListener('click', () => removeSelected());
  $('#tlDuplicate')?.addEventListener('click', () => {
    for (const id of Array.from(store.selection)) duplicateClip(id);
  });
  $('#tlAddTrack')?.addEventListener('click', () => addTrack('video'));
  $('#tlSnap')?.addEventListener('click', (event) => {
    store.snap = !store.snap;
    event.currentTarget.classList.toggle('active', store.snap);
    store.setStatus(`Snapping ${store.snap ? 'on' : 'off'}`);
  });
  $$('[data-zoom]').forEach((btn) => btn.addEventListener('click', () => zoomBy(Number(btn.dataset.zoom))));

  /* playhead drag from the ruler of the inner container top strip */
  const playheadHandle = $('#tlPlayhead');
  playheadHandle?.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    playheadHandle.setPointerCapture(event.pointerId);
    rulerDragging = true;
    const move = (e) => scrubFromEvent(e);
    const up = () => {
      rulerDragging = false;
      playheadHandle.removeEventListener('pointermove', move);
      playheadHandle.removeEventListener('pointerup', up);
    };
    playheadHandle.addEventListener('pointermove', move);
    playheadHandle.addEventListener('pointerup', up);
  });

  /* ------------------------------------------------------------- wiring */

  store.on('project', () => render());
  store.on('selection', () => {
    if (dragging) return;
    // full re-render: keyframe diamonds are only shown on the selected clip,
    // so the decorations have to be rebuilt when the selection changes
    render();
    if (store.selection.size) {
      const first = trackIdNode(Array.from(store.selection)[0]);
      first?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  });
  store.on('media', () => render());

  const onTime = throttle(() => {
    updatePlayhead();
    if (store.playing) scrollPlayheadIntoView();
  }, 30);
  store.on('time', onTime);

  window.addEventListener('resize', throttle(render, 200));
  new ResizeObserver(throttle(() => { inner.style.width = `${contentWidth()}px`; }, 150)).observe(scrollEl);

  render();
  syncZoomInput();

  return {
    render,
    fit,
    zoomBy,
    updatePlayhead,
    geometry: geo,
    /** called when the inspector changes a clip */
    refresh: render,
  };
}
