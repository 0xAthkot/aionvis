"""Use-case-first Prompt Agent: the deterministic fallback designer.

The LLM path is exercised on the MI300X; these tests pin the offline
fallback — the user's use case must become SCENE prompts (deployment
viewpoint inferred, intent phrasing stripped, classes always depicted).

Run:  .venv\\Scripts\\python -m pytest tests/test_prompt_agent.py -q
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agents.prompt_agent import prompt_agent  # noqa: E402
from app.schemas import DomainRandomizationConfig, SyntheticSourceConfig  # noqa: E402


def rand_cfg(**overrides) -> DomainRandomizationConfig:
    base = dict(lighting_variation=0.5, camera_angle_variation=0.5,
                background_diversity=0.5, occlusion_rate=0.0,
                scenario_count=6, image_count=6, guidance_scale=7.5)
    base.update(overrides)
    return DomainRandomizationConfig(**base)


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    import time
    monkeypatch.setattr(prompt_agent, "_probe_ok", False)
    monkeypatch.setattr(prompt_agent, "_probe_at", time.monotonic())
    yield


def test_drone_use_case_becomes_aerial_scenes():
    prompts = prompt_agent.expand(
        "My drone needs to detect rotten potatoes in the field before harvest",
        ["rotten_potato"], rand_cfg(), 6,
    )
    assert len(prompts) == 6
    for p in prompts:
        low = p.lower()
        assert "rotten potato" in low          # classes always depicted
        assert "aerial drone view" in low      # platform -> viewpoint
        assert "needs to detect" not in low    # intent phrasing stripped
        assert "my drone" not in low


def test_cctv_use_case_gets_security_camera_view():
    prompts = prompt_agent.expand(
        "Our warehouse CCTV should spot workers without safety vests",
        ["worker", "safety_vest"], rand_cfg(), 4,
    )
    assert all("security camera" in p.lower() for p in prompts)


def test_unknown_platform_still_makes_scenes():
    prompts = prompt_agent.expand(
        "count ripe strawberries in greenhouse rows",
        ["ripe_strawberry"], rand_cfg(), 4,
    )
    assert len(prompts) == 4
    for p in prompts:
        assert "ripe strawberry" in p.lower()
        assert "greenhouse rows" in p.lower()  # environment words survive
        assert p.lower().startswith("photorealistic scene")


def test_occlusion_and_hard_cases_flow_through():
    prompts = prompt_agent.expand(
        "my drone needs to detect rotten potatoes",
        ["rotten_potato"], rand_cfg(occlusion_rate=1.0), 4,
        hard_cases=["potato half-buried in mud"],
    )
    assert any("occluded" in p or "overlapping" in p or "half-hidden" in p
               or "crossing the frame" in p for p in prompts)
    assert "potato half-buried in mud" in prompts[0]


def test_old_state_json_base_prompt_still_loads():
    """Pre-v0.5 runs persisted `basePrompt`; the schema must keep loading it."""
    old = {"path": "synthetic", "basePrompt": "a forklift in a warehouse",
           "generator": "sdxl",
           "randomization": {"lightingVariation": 0.5, "cameraAngleVariation": 0.5,
                             "backgroundDiversity": 0.5, "occlusionRate": 0.2,
                             "scenarioCount": 4, "imageCount": 4,
                             "guidanceScale": 7.5}}
    cfg = SyntheticSourceConfig.model_validate(old)
    assert cfg.use_case == "a forklift in a warehouse"
    # And it serializes under the new wire name.
    assert cfg.model_dump(by_alias=True)["useCase"] == "a forklift in a warehouse"
