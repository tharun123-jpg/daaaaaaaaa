/* ==========================================================================
   ClipForge — canvas compositor: video frames, images, titles + audio graph
   ========================================================================== */

import { clamp } from './utils.js';
import { store, clipsAt, mediaById, DEFAULT_ADJUSTMENTS } from './state.js';
import { evaluateClip } from './anim.js';

const LOOKAHEAD = 0.3;
const DRIFT_TOLERANCE = 0.28;

function filterString(adjust = {}) {
  const a = { ...DEFAULT_ADJUSTMENTS, ...adjust };
  const parts = [];
  if (a.brightness !== 1) parts.push(`brightness(${a.brightness})`);
  if (a.contrast !== 1) parts.push(`contrast(${a.contrast})`);
  if (a.saturation !== 1) parts.push(`saturate(${a.saturation})`);
  if (a.hue) parts.push(`hue-rotate(${a.hue}deg)`);
  if (a.blur) parts.push(`blur(${a.blur}px)`);
  if (a.grayscale) parts.push(`grayscale(${a.grayscale})`);
  if (a.sepia) parts.push(`sepia(${a.sepia})`);
  // temperature/tint are white-balance shifts — a blend pass handles them
  if (a.temperature > 0.02) parts.push(`sepia(${(a.temperature * 0.32).toFixed(3)})`);
  if (a.temperature < -0.02) parts.push(`hue-rotate(${(a.temperature * -14).toFixed(1)}deg)`);
  if (a.tint > 0.02) parts.push(`hue-rotate(${(a.tint * -8).toFixed(1)}deg) saturate(${(1 + a.tint * 0.12).toFixed(3)})`);
  if (a.tint < -0.02) parts.push(`hue-rotate(${(a.tint * -10).toFixed(1)}deg)`);
  return parts.length ? parts.join(' ') : 'none';
}

/* ------------------------------------------------------- procedural assets */

let noiseTile = null;
function getNoiseTile() {
  if (noiseTile) return noiseTile;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = 110 + Math.random() * 90;
    image.data[i] = v;
    image.data[i + 1] = v;
    image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  noiseTile = canvas;
  return noiseTile;
}

const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
};

