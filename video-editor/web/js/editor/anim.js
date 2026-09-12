/* ==========================================================================
   ClipForge — keyframe engine
   Every clip property can be animated over time. Keyframe times are stored
   in seconds *relative to the clip start*, so clips can be moved freely.
   ========================================================================== */

import { clamp } from './utils.js';
import { DEFAULT_ADJUSTMENTS } from './state.js';

export const DEFAULT_FX = { vignette: 0, grain: 0, fade: 0, leak: 0 };

export const EASINGS = [
  { id: 'linear', label: 'Linear' },
  { id: 'easeIn', label: 'Ease in' },
  { id: 'easeOut', label: 'Ease out' },
  { id: 'easeInOut', label: 'Ease in-out' },
  { id: 'hold', label: 'Hold (step)' },
];

const pct = (v) => `${Math.round(v * 100)}%`;
const px = (v) => `${Math.round(v)}px`;
const deg = (v) => `${Math.round(v)}°`;
const secs = (v) => `${Number(v).toFixed(2)}s`;
const num2 = (v) => Number(v).toFixed(2);

/** Every animatable property of a clip. `path` resolves into the clip object. */
export const ANIM_PROPS = [
  { id: 'x', label: 'Position X', path: ['x'], def: 0.5, min: 0, max: 1, step: 0.005, fmt: pct, group: 'transform' },
  { id: 'y', label: 'Position Y', path: ['y'], def: 0.5, min: 0, max: 1, step: 0.005, fmt: pct, group: 'transform' },
  { id: 'scale', label: 'Zoom', path: ['scale'], def: 1, min: 0.1, max: 4, step: 0.01, fmt: pct, group: 'transform' },
  { id: 'rotate', label: 'Rotate', path: ['rotate'], def: 0, min: -180, max: 180, step: 1, fmt: deg, group: 'transform' },
  { id: 'opacity', label: 'Opacity', path: ['opacity'], def: 1, min: 0, max: 1, step: 0.01, fmt: pct, group: 'transform' },
  { id: 'volume', label: 'Volume', path: ['volume'], def: 1, min: 0, max: 2, step: 0.01, fmt: pct, group: 'audio' },
  { id: 'brightness', label: 'Brightness', path: ['adjust', 'brightness'], def: 1, min: 0.2, max: 2, step: 0.01, fmt: pct, group: 'colour' },
  { id: 'contrast', label: 'Contrast', path: ['adjust', 'contrast'], def: 1, min: 0.2, max: 2.5, step: 0.01, fmt: pct, group: 'colour' },
  { id: 'saturation', label: 'Saturation', path: ['adjust', 'saturation'], def: 1, min: 0, max: 3, step: 0.01, fmt: pct, group: 'colour' },
  { id: 'hue', label: 'Hue shift', path: ['adjust', 'hue'], def: 0, min: -180, max: 180, step: 1, fmt: deg, group: 'colour' },
  { id: 'blur', label: 'Blur', path: ['adjust', 'blur'], def: 0, min: 0, max: 24, step: 0.1, fmt: px, group: 'colour' },
  { id: 'grayscale', label: 'Black & white', path: ['adjust', 'grayscale'], def: 0, min: 0, max: 1, step: 0.01, fmt: pct, group: 'colour' },
  { id: 'sepia', label: 'Sepia', path: ['adjust', 'sepia'], def: 0, min: 0, max: 1, step: 0.01, fmt: pct, group: 'colour' },
  { id: 'temperature', label: 'Temperature', path: ['adjust', 'temperature'], def: 0, min: -1, max: 1, step: 0.01, fmt: num2, group: 'colour' },
  { id: 'tint', label: 'Tint', path: ['adjust', 'tint'], def: 0, min: -1, max: 1, step: 0.01, fmt: num2, group: 'colour' },
  { id: 'vignette', label: 'Vignette', path: ['fx', 'vignette'], def: 0, min: 0, max: 1, step: 0.01, fmt: pct, group: 'fx' },
  { id: 'grain', label: 'Film grain', path: ['fx', 'grain'], def: 0, min: 0, max: 1, step: 0.01, fmt: pct, group: 'fx' },
  { id: 'fxFade', label: 'Matte fade', path: ['fx', 'fade'], def: 0, min: 0, max: 1, step: 0.01, fmt: pct, group: 'fx' },
  { id: 'lightLeak', label: 'Light leak', path: ['fx', 'leak'], def: 0, min: 0, max: 1, step: 0.01, fmt: pct, group: 'fx' },
  { id: 'textX', label: 'Text X', path: ['text', 'style', 'x'], def: 0.5, min: 0.02, max: 0.98, step: 0.005, fmt: pct, group: 'text', only: 'text' },
  { id: 'textY', label: 'Text Y', path: ['text', 'style', 'y'], def: 0.5, min: 0.05, max: 0.95, step: 0.005, fmt: pct, group: 'text', only: 'text' },
  { id: 'textSize', label: 'Text size', path: ['text', 'style', 'fontSize'], def: 0.08, min: 0.02, max: 0.3, step: 0.002, fmt: (v) => `${(v * 100).toFixed(1)}%`, group: 'text', only: 'text' },
  { id: 'textSpacing', label: 'Text spacing', path: ['text', 'style', 'letterSpacing'], def: 0, min: -0.05, max: 0.3, step: 0.005, fmt: num2, group: 'text', only: 'text' },
  { id: 'eqLow', label: 'Bass (EQ)', path: ['eq', 'low'], def: 0, min: -24, max: 24, step: 1, fmt: (v) => `${v}dB`, group: 'audio' },
  { id: 'eqMid', label: 'Voice (EQ)', path: ['eq', 'mid'], def: 0, min: -24, max: 24, step: 1, fmt: (v) => `${v}dB`, group: 'audio' },
  { id: 'eqHigh', label: 'Treble (EQ)', path: ['eq', 'high'], def: 0, min: -24, max: 24, step: 1, fmt: (v) => `${v}dB`, group: 'audio' },
];

