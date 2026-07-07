"""Model card writer — the LLM documents what the swarm just built.

One cheap chat call per completed run (the same endpoint the Prompt Agent
uses); without a key it falls back to a deterministic template so every
model still ships with a card.
"""

import httpx

from ..config import settings
from ..orchestrator.context import RunContext
from ..schemas import Dataset, ModelArtifact
from ..store import store
from .prompt_agent import prompt_agent

SYSTEM_PROMPT = """You are the MLOps Agent of an autonomous data-generation swarm.
Write a concise, honest model card in Markdown for an object-detection model the
swarm just trained. Use exactly these H2 sections: Summary, Intended Use,
Training Data, Evaluation, Limitations. Under 260 words total. Be candid about
limitations (synthetic-only data, small dataset, domain gap to real imagery).
No preamble, no code fences — start directly with the first heading."""


def _facts(ctx: RunContext, artifact: ModelArtifact, dataset: Dataset) -> str:
    run = ctx.run
    m = artifact.metrics
    classes = ", ".join(
        f"{c.name} ({c.instance_count} instances)" for c in dataset.classes
    )
    source = ""
    if run.source.path == "synthetic":
        source = (f'Synthetic images from SDXL, base prompt: "{run.source.base_prompt}". '
                  f"Domain randomization applied (lighting/angle/background/occlusion).")
    else:
        source = f"Customer-supplied archive {run.source.archive_name} labeled by the swarm."
    return (
        f"Architecture: {artifact.architecture} ({artifact.file_size_mb} MB)\n"
        f"Classes: {classes}\n"
        f"Dataset: {dataset.image_count} images, {source}\n"
        f"Labels: auto-generated, Critic Agent accepted {run.progress.masks_accepted} "
        f"and rejected {run.progress.masks_rejected} candidate boxes (OpenCV IoU check)\n"
        f"Training: {m.epochs_run} epochs in {m.training_time_min} min on "
        f"{artifact.trained_on.gpu}\n"
        f"Metrics: mAP50 {m.map50}, mAP50-95 {m.map5095}, precision {m.precision}, "
        f"recall {m.recall}"
    )


def _template_card(ctx: RunContext, artifact: ModelArtifact, dataset: Dataset) -> str:
    m = artifact.metrics
    run = ctx.run
    class_names = ", ".join(c.name for c in dataset.classes)
    return (
        f"## Summary\n"
        f"{artifact.architecture} object detector for: {class_names}. Trained "
        f"end-to-end by the Auto-Annotator swarm with zero human labels.\n\n"
        f"## Training Data\n"
        f"{dataset.image_count} images ({dataset.origin}); the Critic Agent "
        f"accepted {run.progress.masks_accepted} and rejected "
        f"{run.progress.masks_rejected} candidate labels.\n\n"
        f"## Evaluation\n"
        f"mAP50 {m.map50} · mAP50-95 {m.map5095} · precision {m.precision} · "
        f"recall {m.recall} after {m.epochs_run} epochs "
        f"({m.training_time_min} min on {artifact.trained_on.gpu}).\n\n"
        f"## Limitations\n"
        f"Labels are machine-generated and the dataset is small; validate on "
        f"real imagery from the deployment site before production use."
    )


def write_model_card(ctx: RunContext, artifact: ModelArtifact,
                     dataset: Dataset) -> None:
    card: str | None = None
    if prompt_agent.has_key:
        try:
            with httpx.Client(timeout=60) as client:
                resp = client.post(
                    f"{settings.fireworks_base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {settings.fireworks_api_key}"},
                    json={
                        "model": settings.fireworks_model,
                        "messages": [
                            {"role": "system", "content": SYSTEM_PROMPT},
                            {"role": "user", "content": _facts(ctx, artifact, dataset)},
                        ],
                        "temperature": 0.4,
                        "max_tokens": 1200,
                        "reasoning_effort": "low",
                    },
                )
                resp.raise_for_status()
                msg = resp.json().get("choices", [{}])[0].get("message", {})
                card = (msg.get("content") or "").strip() or None
        except httpx.HTTPError as exc:
            ctx.log("warn", f"Model card LLM call failed ({exc}); using template",
                    agent="mlops")
    if card is None:
        card = _template_card(ctx, artifact, dataset)
        author = "template"
    else:
        author = f"{prompt_agent.model_label} via {prompt_agent.provider_label}"
    artifact.model_card = (
        f"{card}\n\n---\n*Drafted autonomously by the MLOps Agent ({author}).*"
    )
    store.save()
    ctx.log("info", f"Model card written ({author})", agent="mlops")


__all__ = ["write_model_card"]
