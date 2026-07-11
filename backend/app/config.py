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
    # API key protecting /api/v1 (Authorization: Bearer or X-API-Key) and
    # /ws/v1 (?token=). Empty = open, for same-machine dev. REQUIRED before
    # exposing a GPU node publicly — deploy_mi300x.sh mints one and the UI's
    # Hardware page takes it in the "Connect AMD Developer Cloud" form.
    # /files stays public: <img> tags and weight downloads can't send headers.
    aa_api_key: str = ""

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
    # FLUX runs need this much VRAM; below it (or on CPU) a "flux" run is
    # REJECTED at creation (before downloading the 24 GB checkpoint) — the
    # generator is the user's choice and is never silently swapped.
    flux_min_vram_gb: float = 24.0

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
    # Training batch/image-size ceilings. Defaults sized for an 8 GB card;
    # on the MI300X set MAX_BATCH_SIZE=96 and MAX_TRAIN_IMAGE_SIZE=1024 —
    # the 8-batch default would leave the 192 GB card >90% idle.
    max_batch_size: int = 8
    max_train_image_size: int = 640

    # --- GPU residency ---
    # False (8 GB card): pipelines load per stage and VRAM is flushed
    # between stages. True (MI300X): stage models stay resident and cached
    # across runs — no flushes, no reload cost.
    keep_models_warm: bool = False

    # --- pipeline execution mode ---
    # "sequential": agents take turns owning the GPU (default, any card).
    # "streaming": synthesis → vision → critic overlap as producer/consumer
    # streams — only valid when the whole swarm is resident, so it requires
    # keep_models_warm (deploy_mi300x.sh sets both).
    pipeline_mode: str = "sequential"
    # Concurrent pipeline runs sharing the card. 1 on small GPUs; the MI300X
    # profile sets 2 (192 GB holds two runs' working sets comfortably).
    gpu_slots: int = 1
    # Fractional ultralytics batch sizing: instead of an int batch, pass the
    # share of free VRAM training may claim — ultralytics measures at train
    # start (after the warm swarm took its share) and sizes the batch to fit.
    auto_batch: bool = False

    # --- pricing model for /runs/estimate (USD per GPU-minute) ---
    # Derived from the AMD Developer Cloud MI300X droplet at $2/hour.
    gpu_usd_per_min: float = 2 / 60

    def model_post_init(self, __context) -> None:
        # Config problems degrade, never crash the server.
        if self.pipeline_mode not in ("sequential", "streaming"):
            print(f"[config] Unknown PIPELINE_MODE '{self.pipeline_mode}' — "
                  "falling back to sequential")
            self.pipeline_mode = "sequential"
        if self.pipeline_mode == "streaming" and not self.keep_models_warm:
            print("[config] PIPELINE_MODE=streaming requires KEEP_MODELS_WARM=true "
                  "(the overlap only pays off with the swarm resident) — "
                  "falling back to sequential")
            self.pipeline_mode = "sequential"
        if self.gpu_slots < 1:
            print(f"[config] GPU_SLOTS={self.gpu_slots} is invalid — using 1")
            self.gpu_slots = 1


settings = Settings()
