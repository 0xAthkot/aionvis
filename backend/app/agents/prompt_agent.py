"""Prompt Agent — designs training-scene prompts from the user's USE CASE.

The user says what the model is FOR ("my drone needs to detect rotten
potatoes in the field") — never a diffusion prompt. This agent infers the
deployment viewpoint (drone → aerial, CCTV → high-angle, inspection line →
macro), the environment, and how the target classes appear there, then
writes the domain-randomized text-to-image prompts itself.

Any number of scenes: they are designed in batches of 16 by parallel LLM
calls, each batch steered to a different lighting/distance/setting facet so
thousands of scenes stay diverse, then de-duplicated exactly. Which classes
a scene features follows the run's class mix (plan_scenes); the labeler
still looks for every target class in every image.

Real path: Gemma via vLLM on the MI300X (any OpenAI-compatible chat
endpoint, see LLM_BASE_URL). When the endpoint is unreachable it degrades
to a deterministic template designer (platform keywords → viewpoint, the
distilled use-case context → scene) and says so in its provider label, so
the rest of the pipeline stays usable on boxes without an LLM.
"""

import asyncio
import itertools
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

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
   depict the requested objects exactly as that camera would see them,
   applying domain randomization. Never echo the user's intent wording
   ("needs to detect") — describe scenes, not goals.
