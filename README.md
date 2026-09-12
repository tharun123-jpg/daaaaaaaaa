# FF Anticheat Test Lab (QA Only)

> **This is NOT a hack / cheat panel.**
> This project does NOT contain aimbot, wallhack, ESP, bypass, injector, APK mod, or any cheat for Free Fire or any other game.
> It is a **defensive QA dashboard** for learning how anticheat detection works with 100% fake, simulated data.

If you are a real Garena / game-studio QA engineer, use your internal tools and test environment.
This repo is only a starting template for:
- viewing detection events
- testing detection rules with synthetic telemetry
- managing QA test cases

No real game memory is touched. No bypass is included. No cheat is included.

## What is inside?

```
backend/
  app.py        - Flask API + serves frontend
  rules.py      - simple defensive detection rules (speed, aim stats, action rate)
frontend/
  index.html    - dashboard UI
  style.css
  app.js
simulator/
  simulate.py   - generates FAKE test events to test your backend
requirements.txt
```

## Quick start

```bash
pip install -r requirements.txt
python backend/app.py
```

Then open: http://localhost:5000

Click **"Run Simulated Tests"** to generate fake QA events and see detections trigger.

## API

- `GET /api/stats` - counts
- `GET /api/detections` - list of flagged test events
- `POST /api/event` - ingest one test event
  ```json
  {
    "player_id": "test_001",
    "type": "movement",
    "speed_mps": 25.0,
    "source": "qa-simulator"
  }
  ```
- `POST /api/simulate` - run built-in fake scenarios
- `POST /api/reset` - clear store

## Ethical use

- Only test on your own backend / test environment.
- Never use this to cheat in live games.
- Never try to bypass anticheat. That violates Garena ToS and can get accounts banned and cause legal issues.

If you need a real cheat / hack panel, this repo will not help you — that is intentionally not supported here.
