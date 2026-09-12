/* ==========================================================================
   ClipForge — transport / playback loop
   ========================================================================== */

import { clamp, roundToFrame } from './utils.js';
import { store, projectDuration } from './state.js';

export class Player {
  constructor(renderer) {
    this.renderer = renderer;
    this.raf = 0;
    this.lastFrame = 0;
    this.onEnded = null;

    // repaint when the playhead moves while paused (scrub, inspector edits)
    store.on('time', () => {
      if (!store.playing) this.requestRender();
    });
  }

  get duration() {
    return projectDuration();
  }

  requestRender() {
    if (this.raf || store.playing) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.renderOnce();
    });
  }

  renderOnce() {
    const t = store.t;
    this.renderer.sync(t, false);
    this.renderer.drawFrame(t);
  }

  play() {
    if (store.playing) return;
    if (this.duration <= 0.001) {
      store.setStatus('Add a clip to the timeline first', 'warn');
      return;
    }
    if (store.t >= this.duration - 0.02) store.setTime(0);
    this.renderer.resumeAudio();
    this.renderer.connectAllAudio();
    store.playing = true;
    store.emit('playing', { playing: true });
    this.lastFrame = performance.now();
    this.loop();
  }

  pause({ quiet = false } = {}) {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    if (!store.playing) return;
    store.playing = false;
    this.renderer.pauseAll();
    store.emit('playing', { playing: false });
    if (!quiet) this.renderOnce();
  }

  toggle() {
    if (store.playing) this.pause();
    else this.play();
  }

  seek(t, { quiet = false } = {}) {
    const duration = this.duration;
    const next = clamp(t, 0, Math.max(duration, t));
    store.setTime(roundToFrame(next, store.project.settings.fps || 30));
    if (quiet) return;
    this.renderOnce();
  }

  stepFrame(direction = 1) {
    this.pause();
    const fps = store.project.settings.fps || 30;
    this.seek(store.t + direction / fps);
  }

  jump(delta) {
    this.seek(store.t + delta);
  }

  loop = (now = performance.now()) => {
    if (!store.playing) return;
    const dt = Math.min(0.25, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    const duration = this.duration;
    let t = store.t + dt * (store.rate || 1);

    if (t >= duration) {
      if (store.loop) {
        t = 0;
      } else {
        store.setTime(duration);
        this.renderer.sync(duration - 0.001, false);
        this.renderer.drawFrame(duration - 0.001);
        this.pause({ quiet: true });
        store.emit('ended', { duration });
        this.onEnded?.(duration);
        return;
      }
    }
    store.setTime(t);
    this.renderer.sync(t, true);
    this.renderer.drawFrame(t);
    this.raf = requestAnimationFrame(this.loop);
  };
}
