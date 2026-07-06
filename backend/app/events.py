"""Event bus between the pipeline orchestrator and WebSocket subscribers.

Wire format matches `src/lib/api/streams.ts`:
  run events:  { kind: "log"|"stage"|"agent"|"progress"|"status", payload }
  telemetry:   { kind: "telemetry", payload: TelemetrySample }

Publishers run on the event loop; heavy agent work happens in threads and
publishes via `loop.call_soon_threadsafe`, so subscriber queues are only
ever touched from the loop thread.
"""

import asyncio
from collections import defaultdict, deque
from typing import Any, Optional

from .schemas import TelemetrySample

QUEUE_LIMIT = 512


class Bus:
    def __init__(self) -> None:
        self._run_subs: dict[str, set[asyncio.Queue]] = defaultdict(set)
        self._telemetry_subs: set[asyncio.Queue] = set()
        self.telemetry_history: deque[TelemetrySample] = deque(maxlen=120)
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    # --- subscriptions -------------------------------------------------------

    def subscribe_run(self, run_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_LIMIT)
        self._run_subs[run_id].add(q)
        return q

    def unsubscribe_run(self, run_id: str, q: asyncio.Queue) -> None:
        self._run_subs[run_id].discard(q)
        if not self._run_subs[run_id]:
            del self._run_subs[run_id]

    def subscribe_telemetry(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_LIMIT)
        self._telemetry_subs.add(q)
        return q

    def unsubscribe_telemetry(self, q: asyncio.Queue) -> None:
        self._telemetry_subs.discard(q)

    # --- publishing (loop thread only) ----------------------------------------

    def publish_run(self, run_id: str, kind: str, payload: Any) -> None:
        message = {"kind": kind, "payload": payload}
        for q in list(self._run_subs.get(run_id, ())):
            self._offer(q, message)

    def publish_telemetry(self, sample: TelemetrySample) -> None:
        self.telemetry_history.append(sample)
        message = {"kind": "telemetry", "payload": sample.model_dump(by_alias=True)}
        for q in list(self._telemetry_subs):
            self._offer(q, message)

    @staticmethod
    def _offer(q: asyncio.Queue, message: Any) -> None:
        # Drop-oldest on a slow consumer rather than stalling the pipeline.
        if q.full():
            try:
                q.get_nowait()
            except asyncio.QueueEmpty:
                pass
        q.put_nowait(message)

    # --- thread-safe publishing for agent worker threads -----------------------

    def publish_run_threadsafe(self, run_id: str, kind: str, payload: Any) -> None:
        if self.loop is None:
            return
        self.loop.call_soon_threadsafe(self.publish_run, run_id, kind, payload)


bus = Bus()
