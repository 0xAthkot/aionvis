"""WebSocket endpoints (`wsEndpoints` in the frontend contract) + sampler."""

import asyncio
import contextlib
import hmac

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from . import telemetry
from .config import settings
from .events import bus

ws_router = APIRouter(prefix="/ws/v1")


async def _authorized(ws: WebSocket) -> bool:
    """Browsers can't set WebSocket headers, so AA_API_KEY rides in
    `?token=`. Empty key = open (same-machine dev). Policy violation close
    (1008) so the client sees an auth failure, not a network blip."""
    if not settings.aa_api_key:
        return True
    if hmac.compare_digest(ws.query_params.get("token", ""), settings.aa_api_key):
        return True
    await ws.close(code=1008, reason="invalid or missing API key")
    return False


async def _pump(ws: WebSocket, queue: asyncio.Queue) -> None:
    """Forward bus messages to the socket until the client goes away."""
    receive = asyncio.create_task(ws.receive_text())  # detect disconnects
    try:
        while True:
            send = asyncio.create_task(queue.get())
            done, _ = await asyncio.wait(
                {send, receive}, return_when=asyncio.FIRST_COMPLETED
            )
            if receive in done:
                send.cancel()
                break
            await ws.send_json(send.result())
    finally:
        receive.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await receive


@ws_router.websocket("/runs/{run_id}/events")
async def run_events(ws: WebSocket, run_id: str) -> None:
    if not await _authorized(ws):
        return
    await ws.accept()
    queue = bus.subscribe_run(run_id)
    try:
        await _pump(ws, queue)
    except WebSocketDisconnect:
        pass
    finally:
        bus.unsubscribe_run(run_id, queue)


@ws_router.websocket("/hardware/{node_id}/telemetry")
async def node_telemetry(ws: WebSocket, node_id: str) -> None:
    if not await _authorized(ws):
        return
    await ws.accept()
    queue = bus.subscribe_telemetry()
    try:
        await _pump(ws, queue)
    except WebSocketDisconnect:
        pass
    finally:
        bus.unsubscribe_telemetry(queue)


async def telemetry_sampler() -> None:
    """1 Hz GPU sampling — nvml/amd-smi calls run off-loop to keep it smooth."""
    loop = asyncio.get_running_loop()
    while True:
        sample = await loop.run_in_executor(None, telemetry.sample)
        bus.publish_telemetry(sample)
        await asyncio.sleep(1.0)
