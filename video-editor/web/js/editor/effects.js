/* ==========================================================================
   ClipForge — effects library: colour presets, CapCut-style animations,
   transitions and audio quick-tools. Pure data + generators (no imports).
   ========================================================================== */

/* ------------------------------------------------------------- colour ------------------------------------------------------------------ */

/** Full grading presets. Values are written into clip.adjust. */
export const FILTER_PRESETS = [
  { id: 'none', name: 'Original', adjust: {} },
  { id: 'vivid', name: 'Vivid', adjust: { saturation: 1.45, contrast: 1.12, brightness: 1.03 } },
  { id: 'teal-orange', name: 'Teal & Orange', adjust: { temperature: 0.28, tint: 0.08, saturation: 1.22, contrast: 1.14 } },
  { id: 'cinematic', name: 'Cinematic', adjust: { contrast: 1.2, saturation: 0.92, temperature: -0.08, fade: 0.16, brightness: 0.98 } },
  { id: 'golden', name: 'Golden Hour', adjust: { temperature: 0.42, saturation: 1.2, brightness: 1.06, sepia: 0.16 } },
  { id: 'arctic', name: 'Arctic', adjust: { temperature: -0.34, saturation: 1.06, brightness: 1.04, contrast: 1.06, tint: -0.06 } },
  { id: 'noir', name: 'Noir', adjust: { grayscale: 1, contrast: 1.28, brightness: 0.98, vignette: 0.3 } },
  { id: 'faded', name: 'Faded Film', adjust: { saturation: 0.72, contrast: 0.9, brightness: 1.08, sepia: 0.12, fade: 0.24, grain: 0.16 } },
  { id: 'pop', name: 'Pop', adjust: { saturation: 1.62, contrast: 1.2, brightness: 1.02 } },
  { id: 'dream', name: 'Dreamy', adjust: { blur: 2.2, saturation: 1.16, brightness: 1.07, fade: 0.14, lightLeak: 0.24 } },
  { id: 'moody', name: 'Moody', adjust: { brightness: 0.9, contrast: 1.18, saturation: 0.86, temperature: -0.16, vignette: 0.34 } },
  { id: 'cyberpunk', name: 'Cyberpunk', adjust: { temperature: -0.24, tint: 0.34, saturation: 1.5, contrast: 1.24, lightLeak: 0.2 } },
  { id: 'vhs', name: 'Retro VHS', adjust: { saturation: 1.3, contrast: 0.92, sepia: 0.22, grain: 0.42, temperature: 0.2, vignette: 0.24 } },
  { id: 'sunset', name: 'Sunkissed', adjust: { temperature: 0.5, saturation: 1.32, brightness: 1.08, fade: 0.1 } },
  { id: 'emerald', name: 'Emerald', adjust: { tint: -0.24, saturation: 1.18, contrast: 1.08, brightness: 1.02 } },
  { id: 'neon', name: 'Neon Night', adjust: { saturation: 1.7, contrast: 1.3, brightness: 1.05, lightLeak: 0.32, vignette: 0.28 } },
  { id: 'bw-film', name: 'B&W Film', adjust: { grayscale: 1, contrast: 1.12, grain: 0.3, vignette: 0.24, brightness: 1.02 } },
  { id: 'warm-portrait', name: 'Warm Portrait', adjust: { temperature: 0.22, brightness: 1.06, saturation: 1.08, blur: 0.4, fade: 0.08 } },
];

/* ---------------------------------------------------------- animations ----------------------------------------------------------------- */

/** Keyframe generators. Each returns {propId: [{t, v, e}]} for a clip. */
const kf = (t, v, e = 'easeInOut') => ({ t: Number(t.toFixed(3)), v, e });

