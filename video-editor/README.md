# ClipForge — Online Video Editor

A complete video editor that runs **entirely in the browser**: a real multi-track
timeline, trimming, splitting, speed changes, colour filters, titles, audio mixing
and one-click export. No frameworks, no build step, no npm install — just
Python's standard library on the server and plain ES modules on the client.

```
video-editor/
├── server.py              # zero-dependency server (site + editor + project/media API)
├── web/
│   ├── index.html         # marketing page
│   ├── editor.html        # the editor app
│   ├── projects.html      # saved-project browser
│   ├── favicon.svg
│   ├── css/               # base.css · landing.css · editor.css
│   └── js/
│       ├── landing.js · projects.js
│       └── editor/        # utils · state · anim · effects · media · renderer · player
│                          # timeline · inspector · library · placement · export
│                          # storage · zip · ui · app
└── data/                  # created at runtime: projects/*.json + uploads/<id>/…
```

## Run it

```bash
cd video-editor
python3 server.py            # http://localhost:8000
PORT=9000 python3 server.py  # custom port
```

* Site → <http://localhost:8000/>
* Editor → <http://localhost:8000/editor>
* Saved projects → <http://localhost:8000/projects>

Python 3.8+ only (no `pip install`). The server binds `0.0.0.0` so it also works
behind a container/proxy hostname.

## What the editor can do

| Area | Details |
| --- | --- |
| **Import** | Drag & drop or browse MP4 · MOV · WebM · MKV · MP3 · M4A · WAV · OGG · PNG · JPG · WebP · GIF. Duration, size, thumbnails and audio waveforms are read locally. |
| **Timeline** | Unlimited tracks (video / text), drag to move, drag edges to trim, double-click to split, right-click menu (fade, mute, reset), snapping to clip edges & playhead, zoom 4–600 px/s, fit-to-window, ctrl+wheel zoom. |
| **Clips** | Start/duration/source-in, speed 0.25×–4×, opacity, zoom, position, rotation, per-clip volume, mute, fade in/out. |
| **Keyframes** | ◆ on any property row animates it: position, zoom, rotate, opacity, volume, **every colour value**, every effect, text size/position/spacing and EQ. Diamonds are drawn on the clip (drag to retime), easing per keyframe (linear, ease in/out, hold), prev/next navigation, full undo. |
| **Animations** | CapCut-style presets — In: fade, pop, slide ×4, zoom, spin · Out: fade, pop, slide, zoom · Combo: Ken Burns, shake, pulse, wobble. One tap generates the keyframes. |
| **Transitions** | Dip to black, cross dissolve, slide push, zoom punch, spin, flash — applied between a clip and the next one on its track (0.25–1.2 s). |
| **Colour** | Exposure-style grading: brightness, contrast, saturation, hue, **temperature, tint**, blur, grayscale, sepia + overlay passes: **vignette, film grain, matte fade, animated light leak** — every one animatable. 18 presets (Teal & Orange, Cinematic, Golden Hour, Arctic, Noir, Faded Film, Cyberpunk, Retro VHS, Neon Night, B&W Film …). |
| **Titles** | 5 title presets, editable text, font, weight, size, colour, alignment, letter spacing, UPPERCASE, outline, glow/shadow, background plate. |
| **Audio** | Keyframed volume automation (◆) for manual ducking, **auto-duck under other clips**, draggable fade knobs on the clip corners, **3-band EQ** (bass / voice / treble) with quick tools (voice clarity, bass boost, podcast, telephone), **detach audio** from any video onto its own track, per-track mute, master volume, live Web Audio mixing, and a generated music bed (WAV, synthesised in the browser). |
| **Canvas** | 16:9 · 9:16 · 1:1 · 4:5 · 4:3, 24/25/30/60 fps, background colour, drag clips directly on the preview, wheel to scale. |
| **Export** | Real-time `MediaRecorder` capture to **WebM (VP9/VP8)** or **MP4 (H.264)** where supported, 480p/720p/1080p/source, custom bitrate, audio included, live progress with cancel. PNG frame snapshots too. |
| **Projects** | `.clipforge.zip` bundle (project JSON **+ all media**), small JSON-only export, autosave/recovery via localStorage, and optional server storage with thumbnails. |
| **History** | Full undo/redo (100 steps) for every edit, including drags and slider gestures. |

Keyframes: click **◆** next to a slider to drop a keyframe at the playhead; move the
playhead and drag the slider again to animate. Diamonds on the clip can be dragged to
retime, and ◀ ▶ jump between keyframes.

Keyboard: `Space` play · `←/→` step frame · `S` split · `T` title · `I/O` set in/out ·
`Ctrl+Z / Ctrl+Shift+Z` undo/redo · `Ctrl+D` duplicate · `Del` delete ·
`+/-` zoom · `F` fit · `Ctrl+E` export · `Ctrl+S` save online.

## HTTP API

| Method & path | Purpose |
| --- | --- |
| `GET /api/health` | service probe |
| `GET /api/projects` | list saved projects (+ snippets, poster, stats) |
| `GET /api/projects/<id>` | full project document + live media list |
| `POST /api/projects` | save/overwrite a project `{id?, name?, poster?, project, media}` |
| `DELETE /api/projects/<id>` | delete project + its uploaded media |
| `PUT /api/media/<projectId>/<filename>` | raw-body media upload |
| `GET /media/<projectId>/<filename>` | serve media (HTTP **Range** supported → video seeking works) |

Projects live in `data/projects/<id>.json`, media in `data/uploads/<id>/`.
The `data/` folder is git-ignored.

## How it is built

* **`state.js`** — the single source of truth: project model, selection, playhead,
  zoom, media registry, event bus and snapshot-based undo/redo.
* **`anim.js`** — the keyframe engine: property registry, easing, interpolation,
  `evaluateClip()` (what the renderer draws) and keyframe retiming.
* **`effects.js`** — pure-data effects library: grading presets, animation keyframe
  generators, transitions, audio tools and auto-ducking.
* **`renderer.js`** — draws each frame onto a `<canvas>` (cover-fit video, transforms,
  `ctx.filter` colour work, multi-line text with outline/shadow/plate) and owns the
  Web Audio graph (`MediaElementSource → gain → master → speakers/recorder`).
* **`player.js`** — the transport: rAF loop, frame stepping, drift-corrected A/V
  sync, looping and an `ended` event the exporter listens to.
* **`timeline.js`** — ruler, track heads, clip blocks, waveforms, snapping,
  pointer drag/trim, drop targets, zoom and the context menu.
* **`media.js`** — probing, thumbnail + waveform generation and the media bin.
* **`inspector.js`** — the clip panel: every animatable row, grading/effect sliders,
  EQ, text styling and multi-selection actions.
* **`library.js`** — the left “Effects” tab: filter tiles (with live clip thumbnails),
  animation presets, transitions and audio tools.
* **`export.js`** — MediaRecorder pipeline (canvas video track + Web Audio
  destination track) with progress, cancel and download.
* **`storage.js` / `zip.js`** — bundle save/open (own ZIP writer/reader, no deps),
  server save/load and autosave.
* **`server.py`** — stdlib `ThreadingHTTPServer` with static files, Range requests,
  JSON API and path-traversal guards.

## Privacy

Imported media is read with the browser File API and never leaves the machine.
Uploading only happens when **Save online** is pressed (media + project JSON go to
this server). Export happens on the client, in real time — a 30-second video takes
about 30 seconds and the tab must stay visible while it renders.
