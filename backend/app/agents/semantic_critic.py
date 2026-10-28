"""Semantic Critic — a VLM checks what the geometry can't.

The geometric check proves a box fits its mask; it cannot prove the mask is
actually a forklift. This stage crops each accepted label (with context) and
asks a vision-language model whether it shows the claimed class, as the
run's deployment camera would see it.

Coverage is the run's choice (PipelineRun.semantic_check):
  all    — every accepted label, many requests in flight; in streaming mode
           checks start while images are still being generated
  sample — a fixed spot-check of `semantic_critic_max_checks` labels

Verdicts: YES → label kept, marked "confirmed"; UNSURE (or no verdict) →
kept, marked "unsure"; NO → label removed. Measured on MI300X crops
(2026-10-28): a strict "partial evidence is a NO" prompt without context
rejected 29% of labels, including obvious hard hats and workers seen from
above; this prompt with the deployment and 25% context padding rejected
1.7%. A dead VLM never blocks a run: checks stop and geometry stands.
"""

import base64
import io
import random
import re
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor, wait

import httpx

from ..config import settings
from ..orchestrator.context import RunCancelled, RunContext
from .critic_agent import ReviewedImage
from .prompt_agent import prompt_agent

SYSTEM_PROMPT = """You are the Semantic Critic of an autonomous data-labeling swarm.
You are shown a crop around a labeled object, a claimed object class, and the
deployment the images were made for (it tells you the camera viewpoint).
Decide whether the labeled object is an instance of the claimed class AS THAT
CAMERA WOULD SEE IT: small, partly visible, blurred by distance, or seen
straight from above still counts as YES. Answer NO only when the crop clearly
shows something else or nothing recognizable. Answer UNSURE when you cannot
tell. End your reply with exactly one line:
VERDICT: YES  or  VERDICT: NO  or  VERDICT: UNSURE"""

_VERDICT_RE = re.compile(r"VERDICT:\s*(YES|NO|UNSURE)", re.IGNORECASE)
# Requests in flight. Measured on the MI300X with Gemma 4 26B-A4B: 3 crops/s
# one at a time, 14 crops/s with 32 in flight.
_CONCURRENCY = 32
# Consecutive transport failures before the VLM is declared unreachable.
_MAX_FAILURES = 5


def _crop_b64(image_path, box, width, height, pad: float = 0.25) -> str:
    from PIL import Image

    with Image.open(image_path) as im:
        im = im.convert("RGB")
        # Denormalize with context padding around the box: the VLM judges
        # an object much better when it sees what surrounds it.
        bw, bh = box.w * width, box.h * height
        x1 = max((box.cx * width) - bw / 2 - bw * pad, 0)
        y1 = max((box.cy * height) - bh / 2 - bh * pad, 0)
        x2 = min((box.cx * width) + bw / 2 + bw * pad, width)
        y2 = min((box.cy * height) + bh / 2 + bh * pad, height)
        crop = im.crop((int(x1), int(y1), int(x2), int(y2)))
        crop.thumbnail((336, 336))  # cost control: small upload, enough detail
        buf = io.BytesIO()
        crop.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


def _critic_model() -> str:
    """Dedicated vision model if configured, else the shared LLM (Gemma is
    multimodal, so one vLLM server serves both agents)."""
    return settings.semantic_critic_model or settings.llm_model


def _ask(client: httpx.Client, b64: str, class_name: str,
         deployment: str | None) -> str | None:
    """'YES' | 'NO' | 'UNSURE', or None for an unusable answer."""
    text = f"Claimed class: {class_name.replace('_', ' ')}"
    if deployment:
        text = f"Deployment: {deployment}\n{text}"
    resp = client.post(
        f"{settings.llm_base_url}/chat/completions",
        headers=prompt_agent._headers(),
        json={
            "model": _critic_model(),
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": [
                    {"type": "text", "text": text},
                    {"type": "image_url",
                     "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                ]},
            ],
            "temperature": 0.0,
            "max_tokens": 700,  # reasoning models think before the verdict
        },
    )
    resp.raise_for_status()
    msg = resp.json().get("choices", [{}])[0].get("message", {})
    reply = (msg.get("content") or msg.get("reasoning_content") or "")
    matches = _VERDICT_RE.findall(reply)
    return matches[-1].upper() if matches else None