function fadeIn(d) {
  const end = Math.min(0.7, d * 0.5);
  return { opacity: [kf(0, 0), kf(end, 1)] };
}
function fadeOut(d) {
  const start = Math.max(0, d - Math.min(0.7, d * 0.5));
  return { opacity: [kf(start, 1), kf(d, 0)] };
}
function popIn(d) {
  const end = Math.min(0.55, d * 0.6);
  return {
    scale: [kf(0, 0.55, 'easeOut'), kf(end * 0.7, 1.08, 'easeInOut'), kf(end, 1)],
    opacity: [kf(0, 0, 'easeOut'), kf(end * 0.6, 1)],
  };
}
function popOut(d) {
  const start = Math.max(0, d - Math.min(0.5, d * 0.5));
  return {
    scale: [kf(start, 1), kf(d, 1.16, 'easeIn')],
    opacity: [kf(start, 1), kf(d, 0, 'easeIn')],
  };
}
function slide(dir, d) {
  const end = Math.min(0.6, d * 0.55);
  const from = { left: -0.35, right: 1.35, up: -0.25, down: 1.25 }[dir];
  const axis = dir === 'left' || dir === 'right' ? 'x' : 'y';
  const to = axis === 'x' ? 0.5 : 0.5;
  return {
    [axis]: [kf(0, from, 'easeOut'), kf(end, to)],
    opacity: [kf(0, 0.2, 'easeOut'), kf(end * 0.8, 1)],
  };
}
function slideOut(dir, d) {
  const start = Math.max(0, d - Math.min(0.55, d * 0.5));
  const to = { left: -0.35, right: 1.35, up: -0.25, down: 1.25 }[dir];
  const axis = dir === 'left' || dir === 'right' ? 'x' : 'y';
  return {
    [axis]: [kf(start, 0.5), kf(d, to, 'easeIn')],
    opacity: [kf(start, 1), kf(d, 0.15, 'easeIn')],
  };
}
function zoomIn(d) {
  const end = Math.min(0.8, d * 0.6);
  return { scale: [kf(0, 1.28, 'easeOut'), kf(end, 1)] };
}
function zoomOut(d) {
  const start = Math.max(0, d - Math.min(0.8, d * 0.6));
  return { scale: [kf(start, 1), kf(d, 1.28, 'easeIn')] };
}
function spinIn(d) {
  const end = Math.min(0.7, d * 0.55);
  return {
    rotate: [kf(0, -160, 'easeOut'), kf(end, 0)],
    scale: [kf(0, 0.6, 'easeOut'), kf(end, 1)],
    opacity: [kf(0, 0, 'easeOut'), kf(end * 0.7, 1)],
  };
}
function kenBurns(d) {
  const span = Math.max(0.6, d);
  return {
    scale: [kf(0, 1, 'linear'), kf(span, 1.14)],
    x: [kf(0, 0.5, 'linear'), kf(span, 0.54)],
    y: [kf(0, 0.5, 'linear'), kf(span, 0.47)],
  };
}
function shake(d) {
  const step = 0.09;
  const out = { x: [kf(0, 0.5, 'linear')], y: [kf(0, 0.5, 'linear')], rotate: [kf(0, 0, 'linear')] };
  const count = Math.min(40, Math.floor(d / step));
  for (let i = 1; i <= count; i++) {
    const t = i * step;
    const amt = 0.018 * (1 - i / (count + 2));
    out.x.push(kf(t, 0.5 + (i % 2 ? amt : -amt), 'linear'));
    out.y.push(kf(t, 0.5 + (i % 3 ? -amt * 0.6 : amt * 0.6), 'linear'));
    out.rotate.push(kf(t, i % 2 ? -0.8 : 0.8, 'linear'));
  }
  out.x.push(kf(d, 0.5, 'linear'));
  out.y.push(kf(d, 0.5, 'linear'));
  out.rotate.push(kf(d, 0, 'linear'));
  return out;
}
function pulse(d) {
  const out = { scale: [] };
  const period = 0.66;
  for (let t = 0; t <= d + 1e-6; t += period) {
    out.scale.push(kf(Math.min(t, d), 1, 'linear'));
    if (t + period * 0.5 <= d) out.scale.push(kf(t + period * 0.5, 1.075, 'easeInOut'));
  }
  if (out.scale[out.scale.length - 1].t < d) out.scale.push(kf(d, 1, 'linear'));
  return out;
}
function wobble(d) {
  const out = { rotate: [] };
  const period = 0.8;
  let sign = 1;
  for (let t = 0; t <= d + 1e-6; t += period / 2) {
    out.rotate.push(kf(Math.min(t, d), sign * 2.4, 'easeInOut'));
    sign *= -1;
  }
  out.rotate.push(kf(d, 0, 'easeInOut'));
  return out;
}

