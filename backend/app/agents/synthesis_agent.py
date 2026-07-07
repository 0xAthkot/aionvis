"""Synthesis Agent — real text-to-image generation with diffusers.

Default checkpoint is SDXL-Turbo (1–4 step distilled SDXL): it fits the
8 GB dev card in fp16 and the identical code path runs FLUX.1-schnell on
the MI300X by setting SDXL_MODEL/generator accordingly. The pipeline is
loaded per stage and torn down afterwards — deliberate VRAM orchestration.
"""

import gc
import json
import time
from pathlib import Path
from typing import Callable, Optional

from .. import telemetry
from ..config import settings
from ..orchestrator.context import RunContext
from ..schemas import Throughput
from .gpu import device_str, flush_vram


class SynthesisAgent:
    def generate(
        self,
        ctx: RunContext,
        scenarios: list[str],
        out_dir: Path,
        count: int,
        negative_prompt: Optional[str],
        guidance_scale: float,
        on_progress: Callable[[int], None],
    ) -> list[Path]:
        import torch
        from diffusers import AutoPipelineForText2Image

        out_dir.mkdir(parents=True, exist_ok=True)
        device = device_str()
        is_turbo = "turbo" in settings.sdxl_model.lower()

        ctx.set_agent("synthesis", "waiting_gpu",
                      f"Loading {settings.sdxl_model} onto {telemetry.GPU.name}")
        flush_vram(ctx)
        ctx.log("info", f"Loading diffusion pipeline {settings.sdxl_model} "
                        f"(fp16) on {device}", agent="synthesis")
        pipe = AutoPipelineForText2Image.from_pretrained(
            settings.sdxl_model,
            torch_dtype=torch.float16 if device != "cpu" else torch.float32,
            variant="fp16" if device != "cpu" else None,
        )
        if device != "cpu":
            # Sequential offload keeps peak VRAM well under 8 GB on the dev
            # card; on a 192 GB MI300X it simply never needs to page.
            if telemetry.GPU.vram_total_gb < 12:
                pipe.enable_model_cpu_offload()
                pipe.enable_vae_slicing()
            else:
                pipe.to(device)

        size = settings.synthesis_image_size
        paths: list[Path] = []
        manifest: list[dict] = []  # read by GET /runs/{id}/preview
        ctx.set_agent("synthesis", "working", f"Generating {count} images")
        started = time.monotonic()
        for i in range(count):
            ctx.check_cancelled()
            prompt = scenarios[i % len(scenarios)]
            t0 = time.monotonic()
            image = pipe(
                prompt=prompt,
                negative_prompt=None if is_turbo else negative_prompt,
                num_inference_steps=4 if is_turbo else 25,
                # SDXL-Turbo is trained for guidance_scale=0; honor the UI
                # slider only for full SDXL/FLUX.
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

        del pipe
        gc.collect()
        telemetry.throughput = None
        ctx.log("info", f"Synthesis finished: {len(paths)} images at {size}px",
                agent="synthesis")
        flush_vram(ctx)
        return paths


synthesis_agent = SynthesisAgent()
