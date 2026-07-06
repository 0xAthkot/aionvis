"""Real GPU telemetry.

Detects the local accelerator once at startup and exposes:
- `build_node()` — the HardwareNode the UI renders (real name/VRAM/stack)
- `sample()` — a live TelemetrySample (pynvml on NVIDIA, amd-smi on ROCm)
- `throughput` — set by agents while they work (img/s in synthesis,
  it/s in training); None when the pipeline is idle.

The 1 Hz sampling loop itself lives in ws.py next to its subscribers.
"""

import json
import shutil
import subprocess
from dataclasses import dataclass
from typing import Optional

from .schemas import HardwareNode, TelemetrySample, Throughput
from .store import now_iso

# Set by agents while a stage is running; cleared after.
throughput: Optional[Throughput] = None


@dataclass
class GpuInfo:
    vendor: str  # "nvidia" | "amd" | "cpu"
    name: str
    vram_total_gb: float
    stack_version: str  # "CUDA 12.6" / "ROCm 6.4.1" / "CPU"


_nvml = None


def _try_nvidia() -> Optional[GpuInfo]:
    global _nvml
    try:
        import pynvml

        pynvml.nvmlInit()
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        name = pynvml.nvmlDeviceGetName(handle)
        if isinstance(name, bytes):
            name = name.decode()
        mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
        try:
            cuda = pynvml.nvmlSystemGetCudaDriverVersion_v2()
            stack = f"CUDA {cuda // 1000}.{(cuda % 1000) // 10}"
        except Exception:
            stack = "CUDA"
        _nvml = (pynvml, handle)
        return GpuInfo("nvidia", name, mem.total / 1024**3, stack)
    except Exception:
        return None


def _try_amd() -> Optional[GpuInfo]:
    smi = shutil.which("amd-smi") or shutil.which("rocm-smi")
    if not smi:
        return None
    try:
        if "amd-smi" in smi:
            out = subprocess.run(
                [smi, "static", "--gpu", "0", "--asic", "--vram", "--json"],
                capture_output=True, text=True, timeout=10, check=True,
            ).stdout
            data = json.loads(out)
            gpu = data[0] if isinstance(data, list) else data
            name = gpu.get("asic", {}).get("market_name", "AMD GPU")
            vram_mb = float(gpu.get("vram", {}).get("size", {}).get("value", 0))
            version = "ROCm"
            try:
                ver = subprocess.run(
                    [smi, "version", "--json"],
                    capture_output=True, text=True, timeout=10, check=True,
                ).stdout
                version = f"ROCm {json.loads(ver).get('rocm_version', '')}".strip()
            except Exception:
                pass
            return GpuInfo("amd", name, vram_mb / 1024, version)
        # rocm-smi fallback: parse --showproductname/--showmeminfo is brittle;
        # report a generic node and let sample() fill live numbers.
        return GpuInfo("amd", "AMD GPU (rocm-smi)", 0.0, "ROCm")
    except Exception:
        return None


def detect() -> GpuInfo:
    return _try_nvidia() or _try_amd() or GpuInfo("cpu", "CPU (no GPU found)", 0.0, "CPU")


GPU = detect()
NODE_ID = "node-0"


def _torch_version() -> str:
    try:
        import torch

        return torch.__version__
    except Exception:
        return "not installed"


def build_node(busy: bool) -> HardwareNode:
    is_mi300 = GPU.vendor == "amd" and "MI300" in GPU.name.upper()
    return HardwareNode(
        id=NODE_ID,
        name="mi300x-0" if is_mi300 else GPU.name.lower().replace(" ", "-"),
        gpu=GPU.name,
        gpu_count=1,
        vram_gb=round(GPU.vram_total_gb, 1),
        rocm_version=GPU.stack_version,
        pytorch_version=_torch_version(),
        status="busy" if busy else "online",
        region="amd-developer-cloud" if is_mi300 else "local",
        provider="amd-developer-cloud" if is_mi300 else "on-prem",
    )


def _sample_nvidia() -> Optional[dict]:
    if _nvml is None:
        return None
    pynvml, handle = _nvml
    try:
        mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
        util = pynvml.nvmlDeviceGetUtilizationRates(handle).gpu
        temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
        try:
            power = pynvml.nvmlDeviceGetPowerUsage(handle) / 1000.0
        except Exception:
            power = 0.0
        return {
            "used_gb": mem.used / 1024**3,
            "total_gb": mem.total / 1024**3,
            "util": float(util),
            "temp": float(temp),
            "power": power,
        }
    except Exception:
        return None


def _sample_amd() -> Optional[dict]:
    smi = shutil.which("amd-smi")
    if not smi:
        return None
    try:
        out = subprocess.run(
            [smi, "metric", "--gpu", "0", "--usage", "--mem-usage",
             "--temperature", "--power", "--json"],
            capture_output=True, text=True, timeout=10, check=True,
        ).stdout
        data = json.loads(out)
        gpu = data[0] if isinstance(data, list) else data

        def val(*path, default=0.0):
            node = gpu
            for key in path:
                node = node.get(key, {}) if isinstance(node, dict) else {}
            if isinstance(node, dict):
                node = node.get("value", default)
            try:
                return float(node)
            except (TypeError, ValueError):
                return default

        return {
            "used_gb": val("mem_usage", "used_vram") / 1024,
            "total_gb": val("mem_usage", "total_vram") / 1024
            or GPU.vram_total_gb,
            "util": val("usage", "gfx_activity"),
            "temp": val("temperature", "hotspot"),
            "power": val("power", "socket_power"),
        }
    except Exception:
        return None


def sample() -> TelemetrySample:
    raw = _sample_nvidia() if GPU.vendor == "nvidia" else _sample_amd()
    if raw is None:
        raw = {"used_gb": 0.0, "total_gb": GPU.vram_total_gb,
               "util": 0.0, "temp": 0.0, "power": 0.0}
    return TelemetrySample(
        node_id=NODE_ID,
        at=now_iso(),
        vram_used_gb=round(raw["used_gb"], 2),
        vram_total_gb=round(raw["total_gb"], 1),
        gpu_util_pct=round(raw["util"], 1),
        temp_c=round(raw["temp"], 1),
        power_w=round(raw["power"], 1),
        throughput=throughput,
    )
