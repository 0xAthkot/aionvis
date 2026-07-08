"""Prompt Agent — designs training-scene prompts from the user's USE CASE.

The user says what the model is FOR ("my drone needs to detect rotten
potatoes in the field") — never a diffusion prompt. This agent infers the
deployment viewpoint (drone → aerial, CCTV → high-angle, inspection line →
macro), the environment, and how the target classes appear there, then
writes the domain-randomized text-to-image prompts itself.

Real path: Gemma via vLLM on the MI300X (any OpenAI-compatible chat
endpoint, see LLM_BASE_URL). When the endpoint is unreachable it degrades
to a deterministic template designer (platform keywords → viewpoint, the
distilled use-case context → scene) and says so in its provider label, so
the rest of the pipeline stays usable on boxes without an LLM.
"""

import itertools
import json
import re
import time

import httpx

from ..config import settings
from ..schemas import DomainRandomizationConfig

SYSTEM_PROMPT = """You are the Prompt Agent of an autonomous data-generation swarm.
The user tells you what their detection model is FOR — its deployment, in
plain language (e.g. "my drone needs to detect rotten potatoes in the field").
You design the training imagery for that deployment:
1. Infer the camera platform and viewpoint (drone -> low-altitude aerial,
   CCTV -> high-mounted oblique, assembly line -> top-down macro, vehicle ->
   dash-level, handheld -> eye-level) and the environment it operates in.
2. Write diverse, concrete prompts for a text-to-image diffusion model that
   depict the TARGET CLASSES exactly as that camera would see them, applying
   domain randomization. Never echo the user's intent wording ("needs to
   detect") — describe scenes, not goals.
Every prompt MUST clearly depict the target object classes so they can be
detected and labeled afterwards. Vary lighting, camera angle, background and
occlusion according to the given intensities (0=none, 1=extreme). Keep each
prompt a single sentence under 60 words, photographic style, no numbering.
Respond with ONLY a JSON array of strings."""

# --- deterministic fallback vocabulary (LLM endpoint offline) ----------------

_LIGHTING = ["soft natural light", "harsh direct light", "dim ambient light",
             "golden-hour sidelight", "cool overcast light", "high-contrast light"]
_ANGLES = ["top-down view", "45-degree elevated view", "eye-level closeup",
           "wide-angle overview", "low oblique angle", "macro detail shot"]
_BACKDROPS = ["with a cluttered background", "against a plain background",
              "in a busy real-world scene", "with natural surroundings",
              "in the working environment", "with equipment in the background"]
_OCCLUSION = ["partially occluded", "with overlapping objects",
              "half-hidden behind foreground elements", "with objects crossing the frame"]

# Platform keywords -> the viewpoint that camera actually has. First match wins.
_PLATFORM_VIEWS: list[tuple[str, str, list[str]]] = [
    (r"\b(drone|uav|quadcopter|aerial|crop.?duster)\b",
     "seen from a low-altitude aerial drone view",
     ["directly overhead", "at a slight oblique from above", "banking low over the scene"]),
    (r"\b(cctv|surveillance|security camera|dome camera)\b",
     "seen from a high-mounted security camera",
     ["from a ceiling corner", "down a long sightline", "with a wide surveillance angle"]),
    (r"\b(assembly|conveyor|production line|inspection|aoi|pcb|circuit)\b",
     "in a sharp top-down inspection view",
     ["macro close-up", "flat overhead framing", "at a shallow inspection angle"]),
    (r"\b(dashcam|windshield|vehicle|truck|forklift camera|car)\b",
     "seen from a vehicle-mounted camera at road level",
     ["through the windshield", "from a front bumper mount", "at intersection distance"]),
    (r"\b(robot|robotic arm|gripper|cobot)\b",
     "seen from a robot-mounted camera at close working distance",
     ["from the gripper's approach angle", "at bin-picking distance", "over the work cell"]),
    (r"\b(microscope|micro|lab)\b",
     "in an extreme macro laboratory view",
     ["at high magnification", "on a lab stage", "under controlled lab light"]),
]

# Intent phrasing the fallback strips before using the words as scene context.
_INTENT_WORDS = re.compile(
    r"\b(my|our|your|the|a|an|i|we|it|to|that|which|should|must|can|will|"
    r"want(s|ed)?|need(s|ed)?|has|have|detect(s|ing|ion)?|find(s|ing)?|"
    r"spot(s|ting)?|identify(ing)?|identifies|recognize(s|d)?|count(s|ing)?|"
    r"locate(s|d)?|flag(s|ging)?|model|camera|system|app|drone|uav|cctv|"
    r"surveillance|robot|dashcam|vehicle|microscope)\b",
    re.IGNORECASE,
)


