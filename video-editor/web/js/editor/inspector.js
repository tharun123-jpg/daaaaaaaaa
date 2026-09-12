/* ==========================================================================
   ClipForge — right-hand inspector
   Keyframable clip properties, animation presets, colour grading, effects,
   EQ + audio tools, text styling and multi-selection actions.
   ========================================================================== */

import { $, el, clamp, deepClone, fmtTimecode, fmtDuration } from './utils.js';
import {
  store, history, selectedClips, removeSelected, duplicateClip, splitSelectionAt,
  maxClipDuration, DEFAULT_ADJUSTMENTS, TITLE_PRESETS, mediaById, defaultTrackOfType,
  makeTrack,
} from './state.js';
import {
  propDef, setBaseValue, sampleProperty, hasKeyframes, keyframesOf,
  keyframeCount, keyframeAt, setKeyframe, removeKeyframeAt, clearKeyframes,
  nextKeyframe, prevKeyframe, EASINGS, setFx,
} from './anim.js';
import { FILTER_PRESETS, ANIM_PRESETS, AUDIO_TOOLS, buildDuckingKeyframes, applyAnimation, applyFilter } from './effects.js';
import { toast } from './ui.js';

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
  let before = null;

  const snapshot = () => { if (!before) before = deepClone(store.project); };
  const commit = (label) => {
    if (before) history.commit(label, before);
    before = null;
    store.emit('project', { reason: label });
    onChanged?.();
  };
  const live = () => { onChanged?.(); player?.requestRender(); };
  const mutate = (fn, label) => {
    const snap = deepClone(store.project);
    fn();
    history.commit(label, snap);
    store.emit('project', { reason: label });
    onChanged?.();
  };

  const localTime = (clip) => clamp(store.t - clip.start, 0, clip.duration);

  /* ------------------------------------------------------------ widgets */

  function section(title, children, { sub = null, id = null } = {}) {
    return el('section', { class: 'insp-section', dataset: id ? { section: id } : {} }, [
      el('h4', { class: 'insp-title', text: title }),
      sub ? el('p', { class: 'insp-sub', text: sub }) : null,
      ...children,
    ]);
  }

  function plainRow(label, control, value) {
    return el('div', { class: 'insp-row' }, [
      el('label', { text: label }),
      control,
      value !== undefined ? (typeof value === 'string' ? el('span', { class: 'insp-val', text: value }) : value) : null,
    ]);
  }

  /**
   * The workhorse: one animatable property.
   * Renders a slider (or number field), the live value, and the ◆ keyframe
   * controls. With keyframes present the slider edits the keyframe at the
   * playhead instead of the base value.
   */
  function animRow(clip, propId, opts = {}) {
    const def = propDef(propId);
    if (!def) return el('div');
    const local = localTime(clip);
    const keyed = hasKeyframes(clip, propId);
    const value = sampleProperty(clip, propId, local);
    const kfHere = keyframeAt(clip, propId, local);
    const list = keyframesOf(clip, propId);

    const input = el('input', {
      type: 'range', class: 'insp-range', dataset: { key: propId },
      min: opts.min ?? def.min, max: opts.max ?? def.max, step: opts.step ?? def.step,
      value: String(Number(value.toFixed(4))),
    });
    const out = el('span', { class: 'insp-val', text: def.fmt(value) });

    input.addEventListener('pointerdown', snapshot);
    input.addEventListener('keydown', snapshot);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = def.fmt(v);
      if (hasKeyframes(clip, propId)) setKeyframe(clip, propId, localTime(clip), v, opts.easing || 'easeInOut');
      else setBaseValue(clip, propId, v);
      live();
    });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (hasKeyframes(clip, propId)) setKeyframe(clip, propId, localTime(clip), v, opts.easing || 'easeInOut');
      else setBaseValue(clip, propId, v);
      commit(`${def.label}`);
    });

    const kfButton = el('button', {
      class: `kf-btn${kfHere ? ' active' : ''}${keyed ? ' keyed' : ''}`,
      title: kfHere ? 'Remove keyframe at the playhead' : 'Add keyframe at the playhead (◆)',
      text: '◆',
      dataset: { kf: propId },
      onclick: () => {
        mutate(() => {
          if (keyframeAt(clip, propId, localTime(clip))) {
            removeKeyframeAt(clip, propId, localTime(clip));
          } else {
            setKeyframe(clip, propId, localTime(clip), sampleProperty(clip, propId, localTime(clip)), opts.easing || 'easeInOut');
          }
        }, `Keyframe ${def.label}`);
      },
    });

    const controls = el('div', { class: 'kf-controls' }, [
      keyed ? el('button', {
        class: 'kf-nav', title: 'Previous keyframe', text: '◀',
        onclick: () => {
          const prev = prevKeyframe(clip, propId, localTime(clip));
          if (prev) player.seek(clip.start + prev.t);
        },
      }) : null,
      kfButton,
      keyed ? el('button', {
        class: 'kf-nav', title: 'Next keyframe', text: '▶',
        onclick: () => {
          const next = nextKeyframe(clip, propId, localTime(clip));
          if (next) player.seek(clip.start + next.t);
        },
      }) : null,
      keyed ? el('span', { class: 'kf-count', text: String(list.length) }) : null,
    ]);

    const row = el('div', { class: `insp-row anim${keyed ? ' keyed' : ''}` }, [
      el('label', { text: def.label }),
      input,
      out,
      controls,
    ]);

    if (keyed) {
      const easing = kfHere?.e || list[0]?.e || 'easeInOut';
      row.append(el('div', { class: 'insp-sub-row' }, [
        el('span', { class: 'muted tiny', text: 'easing' }),
        el('select', {
          class: 'insp-select tiny-select', dataset: { key: `${propId}-ease` },
          onchange: (event) => {
            mutate(() => {
              const target = kfHere || prevKeyframe(clip, propId, localTime(clip)) || list[0];
              if (target) target.e = event.target.value;
            }, `Easing ${def.label}`);
          },
        }, EASINGS.map((e) => el('option', { value: e.id, text: e.label, selected: e.id === easing }))),
        el('button', {
          class: 'chip tiny-chip', text: 'add at playhead',
          onclick: () => mutate(() => setKeyframe(clip, propId, localTime(clip), sampleProperty(clip, propId, localTime(clip))), 'Add keyframe'),
        }),
        el('button', {
          class: 'chip tiny-chip danger', text: 'clear',
          onclick: () => mutate(() => clearKeyframes(clip, propId), 'Clear keyframes'),
        }),
      ]));
    }
    return row;
  }

  function numberRow({ label, value, min, max, step = 0.05, onCommit, key }) {
    const input = el('input', { type: 'number', class: 'insp-num', dataset: { key }, value: String(Number(value.toFixed(3))), min, max, step });
    input.addEventListener('focus', snapshot);
    input.addEventListener('change', () => {
      let v = Number(input.value);
      if (!isFinite(v)) v = value;
      if (min !== undefined) v = Math.max(min, v);
      if (max !== undefined) v = Math.min(max, v);
      input.value = String(Number(v.toFixed(3)));
      mutate(() => onCommit(v), label);
    });
    return plainRow(label, input);
  }

  function toggleRow({ key, label, value, onCommit }) {
    const input = el('input', { type: 'checkbox', class: 'insp-check', dataset: { key } });
    input.checked = Boolean(value);
    input.addEventListener('change', () => mutate(() => onCommit(input.checked), label));
    return plainRow(label, input);
  }

  function selectRow({ key, label, value, options, onCommit }) {
    const sel = el('select', { class: 'insp-select', dataset: { key } });
    for (const opt of options) {
      const option = el('option', { value: String(opt.value), text: opt.label });
      if (String(opt.value) === String(value)) option.selected = true;
      sel.append(option);
    }
    sel.addEventListener('change', () => mutate(() => onCommit(sel.value), label));
    return plainRow(label, sel);
  }

  function colorRow({ key, label, value, onCommit }) {
    const input = el('input', { type: 'color', value, class: 'insp-color', dataset: { key } });
    input.addEventListener('input', () => { snapshot(); onCommit(input.value); live(); });
    input.addEventListener('change', () => commit(label));
    return plainRow(label, input);
  }

  function chips(items, { activeId, onPick, className = '' } = {}) {
    return el('div', { class: `chip-row ${className}`.trim() }, items.map((item) => el('button', {
      class: `chip${activeId === item.id ? ' active' : ''}`,
      title: item.name,
      text: item.name,
      onclick: () => onPick(item),
    })));
  }

  /* --------------------------------------------------------------- render */

  function render() {
    const active = document.activeElement;
    const focusKey = active && root.contains(active) ? active.dataset?.key : null;

    root.innerHTML = '';
    const selection = selectedClips();

    if (!selection.length) {
      root.append(el('div', { class: 'insp-empty' }, [
        el('span', { class: 'insp-empty-ico', text: '🎯' }),
        el('p', { text: 'Select a clip on the timeline to edit it.' }),
        el('p', { class: 'muted', text: 'Click ◆ next to any slider to animate it over time.' }),
      ]));
      return;
    }

    if (selection.length > 1) {
      root.append(renderMulti(selection));
      restoreFocus(focusKey);
      return;
    }

    const { clip, track } = selection[0];
    root.append(renderHeader(clip, track));
    root.append(section('Animation', [renderAnimation(clip)], { sub: `${keyframeCount(clip)} keyframe${keyframeCount(clip) === 1 ? '' : 's'} on this clip` }));
    root.append(renderTiming(clip));
    if (clip.kind !== 'audio') root.append(renderTransform(clip));
    if (clip.kind === 'text') root.append(renderText(clip));
    if (clip.kind !== 'text') root.append(renderColour(clip));
    if (clip.kind !== 'text' && clip.kind !== 'audio') root.append(renderFx(clip));
    if (clip.kind !== 'text' || clip.mediaId) root.append(renderAudio(clip));
    root.append(renderActions(clip));
    restoreFocus(focusKey);
  }

  function restoreFocus(key) {
    if (!key) return;
    const node = root.querySelector(`[data-key="${key}"]`);
    node?.focus({ preventScroll: true });
  }

  function renderHeader(clip, track) {
    const media = clip.mediaId ? mediaById(clip.mediaId) : null;
    const kf = keyframeCount(clip);
    return el('div', { class: 'insp-head' }, [
      el('span', { class: `kind-pill kind-${clip.kind}`, text: clip.kind }),
      el('strong', { class: 'insp-head-name', text: clip.kind === 'text' ? (clip.text?.value || 'Text') : (media?.name || clip.label || 'Clip'), title: clip.label }),
      el('span', { class: 'insp-head-track', text: track.name }),
      kf ? el('span', { class: 'kf-badge', text: `◆ ${kf}` }) : null,
    ]);
  }

  function renderAnimation(clip) {
    const groups = [
      { id: 'in', name: 'In' },
      { id: 'out', name: 'Out' },
      { id: 'combo', name: 'Combo' },
    ];
    const body = groups.map((group) => el('div', { class: 'anim-group' }, [
      el('span', { class: 'anim-group-name', text: group.name }),
      el('div', { class: 'chip-row tight' }, ANIM_PRESETS
        .filter((p) => p.group === group.id || p.group === 'both')
        .map((preset) => el('button', {
          class: 'chip',
          text: preset.name,
          title: `Apply “${preset.name}” animation`,
          onclick: () => {
            mutate(() => applyAnimation(clip, preset.id), `Animation ${preset.name}`);
            toast(`${preset.name} applied`, { kind: 'success', timeout: 1400 });
          },
        }))),
    ]));
    body.push(el('div', { class: 'chip-row tight' }, [
      el('button', {
        class: 'chip', text: 'Clean all animation',
        onclick: () => mutate(() => { clip.keyframes = {}; }, 'Clear keyframes'),
      }),
      el('button', {
        class: 'chip', text: 'Fit to playhead',
        onclick: () => mutate(() => {
          for (const list of Object.values(clip.keyframes || {})) {
            for (const kf of list) kf.t = clamp(kf.t, 0, clip.duration);
          }
        }, 'Clamp keyframes'),
      }),
    ]));
    return el('div', {}, body);
  }

  function renderTiming(clip) {
    const media = clip.mediaId ? mediaById(clip.mediaId) : null;
    const maxDur = maxClipDuration(clip);
    const rows = [
      el('div', { class: 'insp-duo' }, [
        numberRow({ key: 'start', label: 'Start (s)', value: clip.start, min: 0, onCommit: (v) => { clip.start = v; } }),
        numberRow({ key: 'duration', label: 'Duration (s)', value: clip.duration, min: 0.1, max: maxDur, onCommit: (v) => { clip.duration = clamp(v, 0.1, maxDur); } }),
      ]),
      plainRow('Ends at', el('span', { class: 'insp-readout', text: fmtTimecode(clip.start + clip.duration) })),
    ];
    if (media && media.kind !== 'image') {
      const maxIn = Math.max(0, (media.duration || clip.duration) - clip.duration * (clip.speed || 1));
      rows.push(numberRow({
        key: 'in', label: 'Source in (s)', value: clip.in || 0, min: 0, max: maxIn,
        onCommit: (v) => { clip.in = clamp(v, 0, Math.max(0, maxIn)); },
      }));
    }
    rows.push(el('div', { class: 'insp-row' }, [
      el('label', { text: 'Speed' }),
      el('div', { class: 'chip-row tight' }, [0.25, 0.5, 1, 1.5, 2, 4].map((s) => el('button', {
        class: `chip${Math.abs((clip.speed || 1) - s) < 0.001 ? ' active' : ''}`,
        text: `${s}×`,
        onclick: () => mutate(() => {
          const oldSpeed = clip.speed || 1;
          const sourceSpan = clip.duration * oldSpeed;
          clip.speed = s;
          const limit = media && media.duration ? (media.duration - (clip.in || 0)) / s : Infinity;
          clip.duration = clamp(sourceSpan / s, 0.1, limit);
          for (const list of Object.values(clip.keyframes || {})) {
            for (const kf of list) kf.t = clamp(kf.t * (s / oldSpeed), 0, clip.duration);
          }
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
      animRow(clip, 'x'),
      animRow(clip, 'y'),
      animRow(clip, 'scale'),
      animRow(clip, 'rotate'),
      animRow(clip, 'opacity'),
      el('div', { class: 'chip-row tight' }, [
        el('button', { class: 'chip', text: 'Fill', onclick: () => mutate(() => { setBaseValue(clip, 'scale', 1); setBaseValue(clip, 'x', 0.5); setBaseValue(clip, 'y', 0.5); clearKeyframes(clip, 'scale'); clearKeyframes(clip, 'x'); clearKeyframes(clip, 'y'); }, 'Reset transform') }),
        el('button', { class: 'chip', text: '50%', onclick: () => mutate(() => { setBaseValue(clip, 'scale', 0.5); setBaseValue(clip, 'x', 0.5); setBaseValue(clip, 'y', 0.5); }, 'Half size') }),
        el('button', { class: 'chip', text: 'Reset', onclick: () => mutate(() => { setBaseValue(clip, 'scale', 1); setBaseValue(clip, 'x', 0.5); setBaseValue(clip, 'y', 0.5); setBaseValue(clip, 'rotate', 0); setBaseValue(clip, 'opacity', 1); }, 'Reset transform') }),
      ]),
    ], { sub: 'Tip: ◆ adds a keyframe at the playhead, then drag the slider at another time to animate.' });
  }

  function renderColour(clip) {
    const adjust = { ...DEFAULT_ADJUSTMENTS, ...(clip.adjust || {}) };
    const activeId = FILTER_PRESETS.find((p) => {
      const preset = p.adjust || {};
      const merged = { ...DEFAULT_ADJUSTMENTS, ...preset };
      return ['brightness', 'contrast', 'saturation', 'hue', 'blur', 'grayscale', 'sepia', 'temperature', 'tint'].every((k) => Math.abs((merged[k] ?? 0) - (adjust[k] ?? 0)) < 0.02);
    })?.id;

    return section('Colour grading', [
      el('div', { class: 'preset-grid' }, FILTER_PRESETS.map((preset) => el('button', {
        class: `preset-tile${activeId === preset.id ? ' active' : ''}`,
        title: preset.name,
        onclick: () => mutate(() => {
          applyFilter(clip, preset);
          for (const key of ['brightness', 'contrast', 'saturation', 'hue', 'grayscale', 'sepia', 'temperature', 'tint', 'blur']) {
            delete clip.keyframes?.[key];
          }
        }, `Filter ${preset.name}`),
      }, [
        el('span', { class: `preset-swatch sw-${preset.id}`, style: presetSwatchStyle(preset) }),
        el('span', { class: 'preset-name', text: preset.name }),
      ]))),
      animRow(clip, 'brightness'),
      animRow(clip, 'contrast'),
      animRow(clip, 'saturation'),
      animRow(clip, 'temperature'),
      animRow(clip, 'tint'),
      animRow(clip, 'hue'),
      animRow(clip, 'blur'),
      animRow(clip, 'grayscale'),
      animRow(clip, 'sepia'),
      el('div', { class: 'chip-row tight' }, [
        el('button', { class: 'chip', text: 'Reset colour', onclick: () => mutate(() => { clip.adjust = {}; for (const k of ['brightness', 'contrast', 'saturation', 'hue', 'blur', 'grayscale', 'sepia', 'temperature', 'tint']) clearKeyframes(clip, k); }, 'Reset colour') }),
      ]),
    ]);
  }

  function renderFx(clip) {
    return section('Effects', [
      animRow(clip, 'vignette'),
      animRow(clip, 'grain'),
      animRow(clip, 'fxFade'),
      animRow(clip, 'lightLeak'),
      el('div', { class: 'chip-row tight' }, [
        el('button', { class: 'chip', text: 'Vintage', onclick: () => mutate(() => { setFx(clip, 'grain', 0.4); setFx(clip, 'vignette', 0.3); setFx(clip, 'fade', 0.28); }, 'Vintage') }),
        el('button', { class: 'chip', text: 'Clean', onclick: () => mutate(() => { clip.fx = { vignette: 0, grain: 0, fade: 0, leak: 0 }; for (const k of ['vignette', 'grain', 'fxFade', 'lightLeak']) clearKeyframes(clip, k); }, 'Clean effects') }),
        el('button', { class: 'chip', text: 'Dreamy', onclick: () => mutate(() => { setFx(clip, 'leak', 0.3); setFx(clip, 'fade', 0.15); }, 'Dreamy') }),
      ]),
    ], { sub: 'Overlay effects are baked into the export.' });
  }

  function renderText(clip) {
    const style = clip.text?.style || {};
    const setStyle = (patch) => { clip.text.style = { ...clip.text.style, ...patch }; };
    const area = el('textarea', { class: 'insp-textarea', dataset: { key: 'textValue' }, rows: 3 });
    area.value = clip.text?.value || '';
    area.addEventListener('focus', snapshot);
    area.addEventListener('input', () => { clip.text.value = area.value; clip.label = area.value; live(); });
    area.addEventListener('change', () => commit('Edit text'));
    area.addEventListener('blur', () => commit('Edit text'));

    return section('Text style', [
      el('div', { class: 'insp-row col' }, [el('label', { text: 'Content' }), area]),
      animRow(clip, 'textSize'),
      animRow(clip, 'textX'),
      animRow(clip, 'textY'),
      animRow(clip, 'textSpacing'),
      selectRow({
        key: 'fontFamily', label: 'Font', value: style.fontFamily || FONTS[0].id,
        options: FONTS.map((f) => ({ value: f.id, label: f.name })),
        onCommit: (v) => setStyle({ fontFamily: v }),
      }),
      selectRow({
        key: 'fontWeight', label: 'Weight', value: String(style.fontWeight || 700),
        options: [300, 400, 600, 700, 800, 900].map((w) => ({ value: String(w), label: String(w) })),
        onCommit: (v) => setStyle({ fontWeight: Number(v) }),
      }),
      colorRow({ key: 'textColor', label: 'Colour', value: style.color || '#ffffff', onCommit: (v) => setStyle({ color: v }) }),
      selectRow({
        key: 'align', label: 'Align', value: style.align || 'center',
        options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }],
        onCommit: (v) => setStyle({ align: v }),
      }),
      toggleRow({ key: 'uppercase', label: 'UPPERCASE', value: style.uppercase, onCommit: (v) => setStyle({ uppercase: v }) }),
      animRow(clip, 'fxFade'),
      el('div', { class: 'insp-sub-row' }, [
        el('span', { class: 'muted tiny', text: 'outline' }),
        el('input', {
          type: 'range', class: 'insp-range', min: 0, max: 0.04, step: 0.001, dataset: { key: 'outlineWidth' },
          value: String(style.outline?.width ?? 0),
          oninput: (event) => { snapshot(); setStyle({ outline: { ...(style.outline || {}), width: Number(event.target.value) } }); live(); },
          onchange: () => commit('Outline'),
        }),
        el('input', {
          type: 'color', class: 'insp-color', dataset: { key: 'outlineColor' }, value: style.outline?.color || '#000000',
          oninput: (event) => { snapshot(); setStyle({ outline: { ...(style.outline || {}), color: event.target.value } }); live(); },
          onchange: () => commit('Outline colour'),
        }),
      ]),
      el('div', { class: 'insp-sub-row' }, [
        el('span', { class: 'muted tiny', text: 'glow' }),
        el('input', {
          type: 'range', class: 'insp-range', min: 0, max: 60, step: 1, dataset: { key: 'shadowBlur' },
          value: String(style.shadow?.blur ?? 0),
          oninput: (event) => { snapshot(); setStyle({ shadow: { ...(style.shadow || {}), blur: Number(event.target.value) } }); live(); },
          onchange: () => commit('Glow'),
        }),
        el('input', {
          type: 'color', class: 'insp-color', dataset: { key: 'shadowColor' }, value: toHex(style.shadow?.color || 'rgba(0,0,0,0.6)'),
          oninput: (event) => { snapshot(); setStyle({ shadow: { ...(style.shadow || {}), color: event.target.value } }); live(); },
          onchange: () => commit('Glow colour'),
        }),
      ]),
      toggleRow({ key: 'hasBg', label: 'Background plate', value: Boolean(style.bg), onCommit: (v) => setStyle({ bg: v ? { color: 'rgba(0,0,0,.45)', pad: 0.014 } : undefined }) }),
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
    const media = clip.mediaId ? mediaById(clip.mediaId) : null;
    const eq = { low: 0, mid: 0, high: 0, ...(clip.eq || {}) };
    const rows = [
      toggleRow({ key: 'muted', label: 'Mute this clip', value: clip.muted, onCommit: (v) => { clip.muted = v; } }),
      animRow(clip, 'volume', { min: 0, max: 2 }),
      el('div', { class: 'insp-sub-row' }, [
        el('span', { class: 'muted tiny', text: 'fade in' }),
        el('input', {
          type: 'range', class: 'insp-range', min: 0, max: 5, step: 0.05, dataset: { key: 'fadeIn' },
          value: String(clip.fadeIn ?? 0),
          oninput: (event) => { snapshot(); clip.fadeIn = Math.min(Number(event.target.value), clip.duration); live(); },
          onchange: () => commit('Fade in'),
        }),
      ]),
      el('div', { class: 'insp-sub-row' }, [
        el('span', { class: 'muted tiny', text: 'fade out' }),
        el('input', {
          type: 'range', class: 'insp-range', min: 0, max: 5, step: 0.05, dataset: { key: 'fadeOut' },
          value: String(clip.fadeOut ?? 0),
          oninput: (event) => { snapshot(); clip.fadeOut = Math.min(Number(event.target.value), clip.duration); live(); },
          onchange: () => commit('Fade out'),
        }),
      ]),
      el('h5', { class: 'insp-subtitle', text: '3-band EQ' }),
      animRow(clip, 'eqLow'),
      animRow(clip, 'eqMid'),
      animRow(clip, 'eqHigh'),
      chips(AUDIO_TOOLS, {
        onPick: (tool) => mutate(() => {
          if (tool.id === 'flat') clip.eq = { low: 0, mid: 0, high: 0 };
          else clip.eq = { ...eq, ...tool.eq };
        }, `Audio ${tool.name}`),
      }),
      el('div', { class: 'chip-row tight' }, [
        el('button', {
          class: 'chip', text: 'Duck under speech',
          title: 'Lower this clip automatically wherever another clip has sound',
          onclick: () => mutate(() => {
            const regions = store.project.tracks
              .flatMap((track) => track.clips)
              .filter((other) => other.id !== clip.id && !other.muted && other.kind !== 'text')
              .map((other) => ({ start: other.start, end: other.start + other.duration }));
            buildDuckingKeyframes(clip, regions);
          }, 'Auto duck'),
        }),
        clip.keyframes?.volume?.length ? el('button', {
          class: 'chip danger', text: 'Clear volume keyframes',
          onclick: () => mutate(() => clearKeyframes(clip, 'volume'), 'Clear volume keyframes'),
        }) : null,
      ]),
    ];

    if (clip.kind === 'video' && media) {
      rows.push(el('div', { class: 'chip-row tight' }, [
        el('button', {
          class: 'chip', text: '⤵ Detach audio to its own track',
          onclick: () => detachAudio(clip),
        }),
      ]));
    }
    return section('Audio', rows, {
      sub: clip.kind === 'audio'
        ? 'Volume, fades and EQ — animate volume with ◆ for ducking.'
        : 'Sound from this clip: volume, fades and EQ.',
    });
  }

  function detachAudio(clip) {
    const media = mediaById(clip.mediaId);
    if (!media || media.kind === 'image') {
      toast('That clip has no audio to detach', { kind: 'warn' });
      return;
    }
    mutate(() => {
      let track = defaultTrackOfType('audio');
      if (!track) {
        const count = store.project.tracks.filter((t) => t.type === 'audio').length + 1;
        track = makeTrack('audio', count);
        store.project.tracks.push(track);
      }
      const copy = deepClone(clip);
      copy.id = `${clip.id}_a${Math.random().toString(36).slice(2, 6)}`;
      copy.kind = 'audio';
      copy.label = `${clip.label} (audio)`;
      copy.fadeIn = clip.fadeIn;
      copy.fadeOut = clip.fadeOut;
      track.clips.push(copy);
      track.clips.sort((a, b) => a.start - b.start);
      clip.muted = true;               // avoid double audio
      store.selection.clear();
      store.selection.add(copy.id);
    }, 'Detach audio');
    toast('Audio moved to its own track — the video clip is muted', { kind: 'success', timeout: 3200 });
  }

  function renderActions(clip) {
    return el('div', { class: 'insp-actions' }, [
      el('button', { class: 'btn btn-sm', text: '✂ Split at playhead', onclick: () => { splitSelectionAt(store.t); onChanged?.(); } }),
      el('button', { class: 'btn btn-sm', text: '⧉ Duplicate', onclick: () => duplicateClip(clip.id) }),
      el('button', {
        class: 'btn btn-sm', text: '⇤ Snap to playhead',
        onclick: () => mutate(() => { clip.start = Math.max(0, store.t); }, 'Snap to playhead'),
      }),
      el('button', { class: 'btn btn-sm', text: '⏱ Copy timing from playhead', onclick: () => mutate(() => { clip.start = Math.max(0, store.t); }, 'Timing') }),
      el('button', { class: 'btn btn-sm btn-danger', text: '🗑 Delete clip', onclick: () => removeSelected() }),
    ]);
  }

  function renderMulti(selection) {
    const kinds = new Set(selection.map(({ clip }) => clip.kind));
    const total = selection.reduce((sum, { clip }) => sum + clip.duration, 0);
    const kfTotal = selection.reduce((sum, { clip }) => sum + keyframeCount(clip), 0);
    return el('div', {}, [
      el('div', { class: 'insp-head' }, [
        el('span', { class: 'kind-pill', text: `${selection.length} clips` }),
        el('strong', { class: 'insp-head-name', text: [...kinds].join(' + ') }),
      ]),
      section('Selection', [
        plainRow('Total duration', el('span', { class: 'insp-readout', text: fmtDuration(total) })),
        plainRow('Keyframes', el('span', { class: 'insp-readout', text: String(kfTotal) })),
        el('div', { class: 'insp-row' }, [
          el('label', { text: 'Set speed' }),
          el('div', { class: 'chip-row tight' }, [0.5, 1, 1.5, 2].map((s) => el('button', {
            class: 'chip', text: `${s}×`,
            onclick: () => mutate(() => {
              for (const { clip } of selection) {
                const sourceSpan = clip.duration * (clip.speed || 1);
                clip.duration = Math.max(0.1, sourceSpan / s);
                clip.speed = s;
              }
            }, 'Set speed'),
          }))),
        ]),
        el('div', { class: 'insp-row' }, [
          el('label', { text: 'Move' }),
          el('div', { class: 'chip-row tight' }, [
            el('button', { class: 'chip', text: '⇤ To playhead', onclick: () => mutate(() => { for (const { clip } of selection) clip.start = Math.max(0, store.t); }, 'Align to playhead') }),
            el('button', { class: 'chip', text: '⇥ +1s', onclick: () => mutate(() => { for (const { clip } of selection) clip.start += 1; }, 'Shift clips') }),
          ]),
        ]),
        el('div', { class: 'insp-row' }, [
          el('label', { text: 'Animation' }),
          el('div', { class: 'chip-row tight' }, ['fade-in', 'pop-in', 'ken-burns', 'pulse'].map((id) => {
            const preset = ANIM_PRESETS.find((p) => p.id === id);
            return el('button', {
              class: 'chip', text: preset?.name || id,
              onclick: () => {
                mutate(() => {
                  for (const { clip } of selection) applyAnimation(clip, id);
                }, `Animation ${preset?.name}`);
              },
            });
          })),
        ]),
        el('div', { class: 'chip-row tight' }, [
          el('button', { class: 'chip', text: 'Vivid', onclick: () => mutate(() => { for (const { clip } of selection) clip.adjust = { ...(clip.adjust || {}), saturation: 1.4, contrast: 1.1 }; }, 'Apply filter') }),
          el('button', { class: 'chip', text: 'Fade all', onclick: () => mutate(() => { for (const { clip } of selection) { clip.fadeIn = Math.min(clip.duration / 3, 0.5); clip.fadeOut = Math.min(clip.duration / 3, 0.5); } }, 'Fade all') }),
          el('button', { class: 'chip danger', text: 'Clear keyframes', onclick: () => mutate(() => { for (const { clip } of selection) clip.keyframes = {}; }, 'Clear keyframes') }),
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
  store.on('time', () => {
    // keep the animated values in sync while playing / scrubbing
    const selection = selectedClips();
    if (selection.length !== 1) return;
    const { clip } = selection[0];
    if (!keyframeCount(clip)) return;
    const local = localTime(clip);
    for (const node of root.querySelectorAll('input[type="range"][data-key]')) {
      const id = node.dataset.key;
      if (!hasKeyframes(clip, id) || document.activeElement === node) continue;
      const value = sampleProperty(clip, id, local);
      node.value = String(Number(value.toFixed(4)));
      const out = node.parentElement?.querySelector('.insp-val');
      const def = propDef(id);
      if (out && def) out.textContent = def.fmt(value);
    }
    for (const node of root.querySelectorAll('.kf-btn[data-kf]')) {
      node.classList.toggle('active', Boolean(keyframeAt(clip, node.dataset.kf, local)));
    }
  });

  window.addEventListener('clipforge:livedrag', () => {
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

function presetSwatchStyle(preset) {
  const a = preset.adjust || {};
  const filters = [];
  if (a.brightness) filters.push(`brightness(${a.brightness})`);
  if (a.contrast) filters.push(`contrast(${a.contrast})`);
  if (a.saturation !== undefined) filters.push(`saturate(${a.saturation})`);
  if (a.hue) filters.push(`hue-rotate(${a.hue}deg)`);
  if (a.sepia) filters.push(`sepia(${a.sepia})`);
  if (a.grayscale) filters.push(`grayscale(${a.grayscale})`);
  if (a.blur) filters.push(`blur(${Math.min(3, a.blur)}px)`);
  if (a.temperature > 0) filters.push(`sepia(${(a.temperature * 0.35).toFixed(2)})`);
  if (a.temperature < 0) filters.push(`hue-rotate(${(a.temperature * -16).toFixed(0)}deg)`);
  if (a.tint > 0) filters.push(`hue-rotate(${(a.tint * -10).toFixed(0)}deg)`);
  if (a.tint < 0) filters.push(`hue-rotate(${(a.tint * -12).toFixed(0)}deg)`);
  return filters.length ? { filter: filters.join(' ') } : {};
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