export const ANIM_PRESETS = [
  { id: 'none', name: 'None', group: 'both', build: () => ({}) },
  { id: 'fade-in', name: 'Fade in', group: 'in', build: fadeIn },
  { id: 'pop-in', name: 'Pop in', group: 'in', build: popIn },
  { id: 'slide-left-in', name: 'Slide from right', group: 'in', build: (d) => slide('left', d) },
  { id: 'slide-right-in', name: 'Slide from left', group: 'in', build: (d) => slide('right', d) },
  { id: 'slide-up-in', name: 'Slide from bottom', group: 'in', build: (d) => slide('up', d) },
  { id: 'slide-down-in', name: 'Slide from top', group: 'in', build: (d) => slide('down', d) },
  { id: 'zoom-in', name: 'Zoom in', group: 'in', build: zoomIn },
  { id: 'spin-in', name: 'Spin in', group: 'in', build: spinIn },
  { id: 'fade-out', name: 'Fade out', group: 'out', build: fadeOut },
  { id: 'pop-out', name: 'Pop out', group: 'out', build: popOut },
  { id: 'slide-left-out', name: 'Slide to left', group: 'out', build: (d) => slideOut('left', d) },
  { id: 'slide-right-out', name: 'Slide to right', group: 'out', build: (d) => slideOut('right', d) },
  { id: 'zoom-out', name: 'Zoom out', group: 'out', build: zoomOut },
  { id: 'ken-burns', name: 'Ken Burns', group: 'combo', build: kenBurns },
  { id: 'shake', name: 'Shake', group: 'combo', build: shake },
  { id: 'pulse', name: 'Pulse', group: 'combo', build: pulse },
  { id: 'wobble', name: 'Wobble', group: 'combo', build: wobble },
];

export const animPreset = (id) => ANIM_PRESETS.find((p) => p.id === id) || null;

/** Merge generated keyframes into a clip (keeps the clip's own start/duration). */
export function applyAnimation(clip, presetId) {
  const preset = animPreset(presetId);
  if (!clip || !preset) return false;
  clip.keyframes = clip.keyframes || {};
  if (preset.id === 'none') {
    for (const id of ['x', 'y', 'scale', 'rotate', 'opacity']) delete clip.keyframes[id];
    return true;
  }
  const generated = preset.build(clip.duration || 3);
  for (const [prop, list] of Object.entries(generated)) {
    if (!list || !list.length) continue;
    const existing = (clip.keyframes[prop] || []).filter((kf) => list.every((n) => Math.abs(n.t - kf.t) > 0.02));
    clip.keyframes[prop] = [...existing, ...list].sort((a, b) => a.t - b.t);
  }
  return true;
}

/* --------------------------------------------------------- transitions ----------------------------------------------------------------- */

/**
 * Transitions between a clip and the clip that follows it on the same track.
 * `build(a, b, d)` returns keyframes for each side.
 */
export const TRANSITIONS = [
  {
    id: 'dip-black', name: 'Dip to black', duration: 0.6,
    build: (a, b, d) => ({
      a: { opacity: [kf(a.duration - d, 1), kf(a.duration, 0, 'easeIn')] },
      b: { opacity: [kf(0, 0, 'easeOut'), kf(d, 1)] },
    }),
  },
  {
    id: 'dissolve', name: 'Cross dissolve', duration: 0.5,
    build: (a, b, d) => ({
      a: { opacity: [kf(a.duration - d, 1), kf(a.duration, 0.35, 'easeIn')] },
      b: { opacity: [kf(0, 0.35, 'easeOut'), kf(d, 1)] },
    }),
  },
  {
    id: 'slide', name: 'Slide push', duration: 0.5,
    build: (a, b, d) => ({
      a: { x: [kf(a.duration - d, 0.5), kf(a.duration, 0.12, 'easeIn')] },
      b: { x: [kf(0, 1.3, 'easeOut'), kf(d, 0.5)] },
    }),
  },
  {
    id: 'zoom-punch', name: 'Zoom punch', duration: 0.45,
    build: (a, b, d) => ({
      a: { scale: [kf(a.duration - d, 1), kf(a.duration, 1.5, 'easeIn')], opacity: [kf(a.duration - d, 1), kf(a.duration, 0, 'easeIn')] },
      b: { scale: [kf(0, 0.7, 'easeOut'), kf(d, 1)] },
    }),
  },
  {
    id: 'spin', name: 'Spin', duration: 0.6,
    build: (a, b, d) => ({
      a: { rotate: [kf(a.duration - d, 0), kf(a.duration, -22, 'easeIn')], opacity: [kf(a.duration - d, 1), kf(a.duration, 0, 'easeIn')] },
      b: { rotate: [kf(0, 18, 'easeOut'), kf(d, 0)], scale: [kf(0, 0.86, 'easeOut'), kf(d, 1)] },
    }),
  },
  {
    id: 'flash', name: 'Flash', duration: 0.35,
    build: (a, b, d) => ({
      a: { adjust: null },
      b: {
        opacity: [kf(0, 0, 'easeOut'), kf(d, 1)],
        brightness: [kf(0, 1.9, 'easeOut'), kf(d, 1)],
      },
    }),
  },
];