/** Warm/cool + green/magenta white balance, drawn as a soft-light wash. */
function drawWhiteBalance(ctx, rect, adjust) {
  const { temperature = 0, tint = 0 } = adjust;
  if (Math.abs(temperature) < 0.02 && Math.abs(tint) < 0.02) return;
  const [x, y, w, h] = rect;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalCompositeOperation = 'soft-light';
  if (Math.abs(temperature) > 0.02) {
    const color = temperature > 0 ? '255,150,60' : '70,150,255';
    ctx.fillStyle = `rgba(${color},${Math.min(0.95, Math.abs(temperature))})`;
    ctx.fillRect(x, y, w, h);
  }
  if (Math.abs(tint) > 0.02) {
    const color = tint > 0 ? '255,60,190' : '60,255,130';
    ctx.fillStyle = `rgba(${color},${Math.min(0.8, Math.abs(tint) * 0.7)})`;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

/** Matte / film-fade: lift the blacks with a screen pass. */
function drawMatte(ctx, rect, amount) {
  if (amount <= 0.01) return;
  const [x, y, w, h] = rect;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = `rgba(92,98,132,${(amount * 0.34).toFixed(3)})`;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function drawVignette(ctx, rect, amount) {
  if (amount <= 0.01) return;
  const [x, y, w, h] = rect;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const radius = Math.hypot(w, h) / 2;
  const gradient = ctx.createRadialGradient(cx, cy, radius * 0.42, cx, cy, radius);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, `rgba(0,0,0,${(amount * 0.82).toFixed(3)})`);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function drawGrain(ctx, rect, amount, time) {
  if (amount <= 0.01) return;
  const [x, y, w, h] = rect;
  const tile = getNoiseTile();
  const ox = Math.floor((time * 90) % 128);
  const oy = Math.floor((time * 53) % 128);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = Math.min(0.7, amount * 0.62);
  const pattern = ctx.createPattern(tile, 'repeat');
  if (pattern?.setTransform) pattern.setTransform(new DOMMatrix([1, 0, 0, 1, -ox, -oy]));
  ctx.fillStyle = pattern || 'rgba(128,128,128,.12)';
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** Animated light leak: a warm diagonal gradient sweeping across the frame. */
function drawLightLeak(ctx, rect, amount, time) {
  if (amount <= 0.01) return;
  const [x, y, w, h] = rect;
  const phase = (Math.sin(time * 0.7) + 1) / 2;
  const gradient = ctx.createLinearGradient(x - w * 0.2 + phase * w * 0.35, y, x + w * 0.8 + phase * w * 0.35, y + h);
  gradient.addColorStop(0, `rgba(255,140,60,0)`);
  gradient.addColorStop(0.45, `rgba(255,168,86,${(amount * 0.5).toFixed(3)})`);
  gradient.addColorStop(1, `rgba(255,90,160,0)`);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

export function fadeFactor(clip, t) {
  const inFade = clip.fadeIn || 0;
  const outFade = clip.fadeOut || 0;
  const local = t - clip.start;
  let factor = 1;
  if (inFade > 0 && local < inFade) factor = Math.min(factor, clamp(local / inFade, 0, 1));
  const fromEnd = clip.duration - local;
  if (outFade > 0 && fromEnd < outFade) factor = Math.min(factor, clamp(fromEnd / outFade, 0, 1));
  return clamp(factor, 0, 1);
}

export class Renderer {
  constructor(canvas, pool) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.pool = pool;
    this.elements = new Map();     // mediaId -> { el, kind, gain, source, connected }
    this.audioCtx = null;
    this.masterGain = null;
    this.speakerGain = null;
    this.recordDest = null;
    this.masterVolume = 1;
    this.listen = true;
    this.bg = '#000000';
  }

  /* ---------------------------------------------------------- dimensions */

  setSize(width, height) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /* -------------------------------------------------------------- audio */

  ensureAudio() {
    if (this.audioCtx) return this.audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    this.audioCtx = new Ctx({ latencyHint: 'interactive' });
    this.masterGain = this.audioCtx.createGain();
    this.speakerGain = this.audioCtx.createGain();
    this.speakerGain.gain.value = this.listen ? 1 : 0;
    this.masterGain.gain.value = this.masterVolume;
    this.masterGain.connect(this.speakerGain);
    this.speakerGain.connect(this.audioCtx.destination);
    return this.audioCtx;
  }

  resumeAudio() {
    const ctx = this.ensureAudio();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  setMasterVolume(value) {
    this.masterVolume = clamp(value, 0, 2);
    if (this.masterGain) this.masterGain.gain.value = this.masterVolume;
  }

  setListen(enabled) {
    this.listen = enabled;
    if (this.speakerGain) this.speakerGain.gain.value = enabled ? 1 : 0;
    for (const entry of this.elements.values()) entry.el.muted = false;
  }

  /** Route the project audio into a MediaStreamDestination for export. */
  getRecordDestination() {
    const ctx = this.ensureAudio();
    if (!ctx) return null;
    if (!this.recordDest) {
      this.recordDest = ctx.createMediaStreamDestination();
      this.masterGain.connect(this.recordDest);
    }
    return this.recordDest;
  }

  /* ------------------------------------------------------------ elements */

  elementFor(media, { withAudio = true } = {}) {
    if (!media) return null;
    let entry = this.elements.get(media.id);
    if (entry) return entry;
    let el;
    if (media.kind === 'audio') {
      el = document.createElement('audio');
      el.preload = 'auto';
      el.src = media.url;
    } else if (media.kind === 'video') {
      el = document.createElement('video');
      el.preload = 'auto';
      el.playsInline = true;
      el.setAttribute('playsinline', '');
      el.setAttribute('webkit-playsinline', '');
      el.src = media.url;
    } else {
      el = new Image();
      el.crossOrigin = 'anonymous';
      el.src = media.url;
      el.decoding = 'async';
    }
    el.dataset.mediaId = media.id;
    entry = { el, kind: media.kind, gain: null, source: null, connected: false, low: null, mid: null, high: null };
    if (media.kind !== 'image') {
      this.pool?.append(el);
      el.addEventListener('error', () => {
        store.setStatus(`Could not decode ${media.name} — try MP4/WebM`, 'warn');
      });
    }
    // audio routing (created on the first user gesture)
    if (withAudio && media.kind !== 'image' && this.audioCtx) this.connectAudio(entry);
    this.elements.set(media.id, entry);
    return entry;
  }

  connectAudio(entry) {
    if (entry.connected || !this.audioCtx) return;
    try {
      const ctx = this.audioCtx;
      entry.source = ctx.createMediaElementSource(entry.el);
      // three-band EQ: bass shelf · voice peak · treble shelf
      entry.low = ctx.createBiquadFilter();
      entry.low.type = 'lowshelf';
      entry.low.frequency.value = 250;
      entry.mid = ctx.createBiquadFilter();
      entry.mid.type = 'peaking';
      entry.mid.frequency.value = 1200;
      entry.mid.Q.value = 1;
      entry.high = ctx.createBiquadFilter();
      entry.high.type = 'highshelf';
      entry.high.frequency.value = 4200;
      entry.gain = ctx.createGain();
      entry.gain.gain.value = 1;
      entry.source.connect(entry.low);
      entry.low.connect(entry.mid);
      entry.mid.connect(entry.high);
      entry.high.connect(entry.gain);
      entry.gain.connect(this.masterGain);
      entry.connected = true;
    } catch (err) {
      // element already connected or unsupported — fall back to el.volume
      entry.connected = false;
    }
  }

  connectAllAudio() {
    this.ensureAudio();
    for (const entry of this.elements.values()) if (entry.kind !== 'image') this.connectAudio(entry);
  }

  dropElement(mediaId) {
    const entry = this.elements.get(mediaId);
    if (!entry) return;
    try { entry.el.pause(); } catch { /* ignore */ }
    try { entry.el.removeAttribute('src'); entry.el.load(); } catch { /* ignore */ }
    entry.el.remove?.();
    this.elements.delete(mediaId);
  }

  reset() {
    for (const id of Array.from(this.elements.keys())) this.dropElement(id);
  }

  pauseAll() {
    for (const entry of this.elements.values()) {
      try { entry.el.pause(); } catch { /* ignore */ }
    }
  }

  seekAll(t) {
    for (const { clip } of clipsAt(t, { includeHidden: true })) this.seekClip(clip, t);
  }

  seekClip(clip, t) {
    const media = mediaById(clip.mediaId);
    if (!media || media.kind === 'image') return;
    const entry = this.elementFor(media);
    if (!entry) return;
    const local = (clip.in || 0) + Math.max(0, t - clip.start) * (clip.speed || 1);
    entry.el.currentTime = Math.max(0, local);
  }

  /* ------------------------------------------------------------- syncing */

  sync(t, playing) {
    const active = clipsAt(t, { includeHidden: true });
    const activeIds = new Set();
    for (const { clip, track } of active) {
      if (!clip.mediaId) continue;
      const media = mediaById(clip.mediaId);
      if (!media || media.kind === 'image') continue;
      const entry = this.elementFor(media);
      if (!entry) continue;
      activeIds.add(media.id);
      const evaluated = evaluateClip(clip, t);
      const speed = (clip.speed || 1) * (store.rate || 1);
      const local = (clip.in || 0) + Math.max(0, t - clip.start) * (clip.speed || 1) * (store.rate || 1);
      const audible = !clip.muted && !track.muted && !track.hidden;

      // gain / volume (volume may be keyframed → automation)
      const fade = fadeFactor(clip, t);
      const vol = clamp(evaluated.volume * fade, 0, 2);
      if (entry.gain) {
        entry.gain.gain.value = audible ? vol : 0;
        const eq = evaluated.eq || {};
        if (entry.low) entry.low.gain.value = eq.low || 0;
        if (entry.mid) entry.mid.gain.value = eq.mid || 0;
        if (entry.high) entry.high.gain.value = eq.high || 0;
      } else {
        entry.el.volume = clamp(vol, 0, 1);
        entry.el.muted = !audible;
      }
      if (Math.abs(entry.el.playbackRate - speed) > 0.001) {
        entry.el.playbackRate = speed;
        if ('preservesPitch' in entry.el) entry.el.preservesPitch = true;
      }

      const drift = Math.abs(entry.el.currentTime - local);
      if (playing && !track.hidden) {
        if (entry.el.paused) {
          if (drift > 0.05) entry.el.currentTime = Math.max(0, local);
          entry.el.play().catch(() => {});
        } else if (drift > DRIFT_TOLERANCE) {
          entry.el.currentTime = Math.max(0, local);
        }
      } else if (!playing) {
        if (!entry.el.paused) entry.el.pause();
        if (drift > 0.03) entry.el.currentTime = Math.max(0, local);
      } else {
        // playing but track hidden → silent, pause to save CPU
        if (!entry.el.paused) entry.el.pause();
      }
    }
    // pause everything not active right now
    for (const [mediaId, entry] of this.elements) {
      if (activeIds.has(mediaId)) continue;
      if (!entry.el.paused) { try { entry.el.pause(); } catch { /* ignore */ } }
    }
  }

  /* -------------------------------------------------------------- drawing */

  drawFrame(t, { exporting = false, includeHidden = false } = {}) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = this.bg || '#000000';
    ctx.fillRect(0, 0, W, H);

    const items = clipsAt(t, { includeHidden: includeHidden || exporting });
    for (const { clip, track } of items) {
      if (clip.kind === 'audio') continue;
      if (track.hidden && !exporting) continue;
      if (clip.kind === 'text') this.drawTextClip(ctx, clip, t, W, H);
      else this.drawVisualClip(ctx, clip, t, W, H);
    }
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
  }

  drawVisualClip(ctx, clip, t, W, H) {
    const v = evaluateClip(clip, t);
    const media = mediaById(clip.mediaId);
    if (!media) {
      // media was not re-imported (small JSON project, or a cleared bin)
      ctx.save();
      ctx.globalAlpha = 0.55 * clamp(v.opacity * fadeFactor(clip, t), 0, 1);
      ctx.fillStyle = '#141a30';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#39406b';
      ctx.lineWidth = Math.max(2, H * 0.004);
      ctx.setLineDash([H * 0.02, H * 0.015]);
      ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, W - ctx.lineWidth * 2, H - ctx.lineWidth * 2);
      ctx.setLineDash([]);
      ctx.fillStyle = '#9aa5c8';
      ctx.font = `600 ${Math.round(H * 0.045)}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Media missing — re-import it', W / 2, H / 2 - H * 0.03);
      ctx.font = `400 ${Math.round(H * 0.03)}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = '#6f7ba3';
      ctx.fillText(clip.label || clip.mediaId || '', W / 2, H / 2 + H * 0.04);
      ctx.restore();
      return;
    }
    const entry = this.elementFor(media);
    const alpha = clamp(v.opacity * fadeFactor(clip, t), 0, 1);
    if (alpha <= 0.001) return;

    const sw = media.width || entry?.el.videoWidth || entry?.el.naturalWidth || W;
    const sh = media.height || entry?.el.videoHeight || entry?.el.naturalHeight || H;
    const cover = Math.max(W / sw, H / sh);
    const scale = cover * v.scale;
    const dw = sw * scale;
    const dh = sh * scale;
    const cx = v.x * W;
    const cy = v.y * H;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.filter = filterString(v.adjust);
    ctx.translate(cx, cy);
    if (v.rotate) ctx.rotate((v.rotate * Math.PI) / 180);
    ctx.drawImage(entry.el, -dw / 2, -dh / 2, dw, dh);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;

    // grading + effect passes, clipped to the clip's own rectangle
    const rect = [-dw / 2, -dh / 2, dw, dh];
    drawWhiteBalance(ctx, rect, v.adjust);
    if (v.fx.fade) drawMatte(ctx, rect, v.fx.fade);
    if (v.fx.leak) drawLightLeak(ctx, rect, v.fx.leak, t);
    if (v.fx.grain) drawGrain(ctx, rect, v.fx.grain, t);
    if (v.fx.vignette) drawVignette(ctx, rect, v.fx.vignette);
    ctx.restore();
  }

  drawTextClip(ctx, clip, t, W, H) {
    const v = evaluateClip(clip, t);
    const style = v.textStyle || clip.text?.style || {};
    const value = clip.text?.value ?? '';
    if (!value) return;
    const alpha = clamp(v.opacity * fadeFactor(clip, t), 0, 1);
    if (alpha <= 0.001) return;

    const px = (val, fallback = 0) => (typeof val === 'number' ? val : fallback);
    const fontSize = Math.max(6, px(style.fontSize, 0.08) * H);
    const lines = String(value).split('\n');
    const lineHeight = fontSize * 1.22;
    const weight = style.fontWeight || 700;
    const family = style.fontFamily || 'Inter, ui-sans-serif, system-ui, "Segoe UI", Roboto, Arial, sans-serif';

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.filter = 'none';
    ctx.font = `${weight} ${fontSize}px ${family}`;
    try { ctx.letterSpacing = `${(style.letterSpacing || 0) * fontSize}px`; } catch { /* older browsers */ }
    ctx.textBaseline = 'middle';
    ctx.textAlign = style.align === 'left' ? 'left' : style.align === 'right' ? 'right' : 'center';

    const ax = px(style.x, 0.5) * W;
    const ay = px(style.y, 0.5) * H;
    const text = style.uppercase ? lines.map((l) => l.toUpperCase()) : lines;
    const align = ctx.textAlign;
    const totalH = lineHeight * text.length;

    // background plate
    if (style.bg) {
      const pad = px(style.bg.pad, 0.02) * H;
      let maxW = 0;
      for (const line of text) maxW = Math.max(maxW, ctx.measureText(line).width);
      const boxW = maxW + pad * 2;
      const boxH = totalH + pad * 1.1;
      const left = align === 'left' ? ax - pad : align === 'right' ? ax - boxW + pad : ax - boxW / 2;
      const top = ay - totalH / 2 - pad * 0.55;
      ctx.fillStyle = style.bg.color || 'rgba(0,0,0,.5)';
      roundedRect(ctx, left, top, boxW, boxH, Math.min(boxH / 2, px(style.bg.radius, 0.012) * H));
      ctx.fill();
    }

    const startY = ay - totalH / 2 + lineHeight / 2;
    for (let i = 0; i < text.length; i++) {
      const y = startY + i * lineHeight;
      if (style.shadow) {
        ctx.shadowColor = style.shadow.color || 'rgba(0,0,0,.6)';
        ctx.shadowBlur = px(style.shadow.blur, 12) * (H / 1080);
        ctx.shadowOffsetY = px(style.shadow.offsetY, 0) * (H / 1080);
      }
      if (style.outline && style.outline.width > 0) {
        ctx.lineWidth = Math.max(1, style.outline.width * H);
        ctx.strokeStyle = style.outline.color || '#000';
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.strokeText(text[i], ax, y);
      }
      ctx.fillStyle = style.color || '#fff';
      ctx.fillText(text[i], ax, y);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    // text clips can carry the same effect passes
    if (v.fx.vignette || v.fx.grain) {
      const rect = [0, 0, W, H];
      if (v.fx.grain) drawGrain(ctx, rect, v.fx.grain, t);
      if (v.fx.vignette) drawVignette(ctx, rect, v.fx.vignette);
    }
  }

  /* -------------------------------------------------------------- export */

  captureStream(fps = 30) {
    if (this.canvas.captureStream) return this.canvas.captureStream(fps);
    if (this.canvas.mozCaptureStream) return this.canvas.mozCaptureStream(fps);
    return null;
  }
}

export function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export { filterString };
