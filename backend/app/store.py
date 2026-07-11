"""In-memory state with JSON persistence.

One process owns all state (runs, datasets, models, ...); mutations happen on
the event loop thread, so plain dicts are safe. `save()` snapshots to
data/state.json so a restart keeps real artifacts minted by past runs.
Seed data covers only tenancy (org / members / projects) — runs, datasets and
models start empty and are created by real pipeline runs.
"""

import json
import threading
from datetime import datetime, timezone
from itertools import count
from pathlib import Path

from pydantic import BaseModel

from .config import DATA_DIR
from .schemas import (
    AnnotatedImage,
    ApiKey,
    Dataset,
    FoundryFeedback,
    LogEvent,
    Member,
    ModelArtifact,
    Organization,
    PipelineRun,
    Project,
)

STATE_FILE = DATA_DIR / "state.json"


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class Store:
    def __init__(self) -> None:
        self.organizations: list[Organization] = []
        self.members: list[Member] = []
        self.projects: list[Project] = []
        self.runs: dict[str, PipelineRun] = {}
        self.run_logs: dict[str, list[LogEvent]] = {}
        self.datasets: dict[str, Dataset] = {}
        self.images: dict[str, list[AnnotatedImage]] = {}  # datasetId -> images
        self.models: dict[str, ModelArtifact] = {}
        self.api_keys: dict[str, ApiKey] = {}
        self.feedback: dict[str, FoundryFeedback] = {}
        self.gpu_seconds_used: float = 0.0
        self._counters: dict[str, count] = {}
        self._save_lock = threading.Lock()

    # --- ids ---------------------------------------------------------------

    def next_id(self, prefix: str) -> str:
        if prefix not in self._counters:
            self._counters[prefix] = count(1)
        while True:
            candidate = f"{prefix}_{next(self._counters[prefix]):04d}"
            if not self._id_taken(prefix, candidate):
                return candidate

    def _id_taken(self, prefix: str, candidate: str) -> bool:
        pools: dict[str, set[str]] = {
            "run": set(self.runs),
            "ds": set(self.datasets),
            "model": set(self.models),
            "key": set(self.api_keys),
            "fb": set(self.feedback),
            "proj": {p.id for p in self.projects},
        }
        pool = pools.get(prefix)
        return pool is not None and candidate in pool

    # --- persistence ---------------------------------------------------------

    def save(self) -> None:
        def dump(items):
            return [i.model_dump(by_alias=True) for i in items]

        snapshot = {
            "organizations": dump(self.organizations),
            "members": dump(self.members),
            "projects": dump(self.projects),
            "runs": dump(self.runs.values()),
            "runLogs": {rid: dump(logs) for rid, logs in self.run_logs.items()},
            "datasets": dump(self.datasets.values()),
            "images": {did: dump(imgs) for did, imgs in self.images.items()},
            "models": dump(self.models.values()),
            "apiKeys": dump(self.api_keys.values()),
            "feedback": dump(self.feedback.values()),
            "gpuSecondsUsed": self.gpu_seconds_used,
        }
        with self._save_lock:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            tmp = STATE_FILE.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(snapshot, indent=1), encoding="utf-8")
            tmp.replace(STATE_FILE)

    def load(self) -> bool:
        if not STATE_FILE.exists():
            return False
        raw = json.loads(STATE_FILE.read_text(encoding="utf-8"))

        def parse(model: type[BaseModel], items):
            return [model.model_validate(i) for i in items]

        self.organizations = parse(Organization, raw.get("organizations", []))
        self.members = parse(Member, raw.get("members", []))
        # Migration: pre-v0.5 seeds shipped a fictional teammate; purge her
        # from persisted state (she would re-save herself otherwise).
        self.members = [m for m in self.members if m.email != "maria@aionvis.dev"]
        self.projects = parse(Project, raw.get("projects", []))
        # Migration: pre-fix restarts could reissue an existing project id
        # (the "proj" counter wasn't reseeded), after which every by-id
        # lookup mixed two projects. Re-id later duplicates; runs/feedback
        # keep pointing at the oldest holder — artifacts created under a
        # collision were already mixed and can't be untangled automatically.
        taken = {p.id for p in self.projects}
        seen: set[str] = set()
        for p in self.projects:
            if p.id in seen:
                old, n = p.id, 1
                while f"proj_{n:04d}" in taken:
                    n += 1
                p.id = f"proj_{n:04d}"
                taken.add(p.id)
                print(f"[store] duplicate project id {old}: "
                      f"re-id'd '{p.name}' as {p.id}")
            seen.add(p.id)
        self.runs = {r.id: r for r in parse(PipelineRun, raw.get("runs", []))}
        self.run_logs = {
            rid: parse(LogEvent, logs) for rid, logs in raw.get("runLogs", {}).items()
        }
        self.datasets = {d.id: d for d in parse(Dataset, raw.get("datasets", []))}
        self.images = {
            did: parse(AnnotatedImage, imgs)
            for did, imgs in raw.get("images", {}).items()
        }
        self.models = {m.id: m for m in parse(ModelArtifact, raw.get("models", []))}
        self.api_keys = {k.id: k for k in parse(ApiKey, raw.get("apiKeys", []))}
        self.feedback = {
            f.id: f for f in parse(FoundryFeedback, raw.get("feedback", []))
        }
        self.gpu_seconds_used = float(raw.get("gpuSecondsUsed", 0.0))
        self._reseed_counters()
        # A crash/restart mid-run leaves orphaned "running" runs; mark them.
        for r in self.runs.values():
            if r.status in ("queued", "running", "paused"):
                r.status = "failed"
                r.failure_reason = "Backend restarted while the run was in flight."
                r.finished_at = now_iso()
        return True

    def _reseed_counters(self) -> None:
        def bump(prefix: str, ids) -> None:
            highest = 0
            for i in ids:
                tail = i.rsplit("_", 1)[-1]
                if tail.isdigit():
                    highest = max(highest, int(tail))
            self._counters[prefix] = count(highest + 1)

        bump("run", self.runs)
        bump("ds", self.datasets)
        bump("model", self.models)
        bump("key", self.api_keys)
        bump("fb", self.feedback)
        # Projects and feedback are also next_id-allocated; leaving them out
        # of the reseed reissued proj_0001 after every restart — a new
        # project then collided with an old one and every by-id lookup mixed
        # the two (hit live 2026-07-11: a hotwheels run trained on another
        # project's classes).
        bump("proj", [p.id for p in self.projects])

    # --- seed ----------------------------------------------------------------

    def seed(self) -> None:
        org = Organization(
            id="org_aionvis",
            name="aionVIS Robotics",
            slug="aionvis-robotics",
            plan="enterprise",
            created_at="2026-01-12T09:00:00.000Z",
        )
        self.organizations = [org]
        self.members = [
            Member(
                id="member_1",
                org_id=org.id,
                name="Athanasios Kotidis",
                email="athkot@proton.me",
                role="owner",
            ),
        ]
        self.projects = [
            Project(
                id="proj_pcb",
                org_id=org.id,
                name="PCB Defect Detection",
                description=(
                    "Detect solder and component defects on assembly-line "
                    "circuit boards."
                ),
                target_classes=[
                    "solder_bridge",
                    "missing_component",
                    "tombstone",
                    "cold_joint",
                ],
                created_at="2026-02-03T10:30:00.000Z",
            ),
            Project(
                id="proj_warehouse",
                org_id=org.id,
                name="Warehouse Safety",
                description=(
                    "Spot forklifts, pallets and workers without hi-vis vests "
                    "in warehouse CCTV."
                ),
                target_classes=["forklift", "pallet", "worker", "no_hivis_vest"],
                created_at="2026-03-18T14:15:00.000Z",
            ),
        ]


store = Store()
