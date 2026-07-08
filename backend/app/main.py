import asyncio
import contextlib
import hmac
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import telemetry
from .config import DATA_DIR, settings
from .events import bus
from .routers import router
from .store import store
from .ws import telemetry_sampler, ws_router

FILES_DIR = DATA_DIR / "files"


@asynccontextmanager
async def lifespan(app: FastAPI):
    bus.loop = asyncio.get_running_loop()
    if not store.load():
        store.seed()
        store.save()
    sampler = asyncio.create_task(telemetry_sampler())
    print(
        f"[auto-annotator] accelerator: {telemetry.GPU.name} "
        f"({telemetry.GPU.stack_version}, {telemetry.GPU.vram_total_gb:.1f} GB)"
    )
    yield
    sampler.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await sampler


app = FastAPI(title="Auto-Annotator Backend", version="1.0.0", lifespan=lifespan)


def request_key(request: Request) -> str:
    """The API key a REST request presented (Bearer or X-API-Key)."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.headers.get("x-api-key", "")


@app.middleware("http")
async def api_key_guard(request: Request, call_next):
    """AA_API_KEY protects every /api/v1 route (the UI's remote-attach flow
    sends it). Empty key = open, for same-machine dev. /files stays public —
    <img> tags and weight downloads can't send headers. Registered before
    CORSMiddleware so CORS wraps it: preflights never hit this, and 401s
    still carry CORS headers."""
    if settings.aa_api_key and request.url.path.startswith("/api/"):
        if not hmac.compare_digest(request_key(request), settings.aa_api_key):
            return JSONResponse(
                status_code=401,
                content={
                    "status": 401,
                    "code": "unauthorized",
                    "message": "Missing or invalid API key — send it as "
                               "'Authorization: Bearer <key>' or 'X-API-Key'.",
                },
            )
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
    """Match the contract's ApiErrorBody: { status, code, message }."""
    codes = {400: "bad_request", 404: "not_found", 409: "conflict", 422: "invalid"}
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "status": exc.status_code,
            "code": codes.get(exc.status_code, "error"),
            "message": str(exc.detail),
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"status": 422, "code": "invalid", "message": str(exc.errors()[:3])},
    )


@app.get("/health")
def health() -> dict:
    return {"ok": True, "gpu": telemetry.GPU.name}


FILES_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=FILES_DIR), name="files")

app.include_router(router)
app.include_router(ws_router)
