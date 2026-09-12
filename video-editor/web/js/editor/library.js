/* ==========================================================================
   ClipForge — left-panel library: filters, animations, transitions,
   audio tools and music. Everything applies to the current selection.
   ========================================================================== */

import { $, el, deepClone } from './utils.js';
import { store, history, selectedClips, mediaById, findClip } from './state.js';
import { FILTER_PRESETS, ANIM_PRESETS, TRANSITIONS, AUDIO_TOOLS, applyFilter, applyAnimation, applyTransition, buildDuckingKeyframes } from './effects.js';
import { keyframeCount, clearKeyframes } from './anim.js';
import { toast } from './ui.js';

export function mountLibrary({ onChanged }) {
  let transitionDuration = 0.5;

  const mutate = (label, fn) => {
    const snapshot = deepClone(store.project);
    const result = fn();
    history.commit(label, snapshot);
    store.emit('project', { reason: label });
    onChanged?.();
    return result;
  };

  const selection = () => selectedClips();

  function requireSelection(message = 'Select a clip on the timeline first') {
    if (selection().length) return true;
    toast(message, { kind: 'warn', timeout: 2200 });
    return false;
  }

  /* ------------------------------------------------------------- filters */

  function thumbFor(clip) {
    const media = clip?.mediaId ? mediaById(clip.mediaId) : null;
    return media?.thumb || null;
  }

  function filterStyle(preset) {
    const a = preset.adjust || {};
    const filters = [];
    if (a.brightness) filters.push(`brightness(${a.brightness})`);
    if (a.contrast) filters.push(`contrast(${a.contrast})`);
    if (a.saturation !== undefined) filters.push(`saturate(${a.saturation})`);
    if (a.hue) filters.push(`hue-rotate(${a.hue}deg)`);
    if (a.sepia) filters.push(`sepia(${a.sepia})`);
    if (a.grayscale) filters.push(`grayscale(${a.grayscale})`);
    if (a.blur) filters.push(`blur(${Math.min(3, a.blur)}px)`);
    if (a.temperature > 0) filters.push(`sepia(${(a.temperature * 0.36).toFixed(2)})`);
    if (a.temperature < 0) filters.push(`hue-rotate(${(a.temperature * -18).toFixed(0)}deg)`);
    if (a.tint > 0) filters.push(`hue-rotate(${(a.tint * -10).toFixed(0)}deg)`);
    if (a.tint < 0) filters.push(`hue-rotate(${(a.tint * -12).toFixed(0)}deg)`);
    return filters.length ? { filter: filters.join(' ') } : {};
  }

  function renderFilters() {
    const host = $('#libFilters');
    if (!host) return;
    const clips = selection();
    const clip = clips[0]?.clip || null;
    const thumb = thumbFor(clip);
    const activeId = clip
      ? FILTER_PRESETS.find((p) => {
          const merged = p.adjust || {};
          const current = clip.adjust || {};
          return Object.keys(merged).every((k) => Math.abs((merged[k] ?? 0) - (current[k] ?? 0)) < 0.02)
            && Object.keys(current).every((k) => k in merged);
        })?.id
      : null;

    host.innerHTML = '';
    for (const preset of FILTER_PRESETS) {
      const swatch = el('span', { class: `preset-swatch sw-${preset.id}`, style: filterStyle(preset) });
      if (thumb) swatch.style.backgroundImage = `url(${thumb})`;
      host.append(el('button', {
        class: `preset-tile${activeId === preset.id ? ' active' : ''}`,
        title: `Apply ${preset.name}`,
        onclick: () => {
          if (!requireSelection()) return;
          mutate(`Filter ${preset.name}`, () => {
            for (const { clip: target } of selection()) {
              applyFilter(target, preset);
              for (const key of ['brightness', 'contrast', 'saturation', 'hue', 'grayscale', 'sepia', 'temperature', 'tint', 'blur']) {
                delete target.keyframes?.[key];
              }
            }
          });
          toast(`${preset.name} applied`, { kind: 'success', timeout: 1200 });
        },
      }, [swatch, el('span', { class: 'preset-name', text: preset.name })]));
    }
  }

  /* ---------------------------------------------------------- animations */

  function animGroup(groupId) {
    const clips = selection();
    const host = $(`#libAnim-${groupId}`);
    if (!host) return;
    host.innerHTML = '';
    const presets = ANIM_PRESETS.filter((p) => p.group === groupId || p.group === 'both');
    for (const preset of presets) {
      host.append(el('button', {
        class: 'chip',
        text: preset.name,
        onclick: () => {
          if (!requireSelection()) return;
          mutate(`Animation ${preset.name}`, () => {
            for (const { clip } of selection()) {
              if (preset.id === 'none') clip.keyframes = {};
              else applyAnimation(clip, preset.id);
            }
          });
          toast(`${preset.name} → ${selection().length} clip${selection().length > 1 ? 's' : ''}`, { kind: 'success', timeout: 1400 });
        },
      }));
    }
  }

  /* --------------------------------------------------------- transitions */

  function nextClipOnTrack(clip) {
    const found = findClip(clip.id);
    if (!found) return null;
    const track = found.track;
    const after = track.clips
      .filter((other) => other.id !== clip.id && other.start >= clip.start + clip.duration - 0.2)
      .sort((a, b) => a.start - b.start);
    return after[0] || null;
  }

  function renderTransitions() {
    const host = $('#libTransitions');
    if (!host) return;
    host.innerHTML = '';
    const clips = selection();
    const clip = clips[0]?.clip;
    const target = clip ? nextClipOnTrack(clip) : null;
    for (const transition of TRANSITIONS) {
      const disabled = !target;
      host.append(el('button', {
        class: 'chip lib-transition',
        text: transition.name,
        title: disabled ? 'Put another clip right after this one on the same track' : `Apply ${transition.name} (${transitionDuration}s)`,
        disabled,
        onclick: () => {
          if (!requireSelection()) return;
          const current = selection()[0].clip;
          const next = nextClipOnTrack(current);
          if (!next) {
            toast('Add a clip straight after this one on the same track first', { kind: 'warn', timeout: 2600 });
            return;
          }
          mutate(`Transition ${transition.name}`, () => applyTransition(current, next, transition.id, transitionDuration));
          toast(`${transition.name} applied between the two clips`, { kind: 'success', timeout: 2000 });
        },
      }));
    }
    const note = $('#libTransitionNote');
    if (note) {
      note.textContent = clip
        ? (target ? `Next clip: “${target.label || target.kind}” at ${target.start.toFixed(2)}s` : 'No clip follows this one on its track yet.')
        : 'Select a clip to use transitions.';
    }
  }

  /* -------------------------------------------------------- audio tools */

  function renderAudio() {
    const host = $('#libAudioTools');
    if (!host) return;
    host.innerHTML = '';
    for (const tool of AUDIO_TOOLS) {
      host.append(el('button', {
        class: 'chip',
        text: tool.name,
        onclick: () => {
          if (!requireSelection()) return;
          mutate(`Audio ${tool.name}`, () => {
            for (const { clip } of selection()) {
              if (clip.kind === 'text') continue;
              clip.eq = tool.id === 'flat' ? { low: 0, mid: 0, high: 0 } : { low: 0, mid: 0, high: 0, ...tool.eq };
            }
          });
          toast(`${tool.name} applied`, { kind: 'success', timeout: 1400 });
        },
      }));
    }
    const duck = $('#libDuck');
    if (duck) {
      duck.onclick = () => {
        if (!requireSelection()) return;
        mutate('Auto duck', () => {
          for (const { clip } of selection()) {
            const regions = store.project.tracks
              .flatMap((track) => track.clips)
              .filter((other) => other.id !== clip.id && !other.muted && other.kind !== 'text')
              .map((other) => ({ start: other.start, end: other.start + other.duration }));
            buildDuckingKeyframes(clip, regions);
          }
        });
        toast('Ducking keyframes added — volume drops under every other clip', { kind: 'success', timeout: 2600 });
      };
    }
    const clear = $('#libClearVolume');
    if (clear) {
      clear.onclick = () => {
        if (!requireSelection()) return;
        mutate('Clear volume automation', () => {
          for (const { clip } of selection()) clearKeyframes(clip, 'volume');
        });
      };
    }
    const info = $('#libAudioInfo');
    if (info) {
      const clips = selection();
      const kf = clips.reduce((n, { clip }) => n + keyframeCount(clip), 0);
      info.textContent = clips.length
        ? `${clips.length} clip${clips.length > 1 ? 's' : ''} selected · ${kf} keyframes`
        : 'Select an audio or video clip to use these tools.';
    }
  }

  /* ------------------------------------------------------------ wiring */

  function renderAll() {
    renderFilters();
    animGroup('in');
    animGroup('out');
    animGroup('combo');
    renderTransitions();
    renderAudio();
  }

  const durationSelect = $('#libTransitionDuration');
  durationSelect?.addEventListener('change', () => {
    transitionDuration = Number(durationSelect.value);
    renderTransitions();
  });

  store.on('selection', renderAll);
  store.on('project', renderAll);
  store.on('media', renderAll);
  renderAll();

  return { render: renderAll };
}
