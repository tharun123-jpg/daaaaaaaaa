/* ==========================================================================
   ClipForge — export: render the timeline in real time and record it
   ========================================================================== */

import { $, el, downloadBlob, clamp, humanBytes, fmtDuration } from './utils.js';
import { store, projectDuration } from './state.js';
import { openModal, progressCard, toast, field } from './ui.js';
import { markDirty } from './storage.js';

const FORMATS = [
  { id: 'webm-vp9', label: 'WebM · VP9 (best quality)', mime: 'video/webm;codecs=vp9,opus' },
  { id: 'webm-vp8', label: 'WebM · VP8 (most compatible)', mime: 'video/webm;codecs=vp8,opus' },
  { id: 'webm', label: 'WebM · default', mime: 'video/webm' },
  { id: 'mp4-h264', label: 'MP4 · H.264 (Safari / iPhone)', mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2' },
  { id: 'mp4', label: 'MP4 · default', mime: 'video/mp4' },
];

const QUALITIES = [
  { id: '480p', label: '480p — small file', height: 480, bitrate: 2_500_000 },
  { id: '720p', label: '720p — recommended', height: 720, bitrate: 5_000_000 },
  { id: '1080p', label: '1080p — full HD', height: 1080, bitrate: 9_000_000 },
  { id: 'source', label: 'Match project size', height: 0, bitrate: 0 },
];

function supportedFormats() {
  const list = [];
  for (const format of FORMATS) {
    const ok = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(format.mime);
    if (ok) list.push(format);
  }
  return list;
}

export function mountExport({ player, renderer, onFinished }) {
  const button = $('#btnExport');
  button?.addEventListener('click', () => openExportDialog());

  $('#btnSnapshot')?.addEventListener('click', () => {
    try {
      const canvas = $('#preview');
      const url = canvas.toDataURL('image/png');
      const a = el('a', { href: url, download: `clipforge-frame-${Date.now()}.png` });
      document.body.append(a);
      a.click();
      a.remove();
      toast('Frame saved as PNG', { kind: 'success' });
    } catch {
      toast('Could not capture this frame', { kind: 'warn' });
    }
  });

  function openExportDialog() {
    const duration = projectDuration();
    if (duration <= 0.01) {
      toast('Add at least one clip before exporting', { kind: 'warn' });
      return;
    }
    const formats = supportedFormats();
    if (!formats.length) {
      toast('This browser cannot record video — try Chrome or Edge', { kind: 'warn' });
      return;
    }

    const state = {
      format: formats[0].id,
      quality: '720p',
      fps: 30,
      customBitrate: 6_000_000,
      audio: true,
      filename: `${(store.project.name || 'clipforge-export').replace(/[^\w\-. ]+/g, '_')}.${formats[0].mime.includes('mp4') ? 'mp4' : 'webm'}`,
    };

    const formatSelect = el('select', { class: 'insp-select' }, formats.map((f) => el('option', { value: f.id, text: f.label })));
    const qualitySelect = el('select', { class: 'insp-select' }, QUALITIES.map((q) => el('option', { value: q.id, text: q.label, selected: q.id === state.quality })));
    const fpsSelect = el('select', { class: 'insp-select' }, [24, 30, 60].map((f) => el('option', { value: String(f), text: `${f} fps`, selected: f === 30 })));
    const audioToggle = el('input', { type: 'checkbox', checked: true, class: 'insp-check' });
    const nameInput = el('input', { class: 'insp-num wide', value: state.filename });
    const bitrateInput = el('input', { type: 'range', min: 1_000_000, max: 16_000_000, step: 250_000, value: 6_000_000, class: 'insp-range' });
    const bitrateOut = el('span', { class: 'insp-val', text: '6.0 Mbps' });
    const estimate = el('p', { class: 'modal-note' });

    const updateEstimate = () => {
      const quality = QUALITIES.find((q) => q.id === state.quality) || QUALITIES[1];
      const bitrate = quality.bitrate || state.customBitrate;
      const bytes = (bitrate / 8) * duration;
      estimate.textContent = `Renders in real time (~${fmtDuration(duration)}) · about ${humanBytes(bytes)} · ${(store.project.settings.width)}×${store.project.settings.height} source`;
    };

    formatSelect.addEventListener('change', () => {
      state.format = formatSelect.value;
      const mime = formats.find((f) => f.id === state.format).mime;
      state.filename = state.filename.replace(/\.(webm|mp4)$/i, mime.includes('mp4') ? '.mp4' : '.webm');
      nameInput.value = state.filename;
    });
    qualitySelect.addEventListener('change', () => { state.quality = qualitySelect.value; updateEstimate(); });
    fpsSelect.addEventListener('change', () => { state.fps = Number(fpsSelect.value); });
    audioToggle.addEventListener('change', () => { state.audio = audioToggle.checked; });
    nameInput.addEventListener('input', () => { state.filename = nameInput.value; });
    bitrateInput.addEventListener('input', () => {
      state.customBitrate = Number(bitrateInput.value);
      bitrateOut.textContent = `${(state.customBitrate / 1_000_000).toFixed(1)} Mbps`;
      updateEstimate();
    });

    updateEstimate();

    openModal({
      title: 'Export video',
      width: 560,
      body: el('div', { class: 'form-grid' }, [
        el('p', { class: 'modal-note top', text: 'ClipForge records your timeline in real time, in this tab, on your own device. Keep the tab visible while it renders.' }),
        field('Format', formatSelect),
        field('Quality', qualitySelect),
        field('Frame rate', fpsSelect),
        field('Extra bitrate', el('div', { class: 'row-inline' }, [bitrateInput, bitrateOut])),
        field('Include audio', el('div', { class: 'row-inline' }, [audioToggle, el('span', { class: 'muted small', text: 'music, voice-over and clip sound' })])),
        field('File name', nameInput),
        estimate,
      ]),
      actions: [
        { label: 'Cancel' },
        { label: 'Start export', primary: true, onClick: (close) => { close(); startExport({ ...state, formats }); } },
      ],
    });
  }

  async function startExport(options) {
    const format = options.formats.find((f) => f.id === options.format);
    const quality = QUALITIES.find((q) => q.id === options.quality) || QUALITIES[1];
    const duration = projectDuration();
    const srcW = store.project.settings.width;
    const srcH = store.project.settings.height;
    const targetH = quality.height ? Math.min(quality.height, srcH) : srcH;
    const targetW = Math.max(2, Math.round((srcW * targetH) / srcH / 2) * 2);

    const card = progressCard({ title: 'Exporting video', icon: '🎬' });
    card.setActions([{ label: 'Cancel', danger: true, onClick: () => cancel() }]);

    let recorder = null;
    let cancelled = false;
    let chunks = [];
    const restoreSize = () => renderer.setSize(srcW, srcH);

    function cleanup() {
      player.pause({ quiet: true });
      store.playing = false;
      store.emit('playing', { playing: false });
      restoreSize();
      player.renderOnce();
    }

    function cancel() {
      cancelled = true;
      try { recorder?.state !== 'inactive' && recorder?.stop(); } catch { /* ignore */ }
      cleanup();
      card.close();
      toast('Export cancelled', { kind: 'warn' });
    }

    try {
      renderer.setSize(targetW, targetH);
      renderer.resumeAudio();
      renderer.connectAllAudio();
      player.seek(0, { quiet: true });
      player.pause({ quiet: true });
      renderer.sync(0, false);
      renderer.drawFrame(0);

      const stream = renderer.captureStream(options.fps);
      if (!stream) throw new Error('Canvas capture is not supported in this browser');

      if (options.audio) {
        const hasAudio = Array.from(store.media.values()).some((m) => m.kind !== 'image');
        if (hasAudio) {
          const dest = renderer.getRecordDestination();
          for (const track of dest?.stream.getAudioTracks() || []) stream.addTrack(track);
        }
      }

      const videoBits = quality.bitrate || Math.min(12_000_000, Math.max(2_500_000, targetW * targetH * 0.12));
      recorder = new MediaRecorder(stream, {
        mimeType: format.mime,
        videoBitsPerSecond: videoBits,
        audioBitsPerSecond: 128_000,
      });
      recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
      const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

      await new Promise((resolve) => setTimeout(resolve, 160)); // let the first frames land
      recorder.start(500);

      const onTime = () => {
        const t = store.t;
        card.update((t / duration) * 100, `Rendering ${fmtDuration(t)} of ${fmtDuration(duration)}…`);
      };
      store.on('time', onTime);

      await new Promise((resolve) => {
        const finish = () => {
          store.off('time', onTime);
          resolve();
        };
        player.onEnded = finish;
        player.play();
        // safety: stop if the player somehow stalls far beyond the duration
        setTimeout(finish, (duration + 12) * 1000);
      });

      player.onEnded = null;
      if (cancelled) return;

      card.update(100, 'Finishing…');
      await new Promise((resolve) => setTimeout(resolve, 260));
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;

      const blob = new Blob(chunks, { type: format.mime.split(';')[0] });
      chunks = [];
      cleanup();
      markDirty(false);

      card.update(100, `Ready · ${humanBytes(blob.size)} · ${fmtDuration(duration)}`);
      card.setActions([
        { label: `⬇ Download (${humanBytes(blob.size)})`, primary: true, onClick: () => { downloadBlob(blob, options.filename); toast('Saved to your downloads', { kind: 'success' }); } },
        { label: 'Export again', onClick: (api) => { api.close(); openExportDialog(); } },
        { label: 'Close', onClick: (api) => api.close() },
      ]);
      onFinished?.();
      toast('Export complete', { kind: 'success' });
    } catch (err) {
      console.error(err);
      cleanup();
      card.close();
      toast(`Export failed: ${err.message}`, { kind: 'warn', timeout: 5000 });
    }
  }

  return { openExportDialog };
}

export { clamp };
