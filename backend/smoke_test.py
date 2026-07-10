"""Demo-morning preflight: verify every critical endpoint is alive.

Read-only by design — it creates no runs, feedback or datasets, so it is
safe to fire minutes before going on stage. The one LLM call it makes
(expand-prompt) hits the Prompt Agent's cache/fallback path and costs at
most a fraction of a cent.

    .venv/Scripts/python smoke_test.py [--base http://localhost:8000] [--key <AA_API_KEY>]

When the backend runs with AA_API_KEY set, pass the key via --key or the
AA_API_KEY env var (the local .env is read automatically as a fallback).
"""

import argparse
import io
import os
import sys
from pathlib import Path

import httpx

CHECK = "[ OK ]"
CROSS = "[FAIL]"


def _env_file_key() -> str:
    """AA_API_KEY from backend/.env — the smoke test usually runs on the node."""
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        return ""
    key = ""
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("AA_API_KEY="):
            # Last value wins, like the backend's settings loader — deploy
            # scripts append the real key below .env.example's empty one.
            key = line.split("=", 1)[1].strip() or key
    return key


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8000")
    ap.add_argument("--key", default="",
                    help="AA_API_KEY (falls back to the env var, then backend/.env)")
    args = ap.parse_args()
    base = args.base.rstrip("/") + "/api/v1"
    key = args.key or os.environ.get("AA_API_KEY", "") or _env_file_key()

    failures = 0
    client = httpx.Client(
        timeout=120,
        headers={"Authorization": f"Bearer {key}"} if key else {},
    )
    if key:
        print(f"(sending API key {key[:6]}…)")

    def check(name: str, fn):
        nonlocal failures
        try:
            detail = fn()
            print(f"{CHECK} {name}" + (f" - {detail}" if detail else ""))
        except Exception as exc:  # noqa: BLE001 — a preflight reports, never crashes
            failures += 1
            print(f"{CROSS} {name} - {exc}")

    def get(path: str):
        r = client.get(f"{base}{path}")
        r.raise_for_status()
        return r.json()

    projects = []
    models = []

    def _projects():
        nonlocal projects
        projects = get("/projects")
        assert projects, "no projects seeded"
        return f"{len(projects)} projects"

    def _models():
        nonlocal models
        models = get("/models")
        return f"{len(models)} models"

    check("GET /projects", _projects)
    check("GET /models", _models)
    check("GET /dashboard/stats", lambda: f"{get('/dashboard/stats')['modelsTrained']} models trained")
    check("GET /runs", lambda: f"{get('/runs?pageSize=5')['total']} runs")
    check("GET /datasets", lambda: f"{len(get('/datasets'))} datasets")
    check("GET /hardware/nodes", lambda: ", ".join(n["gpu"] for n in get("/hardware/nodes")))

    if projects:
        pid = projects[0]["id"]
        check(f"GET /projects/{pid}/feedback",
              lambda: f"{sum(1 for f in get(f'/projects/{pid}/feedback') if not f.get('consumedByRunId'))} pending hard cases")

    def _analytics():
        labeled = [d for d in get("/datasets") if d.get("labeledCount")]
        if not labeled:
            return "skipped — no labeled dataset yet"
        a = get(f"/datasets/{labeled[0]['id']}/analytics")
        assert len(a["heatmap"]) == a["heatmapSize"] ** 2, "bad heatmap shape"
        return (f"{labeled[0]['id']}: {len(a['classDistribution'])} classes, "
                f"{len(a['splits'])} splits, {a['boxesPerImage']} boxes/img")

    check("GET /datasets/{id}/analytics", _analytics)

    def _expand():
        r = client.post(f"{base}/foundry/expand-prompt", json={
            "useCase": "Our warehouse safety cameras need to spot forklifts "
                       "and pallets in the aisles",
            "targetClasses": ["forklift", "pallet"],
            "randomization": {
                "lightingVariation": 0.5, "cameraAngleVariation": 0.5,
                "backgroundDiversity": 0.5, "occlusionRate": 0.2,
                "scenarioCount": 10, "imageCount": 10, "guidanceScale": 7.5,
            },
            "previewCount": 2,
        })
        r.raise_for_status()
        data = r.json()
        assert data["scenarios"], "no scenarios returned"
        return f"{data['model']} via {data['provider']}"

    check("POST /foundry/expand-prompt (Prompt Agent live)", _expand)

    def _predict():
        ready = [m for m in models if m.get("status") in (None, "ready")]
        if not ready:
            return "skipped — no trained model yet"
        from PIL import Image  # deferred: PIL is in the backend venv
        buf = io.BytesIO()
        Image.new("RGB", (64, 64), (200, 160, 40)).save(buf, format="PNG")
        r = client.post(
            f"{base}/models/{ready[-1]['id']}/predict",
            files={"image": ("smoke.png", buf.getvalue(), "image/png")},
        )
        r.raise_for_status()
        p = r.json()
        return f"{ready[-1]['id']}: {len(p['boxes'])} boxes in {p['latencyMs']:.0f} ms on {p['device']}"

    check("POST /models/{id}/predict (playground inference)", _predict)

    print()
    if failures:
        print(f"{failures} check(s) FAILED — do not go on stage yet.")
    else:
        print("All checks passed. Break a leg.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
