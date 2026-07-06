"""VRAM orchestration between pipeline stages.

On ROCm builds of PyTorch `torch.cuda.*` IS the HIP runtime, so the flush
below literally is `hip.empty_cache()` on the MI300X — the log line the
Mission Control terminal highlights.
"""

from typing import Optional

from ..orchestrator.context import RunContext


def _torch():
    try:
        import torch

        return torch if torch.cuda.is_available() else None
    except Exception:
        return None


def flush_vram(ctx: Optional[RunContext] = None, quiet: bool = False) -> None:
    torch = _torch()
    if torch is None:
        return
    before = torch.cuda.memory_reserved() / 1024**3
    torch.cuda.empty_cache()
    torch.cuda.ipc_collect()
    after = torch.cuda.memory_reserved() / 1024**3
    if ctx is not None and not quiet:
        call = "hip.empty_cache()" if torch.version.hip else "torch.cuda.empty_cache()"
        ctx.log(
            "gpu",
            f"{call} — reserved VRAM {before:.2f} GB → {after:.2f} GB "
            f"(freed {max(before - after, 0):.2f} GB for the next stage)",
        )


def device_str() -> str:
    torch = _torch()
    return "cuda:0" if torch is not None else "cpu"
