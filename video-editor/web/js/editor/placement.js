/* ==========================================================================
   ClipForge — putting media / titles onto the timeline
   ========================================================================== */

import { store, makeClip, addClip, makeTextClip, trackById, TITLE_PRESETS, history, projectDuration } from './state.js';

export function defaultTrackFor(kind) {
  const tracks = store.project.tracks;
  if (kind === 'text') {
    return tracks.find((t) => t.type === 'text') || tracks[tracks.length - 1];
  }
  return tracks.find((t) => t.type === 'video') || tracks[0];
}

export function trackEnd(track) {
  return track.clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0);
}

/** Add a media item to a track. at === null → append after the last clip. */
export function placeMediaOnTimeline(media, { trackId = null, at = null, append = true } = {}) {
  if (!media) return null;
  const preferred = trackById(trackId);
  const track = preferred && !preferred.locked ? preferred : defaultTrackFor(media.kind);
  if (!track) return null;
  const start = at !== null && at !== undefined
    ? Math.max(0, at)
    : append ? trackEnd(track) : store.t;
  const clip = makeClip(media, { start, trackId: track.id });
  addClip(clip, track.id);
  store.setStatus(`Added ${media.name} to ${track.name}`);
  return clip;
}

export function placeTextClip(preset = TITLE_PRESETS[0], { at = null, text = null } = {}) {
  const track = defaultTrackFor('text');
  const start = at !== null ? Math.max(0, at) : trackEnd(track);
  const clip = makeTextClip({ start, duration: 3, preset, text });
  addClip(clip, track.id);
  store.setStatus(`Added title “${clip.text.value}”`);
  return clip;
}

/** Append every item in the media bin, one after another. */
export function addAllMediaToTimeline() {
  const items = Array.from(store.media.values());
  if (!items.length) {
    store.setStatus('Import some media first', 'warn');
    return 0;
  }
  const before = JSON.parse(JSON.stringify(store.project));
  const track = defaultTrackFor('video');
  let cursor = trackEnd(track);
  let added = 0;
  for (const media of items) {
    const clip = makeClip(media, { start: cursor, trackId: track.id });
    track.clips.push(clip);
    cursor += clip.duration;
    added++;
  }
  track.clips.sort((a, b) => a.start - b.start);
  history.commit(`Add ${added} clips`, before);
  store.emit('project', { reason: 'add-all' });
  store.setStatus(`Added ${added} clip${added === 1 ? '' : 's'} to ${track.name}`);
  return added;
}

/** Total timeline length (used by "fit" buttons). */
export const timelineLength = () => projectDuration();
