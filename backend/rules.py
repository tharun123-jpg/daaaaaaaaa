"""
Defensive QA detection rules.
These operate ONLY on synthetic test JSON sent to /api/event.
They do NOT read game memory, mod APKs, or bypass anything.
"""

def evaluate_event(event: dict) -> list:
    """
    Returns list of detections: [{rule, severity, message}]
    event example:
      {"player_id": "test_001", "type": "movement", "speed_mps": 12.5}
      {"player_id": "test_001", "type": "aim_stats", "headshot_rate": 0.9, "samples": 50}
      {"player_id": "test_001", "type": "action", "actions_per_sec": 30}
    """
    detections = []
    etype = (event.get("type") or "").lower()

    if etype == "movement":
        try:
            speed = float(event.get("speed_mps", 0))
        except (TypeError, ValueError):
            speed = 0
        # Normal run speed in most BR games ~ 5-8 m/s. Anything crazy is suspicious IN SIMULATION.
        if speed > 15:
            detections.append({
                "rule": "SPEED_ANOMALY",
                "severity": "high" if speed > 25 else "medium",
                "message": f"Simulated speed {speed} m/s exceeds expected max (15 m/s)"
            })

    elif etype == "aim_stats":
        try:
            hs = float(event.get("headshot_rate", 0))
            samples = int(event.get("samples", 0))
        except (TypeError, ValueError):
            hs, samples = 0, 0
        # Pure stats check on FAKE data, not an aimbot. Flags impossible consistency for QA review.
        if samples >= 20 and hs >= 0.85:
            detections.append({
                "rule": "AIM_STAT_ANOMALY",
                "severity": "medium",
                "message": f"Simulated headshot rate {hs*100:.1f}% over {samples} samples is statistically unlikely"
            })

    elif etype == "action":
        try:
            aps = float(event.get("actions_per_sec", 0))
        except (TypeError, ValueError):
            aps = 0
        if aps > 15:
            detections.append({
                "rule": "ACTION_RATE_ANOMALY",
                "severity": "medium",
                "message": f"Simulated {aps} actions/sec exceeds human-plausible threshold"
            })

    elif etype == "report":
        # Manual QA report passthrough
        detections.append({
            "rule": "MANUAL_QA_REPORT",
            "severity": "low",
            "message": f"QA report: {event.get('reason', 'no reason given')}"
        })

    return detections
