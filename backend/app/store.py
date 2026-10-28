"""In-memory state with JSON persistence.

One process owns all state (runs, datasets, models, ...). Persistence is
split by size so saving stays cheap however big runs get:

  data/state.json            small metadata: tenancy, runs, datasets, models
  data/images/{ds}.json      one dataset's labeled images, rewritten only
                             when that dataset changes (compile, merge)
  data/images/{ds}.curation.jsonl
                             append-only accept/reject clicks on top of it
  data/logs/{run}.jsonl      append-only run log (buffered, flushed ~1 s)

A 50k-image run used to put every label, polygon and log line into the one
state.json and re-serialize all of it on each save. Old single-file state
migrates on load. Seed data covers only tenancy (org / members / projects);
runs, datasets and models are created by real pipeline runs.
"""

import json
import os
import threading
import time
from collections import deque
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
LOGS_DIR = DATA_DIR / "logs"
IMAGES_DIR = DATA_DIR / "images"
# Newest log lines kept in memory per run; the full history is on disk.
LOG_TAIL = 5000
_LOG_FLUSH_LINES = 256
_LOG_FLUSH_SECONDS = 1.0


def _tail_lines(path: Path, n: int) -> list[bytes]:
    """The last n lines of a file, read backwards in blocks (a 1M-line log
    is never read whole for a tail request)."""
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        pos = f.tell()
        chunks: list[bytes] = []
        newlines = 0
        while pos > 0 and newlines <= n:
            step = min(65536, pos)
            pos -= step
            f.seek(pos)
            chunk = f.read(step)
            chunks.append(chunk)
            newlines += chunk.count(b"\n")
    lines = b"".join(reversed(chunks)).splitlines()
    return [ln for ln in lines if ln.strip()][-n:]


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class Store:
    def __init__(self) -> None:
        self.organizations: list[Organization] = []
        self.members: list[Member] = []
        self.projects: list[Project] = []
        self.runs: dict[str, PipelineRun] = {}
        # runId -> newest LOG_TAIL events (full history: data/logs/{run}.jsonl)
        self.run_logs: dict[str, deque[LogEvent]] = {}
        self.datasets: dict[str, Dataset] = {}
        self.images: dict[str, list[AnnotatedImage]] = {}  # datasetId -> images
        self.models: dict[str, ModelArtifact] = {}
        self.api_keys: dict[str, ApiKey] = {}
        self.feedback: dict[str, FoundryFeedback] = {}
        self.gpu_seconds_used: float = 0.0
        self._counters: dict[str, count] = {}
        self._save_lock = threading.Lock()
        # Datasets whose images file must be rewritten on the next save,
        # and datasets deleted since the last save (files to remove).
        self._dirty_images: set[str] = set()
        self._dropped_images: set[str] = set()
        # Pending log lines per run, appended to disk in batches.
        self._log_lock = threading.Lock()
        self._log_buffers: dict[str, list[str]] = {}
        self._log_flushed_at: dict[str, float] = {}
        # Tests switch disk writes off (conftest); everything stays in memory.
        self.persist = True

    # --- run logs -----------------------------------------------------------

    def start_run_log(self, run_id: str) -> None:
        self.run_logs[run_id] = deque(maxlen=LOG_TAIL)

    def append_log(self, event: LogEvent) -> None:
        """Thread-safe: streaming mode logs from three agent threads."""
        line = json.dumps(event.model_dump(by_alias=True), separators=(",", ":"))
        with self._log_lock:
            tail = self.run_logs.get(event.run_id)
            if tail is None:
                tail = self.run_logs[event.run_id] = deque(maxlen=LOG_TAIL)
            tail.append(event)
            buf = self._log_buffers.setdefault(event.run_id, [])
            buf.append(line)
            due = (len(buf) >= _LOG_FLUSH_LINES or time.monotonic()
                   - self._log_flushed_at.get(event.run_id, 0.0) >= _LOG_FLUSH_SECONDS)
        if due:
            self.flush_logs(event.run_id)

    def flush_logs(self, run_id: str | None = None) -> None:
        with self._log_lock:
            ids = [run_id] if run_id else list(self._log_buffers)
            pending = {rid: self._log_buffers.pop(rid, []) for rid in ids}
            now = time.monotonic()
            for rid in ids:
                self._log_flushed_at[rid] = now
            if not self.persist:
                return
            for rid, lines in pending.items():
                if lines:
                    LOGS_DIR.mkdir(parents=True, exist_ok=True)
                    with open(LOGS_DIR / f"{rid}.jsonl", "a", encoding="utf-8") as f:
                        f.write("\n".join(lines) + "\n")

    def read_logs(self, run_id: str, limit: int | None = None) -> list[LogEvent]:
        """Full history from disk (oldest first), or its newest `limit` lines."""
        self.flush_logs(run_id)
        path = LOGS_DIR / f"{run_id}.jsonl"
        if not (self.persist and path.exists()):
            events = list(self.run_logs.get(run_id, ()))
            return events[-limit:] if limit else events
        if limit:
            raw = _tail_lines(path, limit)
        else:
            raw = [ln for ln in path.read_bytes().splitlines() if ln.strip()]
        return [LogEvent.model_validate_json(ln) for ln in raw]

    def drop_logs(self, run_id: str) -> None:
        with self._log_lock:
            self.run_logs.pop(run_id, None)
            self._log_buffers.pop(run_id, None)
            self._log_flushed_at.pop(run_id, None)
        if self.persist:
            (LOGS_DIR / f"{run_id}.jsonl").unlink(missing_ok=True)

    # --- dataset images -------------------------------------------------------

    def set_images(self, dataset_id: str, records: list[AnnotatedImage]) -> None:
        self.images[dataset_id] = records
        self._dirty_images.add(dataset_id)
        self._dropped_images.discard(dataset_id)

    def drop_images(self, dataset_id: str) -> None:
        self.images.pop(dataset_id, None)
        self._dirty_images.discard(dataset_id)
        self._dropped_images.add(dataset_id)

    def record_curation(self, dataset_id: str, image_id: str, state: str) -> None:
        """One accept/reject click: an appended line, not a dataset rewrite."""
        if not self.persist or dataset_id in self._dirty_images:
            return  # the pending full rewrite already carries it
        IMAGES_DIR.mkdir(parents=True, exist_ok=True)
        with open(IMAGES_DIR / f"{dataset_id}.curation.jsonl", "a",
                  encoding="utf-8") as f:
            f.write(json.dumps({"id": image_id, "state": state}) + "\n")

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
        # list() snapshots every collection BEFORE Python-level iteration:
        # save() is called from pipeline worker threads while API threads
        # insert runs/logs — iterating the live dicts raced ("dictionary
        # changed size during iteration", hit live 2026-07-11 when five
        # runs were created back-to-back and killed four of them). The
        # snapshot must also happen under the lock so concurrent saves
        # serialize.
        def dump(items):
            return [i.model_dump(by_alias=True) for i in list(items)]

        self.flush_logs()
        with self._save_lock:
            snapshot = {
                # 2 = images and logs live in their own files (see module doc).
                "storageVersion": 2,
                "organizations": dump(self.organizations),
                "members": dump(self.members),
                "projects": dump(self.projects),
                "runs": dump(self.runs.values()),
                "datasets": dump(self.datasets.values()),
                "models": dump(self.models.values()),
                "apiKeys": dump(self.api_keys.values()),
                "feedback": dump(self.feedback.values()),
                "gpuSecondsUsed": self.gpu_seconds_used,
            }
            dirty = list(self._dirty_images)
            self._dirty_images.clear()
            dropped = list(self._dropped_images)
            self._dropped_images.clear()
            image_snapshots = {did: dump(self.images.get(did, []))
                               for did in dirty if did in self.images}
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            if image_snapshots:
                IMAGES_DIR.mkdir(parents=True, exist_ok=True)
            for did, records in image_snapshots.items():
                path = IMAGES_DIR / f"{did}.json"
                tmp = path.with_suffix(".json.tmp")
                tmp.write_text(json.dumps(records, separators=(",", ":")),
                               encoding="utf-8")
                tmp.replace(path)
                # The full file now carries every curation click.
                (IMAGES_DIR / f"{did}.curation.jsonl").unlink(missing_ok=True)
            for did in dropped:
                (IMAGES_DIR / f"{did}.json").unlink(missing_ok=True)
                (IMAGES_DIR / f"{did}.curation.jsonl").unlink(missing_ok=True)
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
        self.datasets = {d.id: d for d in parse(Dataset, raw.get("datasets", []))}
        self.run_logs = {}
        self.images = {}
        legacy = "runLogs" in raw or "images" in raw
        # Migration from single-file state: logs move to data/logs/, images
        # to data/images/ (written by the save() at the end of load).
        for rid, logs in raw.get("runLogs", {}).items():
            path = LOGS_DIR / f"{rid}.jsonl"
            if not path.exists() and logs:
                LOGS_DIR.mkdir(parents=True, exist_ok=True)
                path.write_text("\n".join(json.dumps(e, separators=(",", ":"))
                                          for e in logs) + "\n", encoding="utf-8")
        for did, imgs in raw.get("images", {}).items():
            if not (IMAGES_DIR / f"{did}.json").exists():
                self.images[did] = parse(AnnotatedImage, imgs)
                self._dirty_images.add(did)
        for did in self.datasets:
            if did not in self.images:
                self.images[did] = self._load_images_file(did)
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
        if legacy:
            self.save()  # finish the migration: state.json loses the bulk
        return True

    def _load_images_file(self, dataset_id: str) -> list[AnnotatedImage]:
        path = IMAGES_DIR / f"{dataset_id}.json"
        if not path.exists():
            return []
        records = [AnnotatedImage.model_validate(r)
                   for r in json.loads(path.read_text(encoding="utf-8"))]
        curation = IMAGES_DIR / f"{dataset_id}.curation.jsonl"
        if curation.exists():
            by_id = {r.id: r for r in records}
            for line in curation.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    change = json.loads(line)
                    if change["id"] in by_id:
                        by_id[change["id"]].curation_state = change["state"]
        return records

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
