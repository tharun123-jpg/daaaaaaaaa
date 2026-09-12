import os
import time
import uuid
from flask import Flask, jsonify, request, send_from_directory

from rules import evaluate_event

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")

app = Flask(__name__)

# In-memory QA store (use a real DB in production)
EVENTS = []
DETECTIONS = []


def _record(event: dict):
    event = dict(event or {})
    event.setdefault("id", uuid.uuid4().hex[:8])
    event.setdefault("ts", time.time())
    event.setdefault("source", "qa-simulator")
    EVENTS.append(event)
    for d in evaluate_event(event):
        DETECTIONS.append({
            "id": uuid.uuid4().hex[:8],
            "ts": time.time(),
            "player_id": event.get("player_id", "unknown"),
            "event_id": event["id"],
            "event_type": event.get("type", "unknown"),
            **d,
        })
    return event


@app.get("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.get("/<path:path>")
def static_files(path):
    # Serve frontend assets, fallback to index for unknown paths
    full = os.path.join(FRONTEND_DIR, path)
    if os.path.isfile(full):
        return send_from_directory(FRONTEND_DIR, path)
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.get("/api/stats")
def stats():
    return jsonify({
        "total_events": len(EVENTS),
        "total_detections": len(DETECTIONS),
        "rules": ["SPEED_ANOMALY", "AIM_STAT_ANOMALY", "ACTION_RATE_ANOMALY", "MANUAL_QA_REPORT"],
        "mode": "simulated-qa-only",
    })


@app.get("/api/detections")
def list_detections():
    return jsonify(sorted(DETECTIONS, key=lambda x: x["ts"], reverse=True)[:200])


@app.get("/api/events")
def list_events():
    return jsonify(sorted(EVENTS, key=lambda x: x["ts"], reverse=True)[:200])


@app.post("/api/event")
def ingest():
    data = request.get_json(force=True, silent=True) or {}
    if not data.get("player_id") or not data.get("type"):
        return jsonify({"error": "player_id and type are required"}), 400
    event = _record(data)
    return jsonify({"ok": True, "event": event})


@app.post("/api/simulate")
def simulate():
    """Run built-in FAKE scenarios. No real game involved."""
    scenarios = [
        {"player_id": "qa_bot_legit", "type": "movement", "speed_mps": 6.2},
        {"player_id": "qa_bot_legit", "type": "aim_stats", "headshot_rate": 0.25, "samples": 40},
        {"player_id": "qa_bot_legit", "type": "action", "actions_per_sec": 4},
        {"player_id": "qa_bot_speed", "type": "movement", "speed_mps": 32.0},
        {"player_id": "qa_bot_aim", "type": "aim_stats", "headshot_rate": 0.95, "samples": 50},
        {"player_id": "qa_bot_macro", "type": "action", "actions_per_sec": 28},
        {"player_id": "qa_bot_reported", "type": "report", "reason": "QA manual review test"},
    ]
    for s in scenarios:
        s["source"] = "built-in-simulator"
        _record(s)
    return jsonify({"ok": True, "ingested": len(scenarios)})


@app.post("/api/reset")
def reset():
    EVENTS.clear()
    DETECTIONS.clear()
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
