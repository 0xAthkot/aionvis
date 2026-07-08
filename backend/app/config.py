from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    # --- server ---
    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    # Public base URL of this backend; image/file URLs are minted against it.
    public_base_url: str = "http://localhost:8000"

    # --- Prompt Agent (any OpenAI-compatible chat endpoint) ---
    # Default: Gemma via vLLM on the same box (the MI300X profile:
    # `vllm serve google/gemma-3-27b-it --port 8001`). The key is optional —
    # vLLM ignores it. If the endpoint is unreachable the Prompt Agent
    # degrades to its deterministic template expander.
    llm_api_key: str = ""
    llm_base_url: str = "http://localhost:8001/v1"
    llm_model: str = "google/gemma-3-27b-it"
    # Shown as the agent's provider in the UI; defaults by base_url.
    llm_provider_label: str = ""

    # --- Synthesis Agent ---
    # sdxl -> stabilityai/sdxl-turbo (fits 8 GB); flux -> FLUX.1-schnell (MI300X)
    sdxl_model: str = "stabilityai/sdxl-turbo"
    flux_model: str = "black-forest-labs/FLUX.1-schnell"
    synthesis_image_size: int = 640

    # --- Vision Agent ---
    # "sam3" needs the gated facebook/sam3 checkpoint + transformers support;
    # "yoloe" is the open-vocabulary fallback that fits an 8 GB card.
    vision_backend: str = "yoloe"
    sam3_model: str = "facebook/sam3"
    yoloe_model: str = "yoloe-11s-seg.pt"
    # Candidate floor. Detections between this and critic_min_confidence
    # surface as Critic REJECT verdicts (the self-correction the demo shows).
    vision_min_confidence: float = 0.10

    # --- Critic Agent ---
    critic_min_box_area: float = 0.0004  # normalized area
    critic_min_confidence: float = 0.30
    critic_iou_accept: float = 0.55
    # Second stage: a VLM spot-checks accepted crops semantically via the
    # same OpenAI-compatible endpoint. Cost-capped per run. Empty model =
    # reuse llm_model (Gemma 3 is vision-capable, so one server does both);
    # set it only to route the critic to a different vision model.
    semantic_critic: bool = True
    semantic_critic_model: str = ""
    semantic_critic_max_checks: int = 8

    # --- Pose task ---
    # COCO-pretrained teacher that keypoint-labels person-like instances at
    # dataset-compile time (task="pose"); boxes it can't match get v=0 kpts.
    pose_teacher_model: str = "yolo11m-pose.pt"
    pose_teacher_conf: float = 0.30
    pose_match_iou: float = 0.40

    # --- BYOD ingestion ---
    # Videos in an upload are sampled to at most this many evenly-spaced
    # frames each (keeps a 10-minute clip from flooding a run).
    video_max_frames: int = 32

    # --- MLOps Agent ---
    # Caps applied on this dev box so a demo run stays minutes, not hours.
    # YOLO confidence stays near zero below ~40 epochs on tiny datasets, so
    # the epoch cap must leave room for a showcase model that actually detects.
    max_images_per_run: int = 48
    max_epochs: int = 80

    # --- pricing model for /runs/estimate (USD per GPU-minute) ---
    gpu_usd_per_min: float = 0.033


settings = Settings()
