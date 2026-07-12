"""Generator choice is binding: ineligible nodes reject FLUX, never swap.

Run:  .venv\\Scripts\\python -m pytest tests/test_generator_choice.py -q
"""

import sys
from pathlib import Path

import pytest
from starlette.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agents import synthesis_agent as synth_mod  # noqa: E402
from app.main import app  # noqa: E402
from app.orchestrator.pipeline import pipeline  # noqa: E402
from app.store import store  # noqa: E402

client = TestClient(app)


def _run_body(generator: str) -> dict:
    return {
        "projectId": store.projects[0].id,
        "name": f"gen-choice-{generator}",
        "targetClasses": ["widget"],
        "source": {
            "path": "synthetic",
            "basePrompt": "a widget on a workbench",
            "generator": generator,
            "randomization": {
                "lightingVariation": 0.5, "cameraAngleVariation": 0.5,
                "backgroundDiversity": 0.5, "occlusionRate": 0.2,
                "scenarioCount": 4, "imageCount": 4, "guidanceScale": 7.5,
            },
        },
        "training": {"architecture": "yolo11n", "task": "detect",
                     "epochs": 5, "imageSize": 320, "batchSize": 4,
                     "device": "cpu"},
    }


@pytest.fixture(autouse=True)
def seeded(monkeypatch):
    if not store.projects:
        store.seed()
    # Never actually start a worker thread from these tests.
    monkeypatch.setattr(pipeline, "launch", lambda run_id: None)
    yield


def test_flux_unsupported_on_this_box():
    ok, why = synth_mod.flux_supported()
    assert not ok and why  # CPU torch: no usable GPU


def test_create_run_rejects_flux_on_ineligible_node():
    r = client.post("/api/v1/runs", json=_run_body("flux"))
    assert r.status_code == 400
    msg = r.json()["message"]
    assert "FLUX" in msg and "Pick SDXL" in msg


def test_create_run_accepts_sdxl_anywhere():
    r = client.post("/api/v1/runs", json=_run_body("sdxl"))
    assert r.status_code == 201
    assert r.json()["source"]["generator"] == "sdxl"


def test_create_run_accepts_flux_on_capable_node(monkeypatch):
    monkeypatch.setattr(synth_mod, "flux_supported", lambda: (True, ""))
    r = client.post("/api/v1/runs", json=_run_body("flux"))
    assert r.status_code == 201
    assert r.json()["source"]["generator"] == "flux"


def test_pick_model_never_substitutes(monkeypatch):
    """The last line of defense: a flux run on an ineligible node raises
    instead of quietly returning the SDXL checkpoint."""
    from app.orchestrator.context import RunContext
    from app.schemas import PipelineRun

    run = PipelineRun.model_validate(dict(
        _run_body("flux"),
        id="run_gen_test", orgId="org_t", status="queued", stage="queued",
        path="synthetic",
        progress={"pct": 0, "imagesGenerated": 0, "imagesTotal": 4,
                  "masksAccepted": 0, "masksRejected": 0,
                  "currentEpoch": 0, "totalEpochs": 5},
        createdBy="m", createdAt="2026-07-08T00:00:00Z",
    ))
    ctx = RunContext(run)
    with pytest.raises(RuntimeError, match="FLUX cannot run"):
        synth_mod.synthesis_agent._pick_model(ctx)