const PROP_BY_ID = new Map(ANIM_PROPS.map((p) => [p.id, p]));
export const propDef = (id) => PROP_BY_ID.get(id) || null;

export function propsForClip(clip) {
  return ANIM_PROPS.filter((p) => !p.only || p.only === clip.kind);
}

/* ------------------------------------------------------------ read / write */

function walk(clip, path, create = false) {
  let node = clip;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (node[key] === undefined || node[key] === null) {
      if (!create) return null;
      node[key] = {};
    }
    node = node[key];
  }
  return { node, key: path[path.length - 1] };
}

export function getBaseValue(clip, id) {
  const def = propDef(id);
  if (!def) return undefined;
  const target = walk(clip, def.path);
  if (!target) return def.def;
  const value = target.node[target.key];
  if (typeof value === 'number') return value;
  if (def.path[0] === 'adjust') return DEFAULT_ADJUSTMENTS[id] ?? def.def;
  if (def.path[0] === 'fx') return DEFAULT_FX[def.path[1]] ?? def.def;
  return def.def;
}

export function setBaseValue(clip, id, value) {
  const def = propDef(id);
  if (!def) return;
  const target = walk(clip, def.path, true);
  if (target) target.node[target.key] = value;
}

export function setFx(clip, key, value) {
  clip.fx = { ...(clip.fx || {}), [key]: value };
}

export function setEq(clip, key, value) {
  clip.eq = { ...(clip.eq || {}), [key]: value };
}

export const fxValue = (clip, key) => ({ ...DEFAULT_FX, ...(clip.fx || {}) })[key];

/* ------------------------------------------------------------- keyframes */

export const keyframesOf = (clip, id) => clip.keyframes?.[id] || [];
export const hasKeyframes = (clip, id) => keyframesOf(clip, id).length > 0;

export function keyframeCount(clip) {
  return Object.values(clip.keyframes || {}).reduce((n, list) => n + list.length, 0);
}

export function applyEasing(easing, k) {
  const t = clamp(k, 0, 1);
  switch (easing) {
    case 'easeIn': return t * t;
    case 'easeOut': return 1 - (1 - t) * (1 - t);
    case 'easeInOut': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'hold': return 0;
    default: return t;
  }
}

/** Value of a property at `local` seconds from the clip start. */
export function sampleProperty(clip, id, local) {
  const list = keyframesOf(clip, id);
  if (!list.length) return getBaseValue(clip, id);
  const t = Math.max(0, local);
  if (t <= list[0].t) return list[0].v;
  const last = list[list.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i];
    const b = list[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      const k = span <= 1e-6 ? 1 : (t - a.t) / span;
      return a.v + (b.v - a.v) * applyEasing(a.e, k);
    }
  }
  return last.v;
}

