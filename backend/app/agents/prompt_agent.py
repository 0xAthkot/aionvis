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

    def __init__(self) -> None:
        # Same params → same scenarios, one API call. The wizard preview and
        # the launched run would otherwise each pay for an identical call.
        self._cache: dict[tuple, list[str]] = {}

    def _cache_key(self, base_prompt, target_classes, randomization, count,
                   hard_cases: tuple = ()) -> tuple:
        return (
            base_prompt.strip().lower(), tuple(target_classes), hard_cases,
            round(randomization.lighting_variation, 2),
            round(randomization.camera_angle_variation, 2),
            round(randomization.background_diversity, 2),
            round(randomization.occlusion_rate, 2),
            count,
        )

    def _cache_put(self, key: tuple, scenarios: list[str]) -> None:
        if len(self._cache) >= 64:  # tiny FIFO; a demo session never hits this
            self._cache.pop(next(iter(self._cache)))
        self._cache[key] = scenarios

    @property
    def has_key(self) -> bool:
        return bool(settings.fireworks_api_key)

    @property
    def model_label(self) -> str:
        return settings.fireworks_model.rsplit("/", 1)[-1] if self.has_key else "template expander"

    @property
    def provider_label(self) -> str:
        if not self.has_key:
            return "local fallback (set FIREWORKS_API_KEY)"
        if settings.llm_provider_label:
            return settings.llm_provider_label
        return ("Fireworks AI" if "fireworks.ai" in settings.fireworks_base_url
                else "self-hosted (OpenAI-compatible)")

    # --- public API ------------------------------------------------------------

    async def expand_async(self, base_prompt: str, target_classes: list[str],
                           randomization: DomainRandomizationConfig, count: int) -> list[str]:
        if not self.has_key:
            return self._fallback(base_prompt, target_classes, randomization, count)
        key = self._cache_key(base_prompt, target_classes, randomization, count)
        if key in self._cache:
            return self._cache[key]
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                data = await self._chat(client, base_prompt, target_classes,
                                         randomization, count)
        except httpx.HTTPError as exc:
            # A dead key or retired model must degrade, never 500 the wizard.
            print(f"[prompt-agent] Fireworks call failed ({exc}); using fallback")
            return self._fallback(base_prompt, target_classes, randomization, count)
        self._cache_put(key, data)
        return data

    def expand(self, base_prompt: str, target_classes: list[str],
               randomization: DomainRandomizationConfig, count: int,
               hard_cases: list[str] | None = None) -> list[str]:
        """Synchronous variant for the pipeline worker thread."""
        hard = tuple(hard_cases or ())
        if not self.has_key:
            return self._fallback(base_prompt, target_classes, randomization,
                                  count, hard)
        key = self._cache_key(base_prompt, target_classes, randomization, count,
                              hard)
        if key in self._cache:
            return self._cache[key]
        try:
            with httpx.Client(timeout=60) as client:
                resp = client.post(
                    f"{settings.fireworks_base_url}/chat/completions",
                    headers=self._headers(),
                    json=self._payload(base_prompt, target_classes, randomization,
                                       count, hard),
                )
                resp.raise_for_status()
                scenarios = self._parse(resp.json(), base_prompt, target_classes,
                                        randomization, count)
        except httpx.HTTPError as exc:
            print(f"[prompt-agent] Fireworks call failed ({exc}); using fallback")
            return self._fallback(base_prompt, target_classes, randomization, count)
        self._cache_put(key, scenarios)
        return scenarios

    # --- Fireworks call ----------------------------------------------------------

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {settings.fireworks_api_key}"}

    def _payload(self, base_prompt, target_classes, randomization, count,
                 hard_cases: tuple = ()) -> dict:
        user = (
            f"Base scene: {base_prompt}\n"
            f"Target classes (must all be plausibly present): {', '.join(target_classes)}\n"
            f"Randomization intensities — lighting: {randomization.lighting_variation:.2f}, "
            f"camera angle: {randomization.camera_angle_variation:.2f}, "
            f"background: {randomization.background_diversity:.2f}, "
            f"occlusion: {randomization.occlusion_rate:.2f}\n"
            f"Generate exactly {count} scenario prompts."
        )
        if hard_cases:
            cases = "\n".join(f"- {c}" for c in hard_cases)
            user += (
                "\nA deployed model trained on earlier data FAILED on these "
                f"observed cases — dedicate several scenarios to covering them:\n{cases}"
            )
        return {
            "model": settings.fireworks_model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user},
            ],
            "temperature": 0.9,
            # ~80 tokens per sub-60-word prompt + JSON overhead + headroom
            # for reasoning models that think before answering.
            "max_tokens": 100 * max(count, 1) + 700,
            # Scenario expansion needs diversity, not deliberation; keeps
            # reasoning models (gpt-oss) cheap. Non-reasoning slugs ignore it.
            "reasoning_effort": "low",
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
        msg = data.get("choices", [{}])[0].get("message", {})
        # Reasoning models may put everything in reasoning_content when the
        # token budget runs out before the final answer.
        text = (msg.get("content") or msg.get("reasoning_content") or "").strip()
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
                  randomization: DomainRandomizationConfig, count: int,
                  hard_cases: tuple = ()) -> list[str]:
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
            hard = (f", emphasizing this failure case: {hard_cases[i]}"
                    if i < len(hard_cases) else "")
            out.append(
                f"{base_prompt}, {angle}, {light}, {backdrop}{occ}{hard}, "
                f"showing {classes}, photorealistic, sharp focus"
            )
        return out


prompt_agent = PromptAgent()
