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

    # --- Prompt Agent (Fireworks AI) ---
    fireworks_api_key: str = ""
    fireworks_base_url: str = "https://api.fireworks.ai/inference/v1"
    fireworks_model: str = "accounts/fireworks/models/gemma-3-27b-it"

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

    # --- MLOps Agent ---
    # Caps applied on this dev box so a demo run stays minutes, not hours.
    # YOLO confidence stays near zero below ~40 epochs on tiny datasets, so
    # the epoch cap must leave room for a showcase model that actually detects.
    max_images_per_run: int = 48
    max_epochs: int = 80

    # --- pricing model for /runs/estimate (USD per GPU-minute) ---
    gpu_usd_per_min: float = 0.033


settings = Settings()
