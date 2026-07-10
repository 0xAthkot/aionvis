"""Synthesis Agent — real text-to-image generation with diffusers.

Two generators, the USER's choice per run (SyntheticSourceConfig.generator),
honored verbatim — never silently substituted:
  sdxl — SDXL-Turbo by default (fits the 8 GB dev card in fp16); the
         MI300X profile sets SDXL_MODEL=stabilityai/stable-diffusion-xl-base-1.0
  flux — FLUX.1-schnell (bf16, 4-step, Apache-2.0). Needs FLUX_MIN_VRAM_GB;
         nodes below that (or CPU) REJECT flux runs at creation (see
         routers.create_run + flux_supported) instead of falling back.

Pipelines load per stage and are torn down afterwards (deliberate VRAM
orchestration) unless KEEP_MODELS_WARM=true, where they stay cached.
"""

import gc
import json
import threading
import time
from pathlib import Path
from typing import Callable, Optional

from .. import telemetry
from ..config import settings
from ..orchestrator.context import RunContext
from ..schemas import Throughput
from .gpu import device_str, flush_vram

# KEEP_MODELS_WARM=true: one pipeline kept resident, keyed by checkpoint id.
_warm_pipe: dict[str, object] = {}

# diffusers builds its lazy module attrs outside Python's import lock — two
# runs cold-starting concurrently (GPU_SLOTS=2) raced it and one died with
# "cannot import name 'AutoPipelineForText2Image'". Serialize the first
# import (hit live on the MI300X, 2026-07-10).
_diffusers_import_lock = threading.Lock()


def flux_supported() -> tuple[bool, str]:
    """Can this node run FLUX.1-schnell? (eligible, reason-if-not).
    Checked BEFORE any checkpoint download; run creation rejects
    ineligible flux runs so the user's generator choice is never
    silently swapped."""
    if device_str() == "cpu":
        return False, "this node has no usable GPU"
    vram = telemetry.GPU.vram_total_gb
    if vram < settings.flux_min_vram_gb:
        return False, (f"this node has {vram:.0f} GB VRAM and FLUX needs "
                       f"≥ {settings.flux_min_vram_gb:.0f} GB")
    return True, ""


class SynthesisAgent:
    def _pick_model(self, ctx: RunContext) -> tuple[str, bool]:
        """(checkpoint id, is_flux) — the user's choice, honored verbatim."""
        generator = getattr(ctx.run.source, "generator", "sdxl")
        if generator != "flux":
            return settings.sdxl_model, False
        ok, why = flux_supported()
        if not ok:
            # create_run validates this; failing loudly here is the last
            # line of defense — never substitute the user's choice.
            raise RuntimeError(f"FLUX.1-schnell cannot run — {why}")
        return settings.flux_model, True

    def _load_pipe(self, ctx: RunContext, model_id: str, is_flux: bool):
        import torch

        with _diffusers_import_lock:
            from diffusers import AutoPipelineForText2Image

        if settings.keep_models_warm and model_id in _warm_pipe:
            ctx.log("info", f"Reusing warm diffusion pipeline {model_id}",
                    agent="synthesis")
            return _warm_pipe[model_id]

        device = device_str()
        # FLUX overflows in fp16 — it wants bf16; SDXL ships fp16 variants.
        dtype = (torch.bfloat16 if is_flux else torch.float16) \
            if device != "cpu" else torch.float32
        ctx.log("info", f"Loading diffusion pipeline {model_id} on {device}",
                agent="synthesis")
        pipe = AutoPipelineForText2Image.from_pretrained(
            model_id,
            torch_dtype=dtype,
            variant="fp16" if (device != "cpu" and not is_flux) else None,
        )
        if device != "cpu":
            # Sequential offload keeps peak VRAM well under 8 GB on the dev
            # card; on a 192 GB MI300X it simply never needs to page.
            if telemetry.GPU.vram_total_gb < 12:
                pipe.enable_model_cpu_offload()
                pipe.enable_vae_slicing()
            else:
                pipe.to(device)
        if settings.keep_models_warm:
            _warm_pipe.clear()  # at most one warm diffusion pipeline
            _warm_pipe[model_id] = pipe
        return pipe

    def generate(
        self,
        ctx: RunContext,
        scenarios: list[str],
        out_dir: Path,
        count: int,
        negative_prompt: Optional[str],
        guidance_scale: float,
        on_progress: Callable[[int], None],
        on_image: Optional[Callable[[Path, str], None]] = None,
    ) -> list[Path]:
        out_dir.mkdir(parents=True, exist_ok=True)
        model_id, is_flux = self._pick_model(ctx)
        is_turbo = "turbo" in model_id.lower()

        ctx.set_agent("synthesis", "waiting_gpu",
                      f"Loading {model_id} onto {telemetry.GPU.name}")
        flush_vram(ctx)
        pipe = self._load_pipe(ctx, model_id, is_flux)

        size = settings.synthesis_image_size
        paths: list[Path] = []
        manifest: list[dict] = []  # read by GET /runs/{id}/preview
        ctx.set_agent("synthesis", "working", f"Generating {count} images")
        started = time.monotonic()
        for i in range(count):
            ctx.check_cancelled()
            prompt = scenarios[i % len(scenarios)]
            t0 = time.monotonic()
            if is_flux:
                # FluxPipeline takes no negative_prompt; schnell is
                # guidance-distilled (4 steps, guidance ignored).
                image = pipe(
                    prompt=prompt,
                    num_inference_steps=4,
                    guidance_scale=0.0,
                    max_sequence_length=256,
                    width=size,
                    height=size,
                ).images[0]
            else:
                image = pipe(
                    prompt=prompt,
                    negative_prompt=None if is_turbo else negative_prompt,
                    num_inference_steps=4 if is_turbo else 25,
                    # SDXL-Turbo is trained for guidance_scale=0; honor the
                    # UI slider only for full SDXL.
                    guidance_scale=0.0 if is_turbo else guidance_scale,
                    width=size,
                    height=size,
                ).images[0]
            path = out_dir / f"img_{i:04d}.jpg"
            image.save(path, quality=92)
            paths.append(path)
            manifest.append({"fileName": path.name, "scenario": prompt})
            (out_dir / "preview.json").write_text(
                json.dumps(manifest), encoding="utf-8"
            )

            dt = time.monotonic() - t0
            ctx.run.progress.images_generated = i + 1
            rate = (i + 1) / (time.monotonic() - started)
            telemetry.throughput = Throughput(kind="img_per_s", value=round(rate, 2))
            ctx.log("info",
                    f"[{i + 1}/{count}] {dt:.1f}s — \"{prompt[:88]}…\"",
                    agent="synthesis")
            on_progress(i + 1)
            if on_image is not None:
                # Streaming mode: hand the finished image straight to the
                # vision stream (may block on queue backpressure).
                on_image(path, prompt)

        if not settings.keep_models_warm:
            del pipe
            gc.collect()
        telemetry.throughput = None
        ctx.log("info", f"Synthesis finished: {len(paths)} images at {size}px "
                        f"({model_id})", agent="synthesis")
        flush_vram(ctx)
        return paths


synthesis_agent = SynthesisAgent()
