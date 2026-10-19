"""AMD telemetry falls back to rocm-smi when `amd-smi metric` is broken.

The ROCm 7.14 droplet image ships an amd-smi whose `metric` command always
fails, which flatlined the Hardware page. These tests fake both CLIs.

Run:  .venv\\Scripts\\python -m pytest tests/test_telemetry.py -q
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import telemetry  # noqa: E402

GB = 1024**3

# Shape of `rocm-smi --showmeminfo vram --showuse --showtemp --showpower --json`
ROCM_SMI_JSON = json.dumps({"card0": {
    "VRAM Total Memory (B)": str(192 * GB),
    "VRAM Total Used Memory (B)": str(125 * GB),
    "GPU use (%)": "87",
    "Temperature (Sensor junction) (C)": "64.0",
    "Current Socket Graphics Package Power (W)": "512.0",
}})

# Shape of `amd-smi metric ... --json` (ROCm 7 wraps it in gpu_data)
AMD_SMI_JSON = json.dumps({"gpu_data": [{
    "mem_usage": {"used_vram": {"value": 10240}, "total_vram": {"value": 196608}},
    "usage": {"gfx_activity": {"value": 42}},
    "temperature": {"hotspot": {"value": 55}},
    "power": {"socket_power": {"value": 300}},
}]})


@pytest.fixture
def fake_smi(monkeypatch):
    """Install fake amd-smi / rocm-smi binaries; returns the call log."""
    calls: list[str] = []

    def install(amd: str | None, rocm: bool = True):
        paths = {"amd-smi": "/usr/bin/amd-smi" if amd else None,
                 "rocm-smi": "/usr/bin/rocm-smi" if rocm else None}
        monkeypatch.setattr(telemetry.shutil, "which", lambda name: paths.get(name))

        def run(cmd, **kwargs):
            tool = Path(cmd[0]).name
            calls.append(tool)
            if tool == "amd-smi":
                if amd == "broken":
                    raise subprocess.CalledProcessError(1, cmd)
                return subprocess.CompletedProcess(cmd, 0, AMD_SMI_JSON, "")
            return subprocess.CompletedProcess(cmd, 0, ROCM_SMI_JSON, "")

        monkeypatch.setattr(telemetry.subprocess, "run", run)
        monkeypatch.setattr(telemetry, "_amd_metric_broken", False)
        return calls

    return install


def test_working_amd_smi_is_used(fake_smi):
    calls = fake_smi(amd="ok")
    raw = telemetry._sample_amd()
    assert raw["util"] == 42 and raw["used_gb"] == pytest.approx(10.0)
    assert calls == ["amd-smi"]


def test_broken_amd_smi_falls_back_to_rocm_smi(fake_smi):
    calls = fake_smi(amd="broken")
    raw = telemetry._sample_amd()
    assert raw["used_gb"] == pytest.approx(125.0)
    assert raw["total_gb"] == pytest.approx(192.0)
    assert raw["util"] == 87 and raw["temp"] == 64 and raw["power"] == 512
    assert calls == ["amd-smi", "rocm-smi"]


def test_broken_amd_smi_is_not_retried_every_second(fake_smi):
    calls = fake_smi(amd="broken")
    for _ in range(3):
        telemetry._sample_amd()
    assert calls.count("amd-smi") == 1 and calls.count("rocm-smi") == 3


def test_rocm_smi_only_node(fake_smi):
    fake_smi(amd=None)
    assert telemetry._sample_amd()["used_gb"] == pytest.approx(125.0)


def test_no_smi_at_all_returns_none(fake_smi):
    fake_smi(amd=None, rocm=False)
    assert telemetry._sample_amd() is None
