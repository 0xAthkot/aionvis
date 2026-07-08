"""Per-run context handed to every agent.

Runs on a worker thread; all bus publishing goes through the thread-safe
path. Log ids are stable and unique per run (contract consistency req. 3:
the UI dedupes REST history against the live stream by LogEvent.id).
"""

import threading
import time
from typing import Optional

from ..events import bus
from ..schemas import (
    AgentInstance,
    AgentKind,
    AgentState,
    LogEvent,
    LogLevel,
    PipelineRun,
    PipelineStage,
    StageTransition,
)
from ..store import now_iso, store


class RunCancelled(Exception):
    pass


AGENT_SPECS: dict[AgentKind, tuple[str, str, str]] = {
    # kind -> (displayName, model, provider) — provider is patched at runtime
    "prompt": ("Prompt Agent", "Gemma (vLLM)", "vLLM · MI300X"),
    "synthesis": ("Synthesis Agent", "SDXL-Turbo", "local GPU"),
    "vision": ("Vision Agent", "SAM / YOLOE open-vocab", "local GPU"),
    "critic": ("Critic Agent", "Gemma VLM + geometric checks", "vLLM · MI300X"),
    "mlops": ("MLOps Agent", "Ultralytics YOLOv10", "local GPU"),
}


class RunContext:
    def __init__(self, run: PipelineRun) -> None:
        self.run = run
        self.cancel_event = threading.Event()
        self._log_seq = 0
        # Streaming mode logs from three agent threads at once; ids must
        # stay unique (the UI dedupes the live stream by LogEvent.id).
        self._log_lock = threading.Lock()
        self._stage_entered_at = time.monotonic()
        self.agents: dict[AgentKind, AgentInstance] = {}
        kinds: list[AgentKind] = (
            ["prompt", "synthesis", "vision", "critic", "mlops"]
            if run.path == "synthetic"
            else ["vision", "critic", "mlops"]
        )
        for kind in kinds:
            name, model, provider = AGENT_SPECS[kind]
            self.agents[kind] = AgentInstance(
                id=f"{run.id}-{kind}",
                run_id=run.id,
                kind=kind,
                display_name=name,
                model=model,
                provider=provider,
                state="idle",
            )

    # --- cancellation -----------------------------------------------------------

    def check_cancelled(self) -> None:
        if self.cancel_event.is_set():
            raise RunCancelled()

    # --- logging ------------------------------------------------------------------

    def log(self, level: LogLevel, message: str, agent: Optional[AgentKind] = None) -> None:
        with self._log_lock:
            self._log_seq += 1
            seq = self._log_seq
        event = LogEvent(
            id=f"{self.run.id}-log-{seq:05d}",
            run_id=self.run.id,
            at=now_iso(),
            level=level,
            agent=agent,
            message=message,
        )
        store.run_logs.setdefault(self.run.id, []).append(event)
        bus.publish_run_threadsafe(
            self.run.id, "log", event.model_dump(by_alias=True)
        )

    # --- agents ---------------------------------------------------------------------

    def set_agent(self, kind: AgentKind, state: AgentState,
                  task: Optional[str] = None) -> None:
        agent = self.agents.get(kind)
        if agent is None:
            return
        agent.state = state
        agent.current_task = task
        if state in ("thinking", "working", "waiting_gpu") and agent.started_at is None:
            agent.started_at = now_iso()
        bus.publish_run_threadsafe(
            self.run.id, "agent", agent.model_dump(by_alias=True)
        )

    # --- stages ---------------------------------------------------------------------

    def set_stage(self, to: PipelineStage, note: Optional[str] = None) -> None:
        run = self.run
        elapsed_ms = int((time.monotonic() - self._stage_entered_at) * 1000)
        transition = StageTransition(
            run_id=run.id, **{"from": run.stage}, to=to, at=now_iso(),
            duration_ms=elapsed_ms if run.stage != "queued" else None, note=note,
        )
        if run.stage not in ("queued", "complete"):
            store.gpu_seconds_used += elapsed_ms / 1000
        run.stage = to
        self._stage_entered_at = time.monotonic()
        self.log("stage", f"── Stage: {to.replace('_', ' ').upper()}"
                 + (f" — {note}" if note else ""))
        bus.publish_run_threadsafe(
            run.id, "stage", transition.model_dump(by_alias=True)
        )

    # --- progress --------------------------------------------------------------------

    def publish_progress(self) -> None:
        bus.publish_run_threadsafe(
            self.run.id, "progress", self.run.progress.model_dump(by_alias=True)
        )

    def publish_status(self) -> None:
        bus.publish_run_threadsafe(
            self.run.id, "status",
            {"runId": self.run.id, "status": self.run.status},
        )