class SemanticVerifier:
    """Verifies accepted labels with the VLM, many requests in flight.

    submit(img) queues every label of a reviewed image (mode "all"; the
    streaming critic calls it as images arrive). finish(reviewed) waits,
    then applies all verdicts at once, so boxes never change under the
    stream. Mode "sample" checks a fixed spot-check in finish().
    """

    def __init__(self, ctx: RunContext, class_names: list[str],
                 mode: str = "all") -> None:
        self.ctx = ctx
        self.class_names = class_names
        self.mode = mode
        self.enabled = settings.semantic_critic and prompt_agent.available
        source = ctx.run.source
        self.deployment = getattr(source, "use_case", None)
        self._futures: list[tuple[ReviewedImage, int, Future]] = []
        self._pool: ThreadPoolExecutor | None = None
        self._local = threading.local()
        self._lock = threading.Lock()
        self._failures = 0
        self._aborted = False
        self._done = 0
        self._logged_at = 0.0
        self.model_label = _critic_model().rsplit("/", 1)[-1]

    # --- submission -------------------------------------------------------------

    def _client(self) -> httpx.Client:
        client = getattr(self._local, "client", None)
        if client is None:
            client = self._local.client = httpx.Client(timeout=120)
        return client

    def _check(self, img: ReviewedImage, bi: int) -> str | None:
        if self._aborted or self.ctx.cancel_event.is_set():
            return None
        box = img.boxes[bi]
        cls = (self.class_names[box.class_id]
               if box.class_id < len(self.class_names) else f"class {box.class_id}")
        try:
            verdict = _ask(self._client(),
                           _crop_b64(img.path, box, img.width, img.height),
                           cls, self.deployment)
        except (httpx.HTTPError, OSError) as exc:
            with self._lock:
                self._failures += 1
                if self._failures >= _MAX_FAILURES and not self._aborted:
                    self._aborted = True
                    self.ctx.log("warn", f"Semantic Critic stopped (VLM unreachable: "
                                         f"{exc}); geometric verdicts stand",
                                 agent="critic")
            return None
        with self._lock:
            self._failures = 0
            self._done += 1
            done = self._done
            now = time.monotonic()
            if now - self._logged_at >= 5:
                self._logged_at = now
                self.ctx.log("info", f"Semantic Critic: {done:,} labels checked "
                                     f"by {self.model_label} so far", agent="critic")
        if verdict == "NO":
            self.ctx.log("critic", f"SEMANTIC REJECT {img.path.name}: VLM says the "
                                   f"crop is not a {cls}; label removed", agent="critic")
        return verdict

    def _submit_box(self, img: ReviewedImage, bi: int) -> None:
        if self._pool is None:
            self._pool = ThreadPoolExecutor(max_workers=_CONCURRENCY,
                                            thread_name_prefix="semantic")
        self._futures.append((img, bi, self._pool.submit(self._check, img, bi)))

    def submit(self, img: ReviewedImage) -> None:
        if not (self.enabled and self.mode == "all") or not img.accepted:
            return
        for bi in range(len(img.boxes)):
            self._submit_box(img, bi)

    # --- completion ---------------------------------------------------------------

    def close(self) -> None:
        """Stop pending checks (run failed or was cancelled mid-stream)."""
        self._aborted = True
        if self._pool is not None:
            self._pool.shutdown(wait=False, cancel_futures=True)

    def finish(self, reviewed: list[ReviewedImage]) -> None:
        """Wait for every check, then apply verdicts. Mutates `reviewed`."""
        if not self.enabled:
            return
        ctx = self.ctx
        if self.mode == "sample":
            candidates = [(img, bi) for img in reviewed if img.accepted
                          for bi in range(len(img.boxes))]
            rng = random.Random(ctx.run.id)  # reproducible sample per run
            for img, bi in rng.sample(candidates, min(
                    settings.semantic_critic_max_checks, len(candidates))):
                self._submit_box(img, bi)
        if not self._futures:
            return
        total = len(self._futures)
        ctx.set_agent("critic", "thinking",
                      f"VLM verification: {total:,} labels → {self.model_label}")
        ctx.log("info", f"Semantic Critic verifying {total:,} "
                        + ("labels (every accepted label)" if self.mode == "all"
                           else "labels (spot-check)")
                        + f" with {self.model_label} via {prompt_agent.provider_label}",
                agent="critic")
        try:
            pending = [f for _, _, f in self._futures]
            while pending:
                if ctx.cancel_event.is_set():
                    raise RunCancelled()
                _, not_done = wait(pending, timeout=0.5)
                pending = list(not_done)
        finally:
            self._pool.shutdown(wait=False, cancel_futures=True)

        verdicts: dict[int, dict[int, str | None]] = {}
        for img, bi, fut in self._futures:
            verdicts.setdefault(id(img), {})[bi] = fut.result()
        removed = confirmed = unsure = 0
        progress = ctx.run.progress
        for img in reviewed:
            per_box = verdicts.get(id(img))
            if not per_box:
                continue
            keep = []
            for bi, box in enumerate(img.boxes):
                verdict = per_box.get(bi, "skip")
                if verdict == "NO":
                    removed += 1
                    continue
                if verdict == "YES":
                    box.semantic = "confirmed"
                    confirmed += 1
                elif verdict != "skip" and not (self._aborted and verdict is None):
                    box.semantic = "unsure"
                    unsure += 1
                keep.append(box)
            dropped = len(img.boxes) - len(keep)
            img.boxes = keep
            img.critique.critic = ("Critic Agent (geometric checks + "
                                   f"{self.model_label} VLM)")
            if dropped:
                progress.masks_accepted -= dropped
                progress.masks_rejected += dropped
            if not img.boxes:
                img.accepted = False
                img.critique.verdict = "rejected"
                img.critique.reason = "Semantic Critic rejected every label"
        ctx.log("info",
                f"Semantic Critic done: {confirmed + unsure + removed:,} of "
                f"{total:,} labels verified: {confirmed:,} confirmed, {unsure:,} "
                f"unsure (kept), {removed:,} removed", agent="critic")
        ctx.publish_progress()


def spot_check(ctx: RunContext, reviewed: list[ReviewedImage],
               class_names: list[str]) -> None:
    """The fixed per-run spot-check (semantic_check = "sample")."""
    SemanticVerifier(ctx, class_names, mode="sample").finish(reviewed)


__all__ = ["SemanticVerifier", "spot_check"]
