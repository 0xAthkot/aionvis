"""Bridge to the isolated SAM 3 runtime (.venv-sam3 + sam3_worker.py).

SAM 3 exists only in transformers>=5 while the SDXL synthesis stack pins <5,
so it runs in its own venv (the RF-DETR pattern) as a LONG-LIVED worker
process: model load dominates, annotation is per-image, and streaming mode
calls annotate as synthesis hands images over.

No fallback by doctrine: if the user's run selects sam3 and the runtime is
missing or the gated checkpoint is inaccessible, the run is rejected or
fails with the reason — never silently substituted with YOLOE.
"""

import json
import os
import subprocess
import threading
import time
from pathlib import Path

from ..config import DATA_DIR, settings

BACKEND_DIR = DATA_DIR.parent
WORKER = BACKEND_DIR / "sam3_worker.py"

SETUP_HINT = (
    "SAM 3 runtime not installed on this node. From backend/: "
    "python3 -m venv .venv-sam3 && .venv-sam3/bin/pip install torch "
    "torchvision --index-url https://download.pytorch.org/whl/rocm6.4 && "
    ".venv-sam3/bin/pip install 'transformers>=5.5' accelerate pillow "
    "numpy scipy  (Windows: .venv-sam3\\Scripts\\pip, cu126 index). "
    "facebook/sam3 is also MANUALLY GATED on Hugging Face — request access "
    "and log the node in first. Pick YOLOE to run on this node as-is."
)

# First call may download ~4 GB of gated weights before READY.
_LOAD_TIMEOUT_S = 900


def worker_python() -> Path:
    posix = BACKEND_DIR / ".venv-sam3" / "bin" / "python"
    win = BACKEND_DIR / ".venv-sam3" / "Scripts" / "python.exe"
    return posix if posix.exists() else win


def available() -> bool:
    return worker_python().exists() and WORKER.exists()


class Sam3Session:
    """One running worker process; thread-safe annotate()."""

    def __init__(self, on_log=None) -> None:
        if not available():
            raise RuntimeError(SETUP_HINT)
        env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
        self.proc = subprocess.Popen(
            [str(worker_python()), str(WORKER),
             "--model", settings.sam3_model,
             "--threshold", str(settings.vision_min_confidence)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, encoding="utf-8",
            errors="replace", cwd=str(BACKEND_DIR), env=env,
        )
        self._lock = threading.Lock()
        self.device = self._wait_ready(on_log)

    def _readline(self, deadline: float) -> str:
        line = self.proc.stdout.readline()  # type: ignore[union-attr]
        if not line:
            code = self.proc.poll()
            raise RuntimeError(
                f"SAM 3 worker exited (code {code}) before responding")
        if time.monotonic() > deadline:
            self.close()
            raise RuntimeError("SAM 3 worker timed out")
        return line.strip()

    def _wait_ready(self, on_log) -> str:
        deadline = time.monotonic() + _LOAD_TIMEOUT_S
        while True:
            line = self._readline(deadline)
            if line.startswith("READY "):
                return json.loads(line[6:])["device"]
            if line.startswith("ERROR "):
                self.close()
                raise RuntimeError(f"SAM 3 failed to load: {line[6:]}")
            if line.startswith("INFO ") and on_log is not None:
                on_log(line[5:])

    def annotate(self, path: Path, prompts: list[str]) -> dict:
        with self._lock:
            if self.proc.poll() is not None:
                raise RuntimeError("SAM 3 worker died mid-run")
            req = json.dumps({"path": str(path), "prompts": prompts})
            self.proc.stdin.write(req + "\n")  # type: ignore[union-attr]
            self.proc.stdin.flush()  # type: ignore[union-attr]
            deadline = time.monotonic() + 300
            while True:
                line = self._readline(deadline)
                if line.startswith("RESULT "):
                    return json.loads(line[7:])
                if line.startswith("ERROR "):
                    raise RuntimeError(f"SAM 3 annotation failed: {line[6:]}")

    def alive(self) -> bool:
        return self.proc.poll() is None

    def close(self) -> None:
        try:
            if self.proc.poll() is None:
                try:
                    self.proc.stdin.write('{"cmd": "exit"}\n')  # type: ignore[union-attr]
                    self.proc.stdin.flush()  # type: ignore[union-attr]
                    self.proc.wait(timeout=10)
                except Exception:
                    self.proc.kill()
        except Exception:
            pass


# KEEP_MODELS_WARM=true: the worker (and its loaded model) survives runs.
_warm_session: Sam3Session | None = None


def get_session(on_log=None) -> Sam3Session:
    global _warm_session
    if settings.keep_models_warm and _warm_session is not None \
            and _warm_session.alive():
        return _warm_session
    session = Sam3Session(on_log=on_log)
    if settings.keep_models_warm:
        _warm_session = session
    return session


def release_session(session: Sam3Session) -> None:
    if not settings.keep_models_warm:
        session.close()
