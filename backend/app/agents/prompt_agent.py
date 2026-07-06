"""Prompt Agent — expands a base prompt into domain-randomized scenarios.

Real path: Gemma on Fireworks AI (OpenAI-compatible chat completions).
Without FIREWORKS_API_KEY it degrades to a deterministic template expander
and says so in its provider label, so the rest of the pipeline stays usable.
"""

import itertools
import json
import re

import httpx

from ..config import settings
from ..schemas import DomainRandomizationConfig

SYSTEM_PROMPT = """You are the Prompt Agent of an autonomous data-generation swarm.
Expand the user's base scene description into diverse, concrete prompts for a
text-to-image diffusion model (SDXL), applying domain randomization. Every
prompt MUST clearly depict the target object classes so they can be detected
and labeled afterwards. Vary lighting, camera angle, background and occlusion
according to the given intensities (0=none, 1=extreme). Keep each prompt a
single sentence under 60 words, photographic style, no numbering.
Respond with ONLY a JSON array of strings."""

# Deterministic fallback vocabulary (used only without an API key).
_LIGHTING = ["soft studio lighting", "harsh industrial floodlights", "dim ambient light",
             "golden-hour sidelight", "cool fluorescent overheads", "high-contrast spotlights"]
_ANGLES = ["top-down view", "45-degree elevated view", "eye-level closeup",
           "wide-angle overview", "low oblique angle", "macro detail shot"]
_BACKDROPS = ["on a factory conveyor line", "on a cluttered workbench",
              "in a bright inspection bay", "against an industrial backdrop",
              "inside a busy production hall", "on an anti-static work mat"]
_OCCLUSION = ["partially occluded by tooling", "with overlapping parts",
              "half-covered by protective film", "with cables crossing the frame"]


class PromptAgent:
    display_name = "Prompt Agent"

    @property
    def has_key(self) -> bool:
        return bool(settings.fireworks_api_key)

    @property
    def model_label(self) -> str:
        return settings.fireworks_model.rsplit("/", 1)[-1] if self.has_key else "template expander"

    @property
    def provider_label(self) -> str:
        return "Fireworks AI" if self.has_key else "local fallback (set FIREWORKS_API_KEY)"

    # --- public API ------------------------------------------------------------

    async def expand_async(self, base_prompt: str, target_classes: list[str],
                           randomization: DomainRandomizationConfig, count: int) -> list[str]:
        if not self.has_key:
            return self._fallback(base_prompt, target_classes, randomization, count)
        async with httpx.AsyncClient(timeout=60) as client:
            data = await self._chat(client, base_prompt, target_classes, randomization, count)
        return data

    def expand(self, base_prompt: str, target_classes: list[str],
               randomization: DomainRandomizationConfig, count: int) -> list[str]:
        """Synchronous variant for the pipeline worker thread."""
        if not self.has_key:
            return self._fallback(base_prompt, target_classes, randomization, count)
        with httpx.Client(timeout=60) as client:
            resp = client.post(
                f"{settings.fireworks_base_url}/chat/completions",
                headers=self._headers(),
                json=self._payload(base_prompt, target_classes, randomization, count),
            )
            resp.raise_for_status()
            return self._parse(resp.json(), base_prompt, target_classes,
                               randomization, count)

    # --- Fireworks call ----------------------------------------------------------

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {settings.fireworks_api_key}"}

    def _payload(self, base_prompt, target_classes, randomization, count) -> dict:
        user = (
            f"Base scene: {base_prompt}\n"
            f"Target classes (must all be plausibly present): {', '.join(target_classes)}\n"
            f"Randomization intensities — lighting: {randomization.lighting_variation:.2f}, "
            f"camera angle: {randomization.camera_angle_variation:.2f}, "
            f"background: {randomization.background_diversity:.2f}, "
            f"occlusion: {randomization.occlusion_rate:.2f}\n"
            f"Generate exactly {count} scenario prompts."
        )
        return {
            "model": settings.fireworks_model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user},
            ],
            "temperature": 0.9,
            "max_tokens": 220 * max(count, 1),
        }

    async def _chat(self, client: httpx.AsyncClient, base_prompt, target_classes,
                    randomization, count) -> list[str]:
        resp = await client.post(
            f"{settings.fireworks_base_url}/chat/completions",
            headers=self._headers(),
            json=self._payload(base_prompt, target_classes, randomization, count),
        )
        resp.raise_for_status()
        return self._parse(resp.json(), base_prompt, target_classes, randomization, count)

    def _parse(self, data: dict, base_prompt, target_classes,
               randomization, count) -> list[str]:
        text = data["choices"][0]["message"]["content"].strip()
        match = re.search(r"\[.*\]", text, re.DOTALL)
        if match:
            try:
                scenarios = [s for s in json.loads(match.group(0)) if isinstance(s, str)]
                if scenarios:
                    return scenarios[:count]
            except json.JSONDecodeError:
                pass
        # Model ignored the JSON instruction; salvage line-by-line.
        lines = [ln.strip("-•* \t") for ln in text.splitlines() if len(ln.strip()) > 20]
        if lines:
            return lines[:count]
        return self._fallback(base_prompt, target_classes, randomization, count)

    # --- deterministic fallback ---------------------------------------------------

    def _fallback(self, base_prompt: str, target_classes: list[str],
                  randomization: DomainRandomizationConfig, count: int) -> list[str]:
        def take(pool: list[str], intensity: float) -> list[str]:
            n = max(1, round(1 + intensity * (len(pool) - 1)))
            return pool[:n]

        combos = itertools.cycle(itertools.product(
            take(_LIGHTING, randomization.lighting_variation),
            take(_ANGLES, randomization.camera_angle_variation),
            take(_BACKDROPS, randomization.background_diversity),
        ))
        classes = ", ".join(c.replace("_", " ") for c in target_classes)
        out = []
        for i, (light, angle, backdrop) in zip(range(count), combos):
            occ = (
                f", {_OCCLUSION[i % len(_OCCLUSION)]}"
                if (i / max(count, 1)) < randomization.occlusion_rate
                else ""
            )
            out.append(
                f"{base_prompt}, {angle}, {light}, {backdrop}{occ}, "
                f"showing {classes}, photorealistic, sharp focus"
            )
        return out


prompt_agent = PromptAgent()
