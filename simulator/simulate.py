"""
Standalone fake-data generator.
Sends synthetic QA events to the local backend. No game hacking.
Usage: python simulator/simulate.py
"""
import json
import urllib.request

BASE = "http://localhost:5000"

SCENARIOS = [
    {"player_id": "sim_legit_01", "type": "movement", "speed_mps": 5.8},
    {"player_id": "sim_legit_01", "type": "aim_stats", "headshot_rate": 0.3, "samples": 30},
    {"player_id": "sim_cheater_like_01", "type": "movement", "speed_mps": 40.0},
    {"player_id": "sim_cheater_like_02", "type": "aim_stats", "headshot_rate": 0.98, "samples": 60},
    {"player_id": "sim_cheater_like_03", "type": "action", "actions_per_sec": 35},
]


def post(path, payload):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())


if __name__ == "__main__":
    for s in SCENARIOS:
        s["source"] = "standalone-simulator"
        print(post("/api/event", s))
    print("Done. Open http://localhost:5000 to view detections.")
