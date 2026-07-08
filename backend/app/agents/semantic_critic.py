"""Semantic Critic — a VLM spot-checks what the geometry can't.

The OpenCV Critic proves a box fits its mask; it cannot prove the mask is
actually a forklift. This second stage crops a sample of accepted boxes and
asks a vision-language model whether the crop shows the claimed class.
Semantic fails remove the label — the swarm catches its own hallucinations.

Cost-capped: at most `semantic_critic_max_checks` crops per run, each
downscaled before upload; failures degrade silently (a dead VLM never
blocks a run).
"""

import base64
import io
import random
import re

import httpx

from ..config import settings
from ..orchestrator.context import RunContext
from .critic_agent import ReviewedImage
from .prompt_agent import prompt_agent

SYSTEM_PROMPT = """You are the Semantic Critic of an autonomous data-labeling swarm.
You are shown a cropped region of an image and a claimed object class. Decide
whether the crop primarily shows an instance of that class. Be strict: partial
or ambiguous evidence is a NO. End your reply with exactly one line:
VERDICT: YES  or  VERDICT: NO"""

_VERDICT_RE = re.compile(r"VERDICT:\s*(YES|NO)", re.IGNORECASE)


def _crop_b64(image_path, box, width, height) -> str:
    from PIL import Image

    with Image.open(image_path) as im:
        im = im.convert("RGB")
        # Denormalize with 10% context padding around the box.
        bw, bh = box.w * width, box.h * height
        x1 = max((box.cx * width) - bw / 2 - bw * 0.1, 0)
        y1 = max((box.cy * height) - bh / 2 - bh * 0.1, 0)
        x2 = min((box.cx * width) + bw / 2 + bw * 0.1, width)
        y2 = min((box.cy * height) + bh / 2 + bh * 0.1, height)
        crop = im.crop((int(x1), int(y1), int(x2), int(y2)))
        crop.thumbnail((336, 336))  # cost control: small upload, enough detail
        buf = io.BytesIO()
        crop.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


def _critic_model() -> str:
    """Dedicated vision model if configured, else the shared LLM (Gemma 3
    is multimodal, so one vLLM server serves both agents)."""
    return settings.semantic_critic_model or settings.llm_model


def _ask(client: httpx.Client, b64: str, class_name: str) -> bool | None:
    """True = pass, False = fail, None = unusable answer."""
    resp = client.post(
        f"{settings.llm_base_url}/chat/completions",
        headers=prompt_agent._headers(),
        json={
            "model": _critic_model(),
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": [
                    {"type": "text",
                     "text": f"Claimed class: {class_name.replace('_', ' ')}"},
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
    text = (msg.get("content") or msg.get("reasoning_content") or "")
    matches = _VERDICT_RE.findall(text)
    if not matches:
        return None
    return matches[-1].upper() == "YES"


def spot_check(ctx: RunContext, reviewed: list[ReviewedImage],
               class_names: list[str]) -> None:
    """Mutates `reviewed`: removes boxes the VLM rejects."""
    if not (settings.semantic_critic and prompt_agent.available):
        return
    candidates = [
        (img, bi) for img in reviewed if img.accepted
        for bi in range(len(img.boxes))
    ]
    if not candidates:
        return
    rng = random.Random(ctx.run.id)  # reproducible sample per run
    sample = rng.sample(
        candidates, min(settings.semantic_critic_max_checks, len(candidates)))
    model_label = _critic_model().rsplit("/", 1)[-1]
    ctx.set_agent("critic", "thinking",
                  f"Semantic spot-check: {len(sample)} crops → {model_label}")
    ctx.log("info",
            f"Semantic Critic sampling {len(sample)} of {len(candidates)} "
            f"accepted boxes for VLM verification "
            f"({model_label} via {prompt_agent.provider_label})",
            agent="critic")

    to_remove: dict[int, list[int]] = {}
    failures = 0
    checked = 0
    with httpx.Client(timeout=45) as client:
        for img, bi in sample:
            ctx.check_cancelled()
            box = img.boxes[bi]
            cls = (class_names[box.class_id]
                   if box.class_id < len(class_names) else f"class {box.class_id}")
            try:
                verdict = _ask(client, _crop_b64(img.path, box, img.width,
                                                 img.height), cls)
            except (httpx.HTTPError, OSError) as exc:
                failures += 1
                ctx.log("warn", f"Semantic check failed for {img.path.name}: {exc}",
                        agent="critic")
                if failures >= 2:
                    ctx.log("warn", "Semantic Critic aborted (VLM unreachable); "
                                    "geometric verdicts stand", agent="critic")
                    return
                continue
            checked += 1
            if verdict is False:
                to_remove.setdefault(id(img), []).append(bi)
                ctx.log("critic",
                        f"SEMANTIC REJECT {img.path.name} — VLM says crop is "
                        f"not a {cls}; label removed", agent="critic")
            else:
                note = "" if verdict else " (no verdict; kept)"
                ctx.log("critic",
                        f"SEMANTIC PASS {img.path.name} — {cls} confirmed{note}",
                        agent="critic")

    progress = ctx.run.progress
    for img in reviewed:
        drop = to_remove.get(id(img))
        if not drop:
            continue
        img.boxes = [b for i, b in enumerate(img.boxes) if i not in drop]
        progress.masks_accepted -= len(drop)
        progress.masks_rejected += len(drop)
        img.critique.critic = ("Critic Agent (OpenCV geometry + "
                               f"{model_label} semantic check)")
        if not img.boxes:
            img.accepted = False
            img.critique.verdict = "rejected"
            img.critique.reason = "Semantic Critic rejected every label"
    if checked:
        rejected = sum(len(v) for v in to_remove.values())
        ctx.log("info",
                f"Semantic spot-check done — {checked} crops verified, "
                f"{rejected} label(s) removed", agent="critic")
        ctx.publish_progress()


__all__ = ["spot_check"]