export const transitionById = (id) => TRANSITIONS.find((t) => t.id === id) || TRANSITIONS[0];

export function applyTransition(clipA, clipB, transitionId, seconds) {
  const transition = transitionById(transitionId);
  if (!clipA || !clipB || !transition) return false;
  const d = Math.max(0.15, Number(seconds) || transition.duration);
  const built = transition.build(clipA, clipB, d);
  for (const [side, clip] of [['a', clipA], ['b', clipB]]) {
    const frames = built[side] || {};
    clip.keyframes = clip.keyframes || {};
    for (const [prop, list] of Object.entries(frames)) {
      if (!list) continue;
      const existing = (clip.keyframes[prop] || []).filter((kf2) => list.every((n) => Math.abs(n.t - kf2.t) > 0.02));
      clip.keyframes[prop] = [...existing, ...list].sort((x, y) => x.t - y.t);
    }
  }
  return true;
}

/* ----------------------------------------------------------- audio tools ---------------------------------------------------------------- */

export const AUDIO_TOOLS = [
  { id: 'voice', name: 'Voice clarity', eq: { low: -4, mid: 5, high: 3 } },
  { id: 'bass', name: 'Bass boost', eq: { low: 7, mid: 0, high: 0 } },
  { id: 'podcast', name: 'Podcast', eq: { low: -2, mid: 3, high: 2 } },
  { id: 'bright', name: 'Bright', eq: { low: -2, mid: 0, high: 5 } },
  { id: 'flat', name: 'Flat (reset)', eq: { low: 0, mid: 0, high: 0 } },
  { id: 'telephone', name: 'Telephone', eq: { low: -18, mid: 8, high: -12 } },
];

/** Quick one-click ducking: fade the music clip down while speech plays. */
export function buildDuckingKeyframes(clip, regions) {
  const list = [];
  const base = clip.volume ?? 1;
  list.push(kf(0, base));
  for (const region of regions) {
    const t0 = Math.max(0, region.start - clip.start - 0.25);
    const t1 = Math.max(0, region.start - clip.start);
    const t2 = Math.max(0, region.end - clip.start);
    const t3 = Math.max(0, region.end - clip.start + 0.35);
    if (t1 <= 0 && t2 <= 0) continue;
    list.push(kf(t0, base));
    list.push(kf(Math.max(0, t1), base * 0.22));
    list.push(kf(Math.min(clip.duration, t2), base * 0.22));
    list.push(kf(Math.min(clip.duration, t3), base));
  }
  list.push(kf(clip.duration, base));
  const unique = new Map();
  for (const kf2 of list) unique.set(kf2.t.toFixed(2), kf2);
  clip.keyframes = clip.keyframes || {};
  const existing = (clip.keyframes.volume || []).filter((kf2) => !unique.has(kf2.t.toFixed(2)));
  clip.keyframes.volume = [...existing, ...unique.values()].sort((a, b) => a.t - b.t);
  return clip.keyframes.volume;
}

export const FILTER_BY_ID = (id) => FILTER_PRESETS.find((p) => p.id === id) || FILTER_PRESETS[0];

/** Write a grading preset into a clip (base colour + overlay effect params). */
export function applyFilter(clip, preset) {
  const target = { ...(clip.adjust || {}) };
  for (const key of Object.keys(target)) if (!(key in (preset.adjust || {}))) delete target[key];
  Object.assign(target, preset.adjust || {});
  clip.adjust = target;
  clip.fx = { vignette: 0, grain: 0, fade: 0, leak: 0, ...(clip.fx || {}) };
  if (preset.adjust?.vignette !== undefined) clip.fx.vignette = preset.adjust.vignette;
  if (preset.adjust?.grain !== undefined) clip.fx.grain = preset.adjust.grain;
  if (preset.adjust?.fade !== undefined) clip.fx.fade = preset.adjust.fade;
  if (preset.adjust?.lightLeak !== undefined) clip.fx.leak = preset.adjust.lightLeak;
  return clip;
}
