/* ==========================================================================
   ClipForge — right-hand inspector: clip timing, transform, colour, audio, text
   ========================================================================== */

import { $, el, clamp, deepClone, fmtTimecode, fmtDuration } from './utils.js';
import {
  store, history, selectedClips, removeSelected, duplicateClip, splitSelectionAt,
  maxClipDuration, FILTER_PRESETS, DEFAULT_ADJUSTMENTS, TITLE_PRESETS,
} from './state.js';

const FONTS = [
  { id: 'Inter, ui-sans-serif, system-ui, sans-serif', name: 'Inter / system' },
  { id: 'Georgia, "Times New Roman", serif', name: 'Serif (Georgia)' },
  { id: 'ui-monospace, SFMono-Regular, Menlo, monospace', name: 'Mono' },
  { id: '"Trebuchet MS", sans-serif', name: 'Trebuchet' },
  { id: '"Impact", "Arial Black", sans-serif', name: 'Impact' },
  { id: '"Comic Sans MS", cursive', name: 'Comic' },
];

export function mountInspector({ player, onChanged }) {
  const root = $('#inspector');
  let before = null;          // snapshot for the current edit gesture

  const snapshot = () => { if (!before) before = deepClone(store.project); };
  const commit = (label) => {
    if (before) history.commit(label, before);
    before = null;
    store.emit('project', { reason: label });
    onChanged?.();
  };
  const live = () => { onChanged?.(); player?.requestRender(); };

  function mutate(fn, label, { record = true } = {}) {
    if (record) snapshot();
    fn();
    if (record) commit(label);
    else live();
  }

  /* ------------------------------------------------------------ widgets */

  function section(title, children, { sub = null } = {}) {
    return el('section', { class: 'insp-section' }, [
      el('h4', { class: 'insp-title', text: title }),
      sub ? el('p', { class: 'insp-sub', text: sub }) : null,
      ...children,
    ]);
  }

  function row(label, control, value) {
    return el('div', { class: 'insp-row' }, [
      el('label', { text: label }),
      control,
      value !== undefined ? el('span', { class: 'insp-val', text: value }) : null,
    ]);
  }

  function slider({ key, label, min, max, step, value, format = (v) => v, onInput, onCommit }) {
    const input = el('input', {
      type: 'range', min, max, step, value,
      class: 'insp-range',
      dataset: { key },
    });
    const out = el('span', { class: 'insp-val', text: format(value) });
    input.addEventListener('pointerdown', snapshot);
    input.addEventListener('keydown', snapshot);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = format(v);
      onInput?.(v);
      live();
    });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      onCommit?.(v);
      commit(label || key);
    });
    return el('div', { class: 'insp-row' }, [el('label', { text: label }), input, out]);
  }

  function numberInput({ key, label, value, min, max, step = 0.1, suffix = '', onCommit }) {
    const input = el('input', {
      type: 'number', value: Number(value.toFixed(3)), min, max, step,
      class: 'insp-num', dataset: { key },
    });
    input.addEventListener('focus', snapshot);
    input.addEventListener('change', () => {
      let v = Number(input.value);
      if (!isFinite(v)) v = value;
      if (min !== undefined) v = Math.max(min, v);
      if (max !== undefined) v = Math.min(max, v);
      input.value = String(Number(v.toFixed(3)));
      mutate(() => onCommit(v), label || key);
    });
    return el('div', { class: 'insp-row' }, [el('label', { text: label }), input, suffix ? el('span', { class: 'insp-val', text: suffix }) : null]);
  }

  function toggle({ key, label, value, onCommit }) {
    const input = el('input', { type: 'checkbox', class: 'insp-check', dataset: { key } });
    input.checked = Boolean(value);
    input.addEventListener('change', () => mutate(() => onCommit(input.checked), label || key));
    return el('div', { class: 'insp-row' }, [el('label', { text: label }), input]);
  }

  function select({ key, label, value, options, onCommit }) {
    const sel = el('select', { class: 'insp-select', dataset: { key } });
    for (const opt of options) {
      const option = el('option', { value: String(opt.value), text: opt.label });
      if (String(opt.value) === String(value)) option.selected = true;
      sel.append(option);
    }
    sel.addEventListener('change', () => mutate(() => onCommit(sel.value), label || key));
    return el('div', { class: 'insp-row' }, [el('label', { text: label }), sel]);
  }

  function colorRow({ key, label, value, onCommit }) {
    const input = el('input', { type: 'color', value, class: 'insp-color', dataset: { key } });
    input.addEventListener('input', () => {
      snapshot();
      onCommit(input.value);
      live();
    });
    input.addEventListener('change', () => commit(label || key));
    return el('div', { class: 'insp-row' }, [el('label', { text: label }), input]);
  }

  function chips(items, { activeId, onPick }) {
    return el('div', { class: 'chip-row' }, items.map((item) => el('button', {
      class: `chip${activeId === item.id ? ' active' : ''}`,
      title: item.name,
      text: item.name,
      onclick: () => onPick(item),
    })));
  }

  /* ------------------------------------------------------------- render */

  function render() {
    const active = document.activeElement;
    const focusKey = active && root.contains(active) ? active.dataset?.key : null;
    const caret = active?.selectionStart ?? null;

    root.innerHTML = '';
    const selection = selectedClips();

    if (!selection.length) {
      root.append(el('div', { class: 'insp-empty' }, [
        el('span', { class: 'insp-empty-ico', text: '🎯' }),
        el('p', { text: 'Select a clip on the timeline to edit it.' }),
        el('p', { class: 'muted', text: 'Tip: double-click a clip to split it at that point.' }),
      ]));
      return;
    }

    if (selection.length > 1) {
      root.append(renderMulti(selection));
      restoreFocus(focusKey, caret);
      return;
    }

    const { clip, track } = selection[0];
    root.append(renderHeader(clip, track));
    root.append(renderTiming(clip));
    if (clip.kind !== 'text' && clip.kind !== 'audio') root.append(renderTransform(clip));
    if (clip.kind === 'text') root.append(renderText(clip));
    if (clip.kind !== 'text') root.append(renderColor(clip));
    if (clip.kind !== 'text' || clip.kind === 'text') root.append(renderAudio(clip));
    root.append(renderActions(clip));
    restoreFocus(focusKey, caret);
  }

  function restoreFocus(key, caret) {
    if (!key) return;
    const node = root.querySelector(`[data-key="${key}"]`);
    if (!node) return;
    node.focus({ preventScroll: true });
    if (caret !== null && typeof node.setSelectionRange === 'function' && node.type !== 'range') {
      try { node.setSelectionRange(caret, caret); } catch { /* not a text field */ }
    }
  }

  function renderHeader(clip, track) {
    const media = clip.mediaId ? store.media.get(clip.mediaId) : null;
    return el('div', { class: 'insp-head' }, [
      el('span', { class: `kind-pill kind-${clip.kind}`, text: clip.kind }),
      el('strong', { class: 'insp-head-name', text: clip.kind === 'text' ? (clip.text?.value || 'Text') : (media?.name || clip.label || 'Clip'), title: clip.label }),
      el('span', { class: 'insp-head-track', text: track.name }),
    ]);
  }

  function renderTiming(clip) {
    const media = clip.mediaId ? store.media.get(clip.mediaId) : null;
    const maxDur = maxClipDuration(clip);
    const rows = [
      numberInput({
        key: 'start', label: 'Start (s)', value: clip.start, min: 0, step: 0.05,
        onCommit: (v) => { clip.start = v; },
      }),
      numberInput({
        key: 'duration', label: 'Duration (s)', value: clip.duration, min: 0.1, max: maxDur, step: 0.05,
        onCommit: (v) => { clip.duration = clamp(v, 0.1, maxDur); },
      }),
      el('div', { class: 'insp-row' }, [
        el('label', { text: 'Ends at' }),
        el('span', { class: 'insp-readout', text: fmtTimecode(clip.start + clip.duration) }),
      ]),
    ];
    if (media && media.kind !== 'image') {
      const maxIn = Math.max(0, (media.duration || clip.duration) - clip.duration * (clip.speed || 1));
      rows.push(numberInput({
        key: 'in', label: 'Source in (s)', value: clip.in || 0, min: 0, max: maxIn, step: 0.05,
        onCommit: (v) => { clip.in = clamp(v, 0, Math.max(0, maxIn)); },
      }));
    }

    const speedPresets = [0.25, 0.5, 1, 1.5, 2, 4];
    rows.push(el('div', { class: 'insp-row' }, [
      el('label', { text: 'Speed' }),
      el('div', { class: 'chip-row tight' }, speedPresets.map((s) => el('button', {
        class: `chip${Math.abs((clip.speed || 1) - s) < 0.001 ? ' active' : ''}`,
        text: `${s}×`,
        onclick: () => mutate(() => {
          const oldSpeed = clip.speed || 1;
          const sourceSpan = clip.duration * oldSpeed;
          clip.speed = s;
          const limit = media && media.duration ? (media.duration - (clip.in || 0)) / s : Infinity;
          clip.duration = clamp(sourceSpan / s, 0.1, limit);
        }, 'Clip speed'),
      }))),
    ]));

    if (clip.kind !== 'text') {
      rows.push(el('div', { class: 'insp-row' }, [
        el('label', { text: 'Fades' }),
        el('div', { class: 'chip-row tight' }, [
          el('button', { class: 'chip', text: 'In', onclick: () => mutate(() => { clip.fadeIn = Math.min(clip.duration / 2, 0.6); }, 'Fade in') }),
          el('button', { class: 'chip', text: 'Out', onclick: () => mutate(() => { clip.fadeOut = Math.min(clip.duration / 2, 0.6); }, 'Fade out') }),
          el('button', { class: 'chip', text: 'Both', onclick: () => mutate(() => { clip.fadeIn = Math.min(clip.duration / 2, 0.4); clip.fadeOut = Math.min(clip.duration / 2, 0.4); }, 'Fades') }),
          el('button', { class: 'chip', text: 'Clear', onclick: () => mutate(() => { clip.fadeIn = 0; clip.fadeOut = 0; }, 'Clear fades') }),
        ]),
      ]));
    }
    return section('Timing', rows, { sub: media ? `${media.name} · source ${fmtDuration(media.duration || 0)}` : 'Text overlay' });
  }

  function renderTransform(clip) {
    return section('Transform', [
      slider({ key: 'x', label: 'Position X', min: 0, max: 1, step: 0.005, value: clip.x ?? 0.5, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { clip.x = v; } }),
      slider({ key: 'y', label: 'Position Y', min: 0, max: 1, step: 0.005, value: clip.y ?? 0.5, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { clip.y = v; } }),
      slider({ key: 'scale', label: 'Zoom', min: 0.1, max: 4, step: 0.01, value: clip.scale ?? 1, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { clip.scale = v; } }),
      slider({ key: 'rotate', label: 'Rotate', min: -180, max: 180, step: 1, value: clip.rotate ?? 0, format: (v) => `${v}°`, onInput: (v) => { clip.rotate = v; } }),
      slider({ key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01, value: clip.opacity ?? 1, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { clip.opacity = v; } }),
      el('div', { class: 'chip-row tight' }, [
        el('button', { class: 'chip', text: 'Fill', onclick: () => mutate(() => { clip.scale = 1; clip.x = 0.5; clip.y = 0.5; }, 'Reset transform') }),
        el('button', { class: 'chip', text: '50%', onclick: () => mutate(() => { clip.scale = 0.5; clip.x = 0.5; clip.y = 0.5; }, 'Half size') }),
        el('button', { class: 'chip', text: 'Reset', onclick: () => mutate(() => { Object.assign(clip, { scale: 1, x: 0.5, y: 0.5, rotate: 0, opacity: 1 }); }, 'Reset transform') }),
      ]),
    ]);
  }

  function renderColor(clip) {
    const adjust = { ...DEFAULT_ADJUSTMENTS, ...(clip.adjust || {}) };
    const applyPreset = (preset) => mutate(() => {
      clip.adjust = { ...deepClone(preset.adjust) };
    }, `Filter ${preset.name}`);
    return section('Colour & filters', [
      chips(FILTER_PRESETS, { activeId: FILTER_PRESETS.find((p) => JSON.stringify({ ...DEFAULT_ADJUSTMENTS, ...p.adjust }) === JSON.stringify(adjust))?.id, onPick: applyPreset }),
      slider({ key: 'brightness', label: 'Brightness', min: 0.2, max: 2, step: 0.01, value: adjust.brightness, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { clip.adjust = { ...(clip.adjust || {}), brightness: v }; } }),
      slider({ key: 'contrast', label: 'Contrast', min: 0.2, max: 2.5, step: 0.01, value: adjust.contrast, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { clip.adjust = { ...(clip.adjust || {}), contrast: v }; } }),
      slider({ key: 'saturation', label: 'Saturation', min: 0, max: 3, step: 0.01, value: adjust.saturation, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { clip.adjust = { ...(clip.adjust || {}), saturation: v }; } }),
      slider({ key: 'hue', label: 'Hue shift', min: -180, max: 180, step: 1, value: adjust.hue, format: (v) => `${v}°`, onInput: (v) => { clip.adjust = { ...(clip.adjust || {}), hue: v }; } }),
      slider({ key: 'blur', label: 'Blur', min: 0, max: 24, step: 0.1, value: adjust.blur, format: (v) => `${v}px`, onInput: (v) => { clip.adjust = { ...(clip.adjust || {}), blur: v }; } }),
      slider({ key: 'grayscale', label: 'Black & white', min: 0, max: 1, step: 0.01, value: adjust.grayscale, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { clip.adjust = { ...(clip.adjust || {}), grayscale: v }; } }),
      slider({ key: 'sepia', label: 'Sepia', min: 0, max: 1, step: 0.01, value: adjust.sepia, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { clip.adjust = { ...(clip.adjust || {}), sepia: v }; } }),
      el('div', { class: 'chip-row tight' }, [
        el('button', { class: 'chip', text: 'Reset colour', onclick: () => mutate(() => { clip.adjust = {}; }, 'Reset colour') }),
      ]),
    ]);
  }

  function renderText(clip) {
    const style = clip.text?.style || {};
    const setStyle = (patch) => { clip.text.style = { ...clip.text.style, ...patch }; };
    const area = el('textarea', { class: 'insp-textarea', dataset: { key: 'textValue' }, rows: 3 });
    area.value = clip.text?.value || '';
    area.addEventListener('focus', snapshot);
    area.addEventListener('input', () => {
      clip.text.value = area.value;
      clip.label = area.value;
      live();
    });
    area.addEventListener('change', () => commit('Edit text'));
    area.addEventListener('blur', () => commit('Edit text'));

    return section('Text', [
      el('div', { class: 'insp-row col' }, [el('label', { text: 'Content' }), area]),
      slider({ key: 'fontSize', label: 'Size', min: 0.02, max: 0.3, step: 0.002, value: style.fontSize ?? 0.08, format: (v) => `${Math.round(v * 1000) / 10}%`, onInput: (v) => { setStyle({ fontSize: v }); } }),
      select({
        key: 'fontFamily', label: 'Font', value: style.fontFamily || FONTS[0].id,
        options: FONTS.map((f) => ({ value: f.id, label: f.name })),
        onCommit: (v) => setStyle({ fontFamily: v }),
      }),
      select({
        key: 'fontWeight', label: 'Weight', value: String(style.fontWeight || 700),
        options: [300, 400, 600, 700, 800, 900].map((w) => ({ value: String(w), label: String(w) })),
        onCommit: (v) => setStyle({ fontWeight: Number(v) }),
      }),
      colorRow({ key: 'textColor', label: 'Colour', value: style.color || '#ffffff', onCommit: (v) => setStyle({ color: v }) }),
      select({
        key: 'align', label: 'Align', value: style.align || 'center',
        options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }],
        onCommit: (v) => setStyle({ align: v }),
      }),
      slider({ key: 'y', label: 'Vertical', min: 0.05, max: 0.95, step: 0.005, value: style.y ?? 0.5, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { setStyle({ y: v }); } }),
      slider({ key: 'x', label: 'Horizontal', min: 0.02, max: 0.98, step: 0.005, value: style.x ?? 0.5, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { setStyle({ x: v }); } }),
      slider({ key: 'letterSpacing', label: 'Spacing', min: -0.05, max: 0.3, step: 0.005, value: style.letterSpacing ?? 0, format: (v) => `${Math.round(v * 1000) / 10}%`, onInput: (v) => { setStyle({ letterSpacing: v }); } }),
      toggle({ key: 'uppercase', label: 'UPPERCASE', value: style.uppercase, onCommit: (v) => setStyle({ uppercase: v }) }),
      slider({ key: 'outlineWidth', label: 'Outline', min: 0, max: 0.04, step: 0.001, value: style.outline?.width ?? 0, format: (v) => `${Math.round(v * 1000) / 10}%`, onInput: (v) => { setStyle({ outline: { ...(style.outline || {}), width: v } }); } }),
      colorRow({ key: 'outlineColor', label: 'Outline colour', value: style.outline?.color || '#000000', onCommit: (v) => setStyle({ outline: { ...(style.outline || {}), color: v } }) }),
      slider({ key: 'shadowBlur', label: 'Glow / shadow', min: 0, max: 60, step: 1, value: style.shadow?.blur ?? 0, format: (v) => `${v}`, onInput: (v) => { setStyle({ shadow: { ...(style.shadow || {}), blur: v } }); } }),
      colorRow({ key: 'shadowColor', label: 'Shadow colour', value: style.shadow?.color || 'rgba(0,0,0,0.6)', onCommit: (v) => setStyle({ shadow: { ...(style.shadow || {}), color: v } }) }),
      toggle({ key: 'hasBg', label: 'Background plate', value: Boolean(style.bg), onCommit: (v) => setStyle({ bg: v ? { color: 'rgba(0,0,0,.45)', pad: 0.014 } : undefined }) }),
      style.bg ? colorRow({ key: 'bgColor', label: 'Plate colour', value: toHex(style.bg.color), onCommit: (v) => setStyle({ bg: { ...style.bg, color: v } }) }) : null,
      el('div', { class: 'chip-row tight' }, [
        el('button', { class: 'chip', text: 'Reset style', onclick: () => mutate(() => {
          const preset = TITLE_PRESETS.find((p) => p.id === clip.text.preset) || TITLE_PRESETS[0];
          clip.text.style = deepClone(preset.style);
        }, 'Reset text style') }),
        el('button', { class: 'chip', text: 'Re-centre', onclick: () => mutate(() => setStyle({ x: 0.5, y: 0.5 }), 'Centre text') }),
      ]),
    ]);
  }

  function renderAudio(clip) {
    return section('Audio', [
      toggle({ key: 'muted', label: 'Mute this clip', value: clip.muted, onCommit: (v) => { clip.muted = v; } }),
      slider({ key: 'volume', label: 'Volume', min: 0, max: 2, step: 0.01, value: clip.volume ?? 1, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { clip.volume = v; } }),
      slider({ key: 'fadeIn', label: 'Fade in', min: 0, max: 5, step: 0.05, value: clip.fadeIn ?? 0, format: (v) => `${v.toFixed(2)}s`, onInput: (v) => { clip.fadeIn = Math.min(v, clip.duration); } }),
      slider({ key: 'fadeOut', label: 'Fade out', min: 0, max: 5, step: 0.05, value: clip.fadeOut ?? 0, format: (v) => `${v.toFixed(2)}s`, onInput: (v) => { clip.fadeOut = Math.min(v, clip.duration); } }),
    ]);
  }

  function renderActions(clip) {
    return el('div', { class: 'insp-actions' }, [
      el('button', { class: 'btn btn-sm', text: '✂ Split at playhead', onclick: () => { splitSelectionAt(store.t); onChanged?.(); } }),
      el('button', { class: 'btn btn-sm', text: '⧉ Duplicate', onclick: () => duplicateClip(clip.id) }),
      el('button', { class: 'btn btn-sm', text: '⇤ Snap to playhead', onclick: () => mutate(() => { clip.start = Math.max(0, store.t); }, 'Snap to playhead') }),
      el('button', { class: 'btn btn-sm btn-danger', text: '🗑 Delete clip', onclick: () => removeSelected() }),
    ]);
  }

  function renderMulti(selection) {
    const kinds = new Set(selection.map(({ clip }) => clip.kind));
    const total = selection.reduce((sum, { clip }) => sum + clip.duration, 0);
    return el('div', {}, [
      el('div', { class: 'insp-head' }, [
        el('span', { class: 'kind-pill', text: `${selection.length} clips` }),
        el('strong', { class: 'insp-head-name', text: [...kinds].join(' + ') }),
      ]),
      section('Selection', [
        el('div', { class: 'insp-row' }, [el('label', { text: 'Total duration' }), el('span', { class: 'insp-readout', text: fmtDuration(total) })]),
        el('div', { class: 'insp-row' }, [el('label', { text: 'Set speed' }), el('div', { class: 'chip-row tight' }, [0.5, 1, 1.5, 2].map((s) => el('button', {
          class: 'chip', text: `${s}×`,
          onclick: () => mutate(() => {
            for (const { clip } of selection) {
              const sourceSpan = clip.duration * (clip.speed || 1);
              clip.duration = Math.max(0.1, sourceSpan / s);
              clip.speed = s;
            }
          }, 'Set speed'),
        })))]),
        el('div', { class: 'insp-row' }, [el('label', { text: 'Move' }), el('div', { class: 'chip-row tight' }, [
          el('button', { class: 'chip', text: '⇤ To playhead', onclick: () => mutate(() => { for (const { clip } of selection) clip.start = Math.max(0, store.t); }, 'Align to playhead') }),
          el('button', { class: 'chip', text: '⇥ Shift +1s', onclick: () => mutate(() => { for (const { clip } of selection) clip.start += 1; }, 'Shift clips') }),
        ])]),
        el('div', { class: 'chip-row tight' }, [
          el('button', { class: 'chip', text: kinds.has('text') ? 'Purple title' : 'Vivid', onclick: () => mutate(() => {
            for (const { clip } of selection) clip.adjust = { saturation: 1.4, contrast: 1.1 };
          }, 'Apply filter') }),
          el('button', { class: 'chip', text: 'Fade all', onclick: () => mutate(() => {
            for (const { clip } of selection) { clip.fadeIn = Math.min(clip.duration / 3, 0.5); clip.fadeOut = Math.min(clip.duration / 3, 0.5); }
          }, 'Fade all') }),
          el('button', { class: 'chip', text: 'Reset opacity', onclick: () => mutate(() => { for (const { clip } of selection) clip.opacity = 1; }, 'Reset opacity') }),
        ]),
      ]),
      el('div', { class: 'insp-actions' }, [
        el('button', { class: 'btn btn-sm', text: '✂ Split all at playhead', onclick: () => { splitSelectionAt(store.t); onChanged?.(); } }),
        el('button', { class: 'btn btn-sm', text: '⧉ Duplicate all', onclick: () => { for (const { clip } of selection) duplicateClip(clip.id); } }),
        el('button', { class: 'btn btn-sm btn-danger', text: '🗑 Delete all', onclick: () => removeSelected() }),
      ]),
    ]);
  }

  /* -------------------------------------------------------------- events */

  store.on('selection', render);
  store.on('project', render);
  store.on('media', render);
  window.addEventListener('clipforge:livedrag', () => {
    // refresh the numeric readouts while dragging on the timeline
    const selection = selectedClips();
    if (selection.length !== 1) return;
    const { clip } = selection[0];
    const startField = root.querySelector('[data-key="start"]');
    const durField = root.querySelector('[data-key="duration"]');
    if (startField && document.activeElement !== startField) startField.value = String(Number(clip.start.toFixed(2)));
    if (durField && document.activeElement !== durField) durField.value = String(Number(clip.duration.toFixed(2)));
  });

  render();
  return { render, refresh: render };
}

function toHex(color = '') {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const rgba = color.match(/rgba?\(([^)]+)\)/i);
  if (rgba) {
    const [r, g, b] = rgba[1].split(',').map((v) => parseInt(v.trim(), 10));
    return `#${[r, g, b].map((v) => clamp(v || 0, 0, 255).toString(16).padStart(2, '0')).join('')}`;
  }
  return '#000000';
}