Every prompt MUST clearly depict the objects it is asked to feature, so they
can be detected and labeled afterwards. Vary lighting, camera angle,
background and occlusion according to the given intensities (0=none,
1=extreme). Keep each prompt a single sentence under 60 words, photographic
style, no numbering. Respond with ONLY a JSON array of strings, in the
requested order."""

# Default for DomainRandomizationConfig.max_classes_per_scene.
DEFAULT_MAX_CLASSES_PER_SCENE = 3

# One LLM call designs at most this many scenes: a single "give me 200
# prompts" completion truncates or degenerates long before 200.
_BATCH = 16
# Parallel design calls. Measured on the MI300X (Gemma 4 26B-A4B, vLLM):
# 7 scenes/s one call at a time, 30/s with 8 in flight, 89/s with 32.
_CONCURRENCY = 16


@dataclass(frozen=True)
class SceneSpec:
    """What one scene must feature. primary=None: every target class (the
    classic mode for small class lists); otherwise the main subject plus
    up to `companions` other target classes where they naturally belong."""

    primary: str | None
    others: tuple[str, ...] = ()
    companions: int = 0


def plan_scenes(target_classes: list[str], randomization: DomainRandomizationConfig,
                count: int) -> list[SceneSpec]:
    """Per-scene focus that realizes the class mix exactly (smooth weighted
    round-robin: every prefix of the plan is as close to the requested
    shares as integers allow, so small runs get the mix too)."""
    classes = [c.replace("_", " ") for c in target_classes]
    k = max(1, randomization.max_classes_per_scene or DEFAULT_MAX_CLASSES_PER_SCENE)
    if randomization.class_mix is None and len(classes) <= k:
        return [SceneSpec(primary=None)] * count
    mix = {c.replace("_", " ").lower(): max(float(v), 0.0)
           for c, v in (randomization.class_mix or {}).items()}
    weights = [mix.get(c.lower(), 0.0) if randomization.class_mix else 1.0
               for c in classes]
    if sum(weights) <= 0:
        weights = [1.0] * len(classes)
    total = sum(weights)
    current = [0.0] * len(classes)
    plan = []
    for _ in range(count):
        for j, w in enumerate(weights):
            current[j] += w
        pick = max(range(len(classes)), key=lambda j: current[j])
        current[pick] -= total
        others = tuple(c for j, c in enumerate(classes) if j != pick)
        plan.append(SceneSpec(primary=classes[pick], others=others,
                              companions=min(k - 1, len(others))))
    return plan


def _facet(batch: int, randomization: DomainRandomizationConfig) -> str:
    """Variation focus for one batch. Parallel batches can't see each
    other's scenes, so each is steered to a different corner of the scene
    space; the pools shrink with the randomization sliders."""
    def pool(items: list[str], intensity: float) -> list[str]:
        return items[:max(1, round(1 + intensity * (len(items) - 1)))]

    light = pool(_FACET_LIGHT, randomization.lighting_variation)
    dist = pool(_FACET_DISTANCE, randomization.camera_angle_variation)
    setting = pool(_FACET_SETTING, randomization.background_diversity)
    # Mixed-radix walk: consecutive batches differ in every axis.
    return (f"{light[batch % len(light)]}, "
            f"{dist[(batch // len(light)) % len(dist)]}, "
            f"{setting[(batch // (len(light) * len(dist))) % len(setting)]}")


_FACET_LIGHT = ["early morning light", "bright midday sun", "overcast diffuse light",
                "golden-hour light", "dusk", "night under artificial lighting",
                "indoor fluorescent light", "harsh light with deep shadows"]
_FACET_DISTANCE = ["close-up framing", "medium-distance framing", "wide shots",
                   "objects far away and small in the frame"]
_FACET_SETTING = ["cluttered surroundings", "sparse, clean surroundings",
                  "busy scenes with people and equipment",
                  "unusual variations of the setting", "different weather and seasons"]

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
        # Same params → same scenarios, one design pass. The wizard preview
        # and the launched run would otherwise each pay for it.
        self._cache: dict[tuple, list[str]] = {}
        self._probe_ok: bool | None = None
        self._probe_at: float = 0.0

    def _cache_key(self, use_case, target_classes, randomization, count,
                   hard_cases: tuple = ()) -> tuple:
        mix = tuple(sorted((randomization.class_mix or {}).items()))
        return (
            use_case.strip().lower(), tuple(target_classes), hard_cases,
            round(randomization.lighting_variation, 2),
            round(randomization.camera_angle_variation, 2),
            round(randomization.background_diversity, 2),
            round(randomization.occlusion_rate, 2),
            mix, randomization.max_classes_per_scene,
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
        """Same as expand(), off the event loop."""
        return await asyncio.to_thread(self.expand, use_case, target_classes,
                                       randomization, count, hard_cases)

    def expand(self, use_case: str, target_classes: list[str],
               randomization: DomainRandomizationConfig, count: int,
               hard_cases: list[str] | None = None) -> list[str]:
        """`count` scene prompts, in plan order (scene i features plan[i])."""
        if count <= 0:
            return []
        hard = tuple(hard_cases or ())
        plan = plan_scenes(target_classes, randomization, count)
        if not self.available:
            return self._fallback(use_case, target_classes, randomization,
                                  count, hard, plan=plan)
        key = self._cache_key(use_case, target_classes, randomization, count,
                              hard)
        if key in self._cache:
            return self._cache[key]

        n_batches = (count + _BATCH - 1) // _BATCH
        failures: list[str] = []

        def design(b: int) -> list[str | None]:
            specs = plan[b * _BATCH:(b + 1) * _BATCH]
            payload = self._payload(
                use_case, target_classes, randomization, specs,
                hard if b == 0 else (),
                facet=_facet(b, randomization) if n_batches > 1 else None)
            try:
                with httpx.Client(timeout=180) as client:
                    resp = client.post(f"{settings.llm_base_url}/chat/completions",
                                       headers=self._headers(), json=payload)
                    resp.raise_for_status()
                    got = self._parse_list(resp.json())
            except httpx.HTTPError as exc:
                failures.append(str(exc))
                got = []
            # Keep alignment with the plan; gaps are topped up below.
            return [got[i] if i < len(got) else None for i in range(len(specs))]

        with ThreadPoolExecutor(max_workers=min(_CONCURRENCY, n_batches)) as pool:
            designed = [s for batch in pool.map(design, range(n_batches)) for s in batch]
        if failures:
            print(f"[prompt-agent] {len(failures)}/{n_batches} design calls failed "
                  f"({failures[0]}); template scenes fill those slots")
        if all(s is None for s in designed):
            return self._fallback(use_case, target_classes, randomization,
                                  count, hard, plan=plan)

        # Exact duplicates and missing slots get a template scene with the
        # same featured classes, so the class mix holds either way.
        seen: set[str] = set()
        holes = []
        for i, s in enumerate(designed):
            if s is None or s in seen:
                designed[i] = None
                holes.append(i)
            else:
                seen.add(s)
        if holes:
            filler = self._fallback(use_case, target_classes, randomization,
                                    len(holes), (), plan=[plan[i] for i in holes],
                                    offset=len(designed))
            for i, s in zip(holes, filler):
                designed[i] = s
        scenarios = [s for s in designed if s is not None]
        self._cache_put(key, scenarios)
        return scenarios

    # --- LLM call ------------------------------------------------------------

    def _headers(self) -> dict:
        # vLLM and other self-hosted servers accept keyless requests.
        if not settings.llm_api_key:
            return {}
        return {"Authorization": f"Bearer {settings.llm_api_key}"}

    def _payload(self, use_case, target_classes, randomization,
                 specs: list[SceneSpec], hard_cases: tuple = (),
                 facet: str | None = None) -> dict:
        count = len(specs)
        classes = ", ".join(c.replace("_", " ") for c in target_classes)
        user = (
            f"Use case — what the model is for: {use_case}\n"
            f"Target classes: {classes}\n"
            f"Randomization intensities — lighting: {randomization.lighting_variation:.2f}, "
            f"camera angle: {randomization.camera_angle_variation:.2f}, "
            f"background: {randomization.background_diversity:.2f}, "
            f"occlusion: {randomization.occlusion_rate:.2f}\n"
        )
        if all(s.primary is None for s in specs):
            user += (f"Every prompt must clearly show all of: {classes}, as the "
                     "deployed camera would see them.\n"
                     f"Generate exactly {count} scenario prompts.")
        else:
            lines = []
            for i, s in enumerate(specs, 1):
                line = f"{i}. main subject: {s.primary}"
                if s.companions:
                    line += (f"; may also show, only where they naturally belong, "
                             f"up to {s.companions} of: {', '.join(s.others)}")
                lines.append(line)
            user += (f"Generate exactly {count} scenario prompts, in this order, "
                     "each clearly showing its main subject:\n" + "\n".join(lines))
        if facet:
            user += (f"\nThis batch is one part of a much larger set. Vary this "
                     f"batch around: {facet}. Keep the deployment's viewpoint.")
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

    @staticmethod
    def _parse_list(data: dict) -> list[str]:
        msg = data.get("choices", [{}])[0].get("message", {})
        # Reasoning models may put everything in reasoning_content when the
        # token budget runs out before the final answer.
        text = (msg.get("content") or msg.get("reasoning_content") or "").strip()
        match = re.search(r"\[.*\]", text, re.DOTALL)
        if match:
            try:
                scenarios = [s.strip() for s in json.loads(match.group(0))
                             if isinstance(s, str) and s.strip()]
                if scenarios:
                    return scenarios
            except json.JSONDecodeError:
                pass
        # Model ignored the JSON instruction; salvage line-by-line.
        return [ln.strip("-•* \t") for ln in text.splitlines() if len(ln.strip()) > 20]

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
                  hard_cases: tuple = (), plan: list[SceneSpec] | None = None,
                  offset: int = 0) -> list[str]:
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

        combos = itertools.islice(itertools.cycle(itertools.product(
            take(_LIGHTING, randomization.lighting_variation),
            take(angle_pool, randomization.camera_angle_variation),
            take(_BACKDROPS, randomization.background_diversity),
        )), offset, None)
        plan = plan or [SceneSpec(primary=None)] * count
        out = []
        for i, (light, angle, backdrop) in zip(range(count), combos):
            occ = (
                f", {_OCCLUSION[i % len(_OCCLUSION)]}"
                if (i / max(count, 1)) < randomization.occlusion_rate
                else ""
            )
            hard = (f", emphasizing this failure case: {hard_cases[i]}"
                    if i < len(hard_cases) else "")
            spec = plan[i] if i < len(plan) else SceneSpec(primary=None)
            showing = spec.primary or classes
            variant = f", variation {offset + i + 1}" if offset else ""
            out.append(
                f"Photorealistic scene of {scene}, {angle}, {light}, "
                f"{backdrop}{occ}{hard}, clearly showing {showing}, sharp focus"
                f"{variant}"
            )
        return out


prompt_agent = PromptAgent()