/** Add or replace a keyframe. Returns the keyframe. */
export function setKeyframe(clip, id, local, value, easing = 'easeInOut') {
  const def = propDef(id);
  if (!def) return null;
  clip.keyframes = clip.keyframes || {};
  const list = clip.keyframes[id] || (clip.keyframes[id] = []);
  const t = Math.max(0, Number(local.toFixed(3)));
  const v = clamp(value, def.min, def.max);
  const existing = list.find((kf) => Math.abs(kf.t - t) < 0.02);
  if (existing) {
    existing.v = v;
    return existing;
  }
  const kf = { t, v, e: easing };
  list.push(kf);
  list.sort((a, b) => a.t - b.t);
  return kf;
}

export function removeKeyframeAt(clip, id, local, eps = 0.02) {
  const list = keyframesOf(clip, id);
  if (!list.length) return false;
  const index = list.findIndex((kf) => Math.abs(kf.t - local) < eps);
  if (index === -1) return false;
  list.splice(index, 1);
  if (!list.length) delete clip.keyframes[id];
  return true;
}

export function clearKeyframes(clip, id = null) {
  if (id) {
    if (clip.keyframes) delete clip.keyframes[id];
  } else {
    clip.keyframes = {};
  }
}

export const keyframeAt = (clip, id, local, eps = 0.02) =>
  keyframesOf(clip, id).find((kf) => Math.abs(kf.t - local) < eps) || null;

/** Sorted list of every keyframe time of a clip (union of all properties). */
export function keyframeTimes(clip) {
  const set = new Set();
  for (const list of Object.values(clip.keyframes || {})) {
    for (const kf of list) set.add(Number(kf.t.toFixed(3)));
  }
  return Array.from(set).sort((a, b) => a - b);
}

export function nextKeyframe(clip, id, local) {
  return keyframesOf(clip, id).find((kf) => kf.t > local + 0.01) || null;
}

export function prevKeyframe(clip, id, local) {
  const list = keyframesOf(clip, id).filter((kf) => kf.t < local - 0.01);
  return list.length ? list[list.length - 1] : null;
}

/** Move every keyframe sitting at `from` to `to` (used when dragging diamonds). */
export function retimeKeyframes(clip, from, to) {
  const clamped = clamp(to, 0, clip.duration);
  for (const list of Object.values(clip.keyframes || {})) {
    for (const kf of list) {
      if (Math.abs(kf.t - from) < 0.02) kf.t = Number(clamped.toFixed(3));
    }
  }
  for (const list of Object.values(clip.keyframes || {})) list.sort((a, b) => a.t - b.t);
}

/* ------------------------------------------------------------- evaluation */

/**
 * Resolve every animated value of a clip at absolute time `t`.
 * Returns { local, x, y, scale, rotate, opacity, volume, adjust, fx, textStyle }.
 */
export function evaluateClip(clip, t) {
  const local = clamp(t - clip.start, 0, clip.duration);
  const values = {};
  for (const def of ANIM_PROPS) values[def.id] = sampleProperty(clip, def.id, local);

  const adjust = { ...DEFAULT_ADJUSTMENTS, ...(clip.adjust || {}) };
  for (const id of ['brightness', 'contrast', 'saturation', 'hue', 'blur', 'grayscale', 'sepia', 'temperature', 'tint']) {
    if (hasKeyframes(clip, id)) adjust[id] = values[id];
  }

  const fx = { ...DEFAULT_FX, ...(clip.fx || {}) };
  const fxMap = { vignette: 'vignette', grain: 'grain', fxFade: 'fade', lightLeak: 'leak' };
  for (const [id, key] of Object.entries(fxMap)) {
    if (hasKeyframes(clip, id)) fx[key] = values[id];
  }

  const out = {
    local,
    x: values.x,
    y: values.y,
    scale: values.scale,
    rotate: values.rotate,
    opacity: values.opacity,
    volume: values.volume,
    adjust,
    fx,
    eq: { ...(clip.eq || {}) },
  };

  if (clip.kind === 'text') {
    const style = { ...(clip.text?.style || {}) };
    if (hasKeyframes(clip, 'textX')) style.x = values.textX;
    if (hasKeyframes(clip, 'textY')) style.y = values.textY;
    if (hasKeyframes(clip, 'textSize')) style.fontSize = values.textSize;
    if (hasKeyframes(clip, 'textSpacing')) style.letterSpacing = values.textSpacing;
    out.textStyle = style;
  }
  return out;
}

/** True when any property of the clip is animated. */
export const isAnimated = (clip) => keyframeCount(clip) > 0;

export function cloneKeyframes(clip) {
  return JSON.parse(JSON.stringify(clip.keyframes || {}));
}