class PromptAgent:
    display_name = "Prompt Agent"

    def __init__(self) -> None:
        # Same params → same scenarios, one API call. The wizard preview and
        # the launched run would otherwise each pay for an identical call.
        self._cache: dict[tuple, list[str]] = {}
        self._probe_ok: bool | None = None
        self._probe_at: float = 0.0

    def _cache_key(self, use_case, target_classes, randomization, count,
                   hard_cases: tuple = ()) -> tuple:
        return (
            use_case.strip().lower(), tuple(target_classes), hard_cases,
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
    def available(self) -> bool:
        """The LLM endpoint answers. Probed at most once a minute so labels
        stay honest without a health check per request; starting vLLM after
        the backend is picked up within that window."""
        if time.monotonic() - self._probe_at > 60 or self._probe_ok is None:
            self._probe_at = time.monotonic()
            try:
                httpx.get(f"{settings.llm_base_url}/models",
                          headers=self._headers(), timeout=3).raise_for_status()
                self._probe_ok = True
            except httpx.HTTPError:
                self._probe_ok = False
        return self._probe_ok

    @property
    def model_label(self) -> str:
        return settings.llm_model.rsplit("/", 1)[-1] if self.available else "template designer"

    @property
    def provider_label(self) -> str:
        if not self.available:
            return "local fallback (LLM endpoint offline)"
        if settings.llm_provider_label:
            return settings.llm_provider_label
        return "self-hosted (OpenAI-compatible)"

    # --- public API ------------------------------------------------------------

    async def expand_async(self, use_case: str, target_classes: list[str],
                           randomization: DomainRandomizationConfig, count: int,
                           hard_cases: list[str] | None = None) -> list[str]:
        hard = tuple(hard_cases or ())
        if not self.available:
            return self._fallback(use_case, target_classes, randomization,
                                  count, hard)
        key = self._cache_key(use_case, target_classes, randomization, count,
                              hard)
        if key in self._cache:
            return self._cache[key]
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                data = await self._chat(client, use_case, target_classes,
                                         randomization, count, hard)
        except httpx.HTTPError as exc:
            # A dead endpoint or retired model must degrade, never 500 the wizard.
            print(f"[prompt-agent] LLM call failed ({exc}); using fallback")
            return self._fallback(use_case, target_classes, randomization,
                                  count, hard)
        self._cache_put(key, data)
        return data

    def expand(self, use_case: str, target_classes: list[str],
               randomization: DomainRandomizationConfig, count: int,
               hard_cases: list[str] | None = None) -> list[str]:
        """Synchronous variant for the pipeline worker thread."""
        hard = tuple(hard_cases or ())
        if not self.available:
            return self._fallback(use_case, target_classes, randomization,
                                  count, hard)
        key = self._cache_key(use_case, target_classes, randomization, count,
                              hard)
        if key in self._cache:
            return self._cache[key]
        try:
            with httpx.Client(timeout=60) as client:
                resp = client.post(
                    f"{settings.llm_base_url}/chat/completions",
                    headers=self._headers(),
                    json=self._payload(use_case, target_classes, randomization,
                                       count, hard),
                )
                resp.raise_for_status()
                scenarios = self._parse(resp.json(), use_case, target_classes,
                                        randomization, count)
        except httpx.HTTPError as exc:
            print(f"[prompt-agent] LLM call failed ({exc}); using fallback")
            return self._fallback(use_case, target_classes, randomization, count)
        self._cache_put(key, scenarios)
        return scenarios

    # --- LLM call ------------------------------------------------------------

    def _headers(self) -> dict:
        # vLLM and other self-hosted servers accept keyless requests.
        if not settings.llm_api_key:
            return {}
        return {"Authorization": f"Bearer {settings.llm_api_key}"}

    def _payload(self, use_case, target_classes, randomization, count,
                 hard_cases: tuple = ()) -> dict:
        user = (
            f"Use case — what the model is for: {use_case}\n"
            f"Target classes (every prompt must plausibly show them, as the "
            f"deployed camera would see them): {', '.join(target_classes)}\n"
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
            "model": settings.llm_model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user},
            ],
            "temperature": 0.9,
            # ~80 tokens per sub-60-word prompt + JSON overhead + headroom
            # for reasoning models that think before answering.
            "max_tokens": 100 * max(count, 1) + 700,
        }

    async def _chat(self, client: httpx.AsyncClient, use_case, target_classes,
                    randomization, count, hard_cases: tuple = ()) -> list[str]:
        resp = await client.post(
            f"{settings.llm_base_url}/chat/completions",
            headers=self._headers(),
            json=self._payload(use_case, target_classes, randomization, count,
                               hard_cases),
        )
        resp.raise_for_status()
        return self._parse(resp.json(), use_case, target_classes, randomization, count)

    def _parse(self, data: dict, use_case, target_classes,
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
        return self._fallback(use_case, target_classes, randomization, count)

    # --- deterministic fallback ---------------------------------------------------

    @staticmethod
    def _deployment_view(use_case: str) -> tuple[str, list[str]]:
        """Viewpoint implied by the platform named in the use case."""
        for pattern, view, variants in _PLATFORM_VIEWS:
            if re.search(pattern, use_case, re.IGNORECASE):
                return view, variants
        return "", []

    @staticmethod
    def _scene_context(use_case: str) -> str:
        """The use case minus its intent phrasing — environment words only
        ('my drone needs to detect rotten potatoes in the field before
        harvest' → 'rotten potatoes in field before harvest')."""
        words = _INTENT_WORDS.sub(" ", use_case)
        return " ".join(words.replace(",", " ").split()).strip(" .!?")

    def _fallback(self, use_case: str, target_classes: list[str],
                  randomization: DomainRandomizationConfig, count: int,
                  hard_cases: tuple = ()) -> list[str]:
        def take(pool: list[str], intensity: float) -> list[str]:
            n = max(1, round(1 + intensity * (len(pool) - 1)))
            return pool[:n]

        view, view_variants = self._deployment_view(use_case)
        context = self._scene_context(use_case)
        classes = ", ".join(c.replace("_", " ") for c in target_classes)
        scene = context or classes
        # A named platform fixes the viewpoint; the angle slider then varies
        # framing within it instead of contradicting it.
        angle_pool = ([f"{view}, {v}" for v in view_variants] if view
                      else _ANGLES)

        combos = itertools.cycle(itertools.product(
            take(_LIGHTING, randomization.lighting_variation),
            take(angle_pool, randomization.camera_angle_variation),
            take(_BACKDROPS, randomization.background_diversity),
        ))
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
                f"Photorealistic scene of {scene}, {angle}, {light}, "
                f"{backdrop}{occ}{hard}, clearly showing {classes}, sharp focus"
            )
        return out


prompt_agent = PromptAgent()
