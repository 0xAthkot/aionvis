"""Dataset compilation: reviewed images → YOLO dataset on disk + API records.

Produces
  data/files/datasets/{id}/images/…  + thumbs/…   (served at /files/…)
  {workdir}/yolo/{images,labels}/{train,val}/ + data.yaml (for training)
"""

import random
import shutil
from pathlib import Path

import yaml
from PIL import Image

from ..config import DATA_DIR, settings
from ..orchestrator.context import RunContext
from ..schemas import AnnotatedImage, Dataset, DatasetClass
from ..store import now_iso, store
from .critic_agent import ReviewedImage

# Same validated 8-hue palette the frontend uses for class chips/charts.
CLASS_COLORS = ["#d97706", "#0284c7", "#65a30d", "#c026d3",
                "#e11d48", "#059669", "#a16207", "#6366f1"]

THUMB_SIZE = 320


def compile_dataset(ctx: RunContext, reviewed: list[ReviewedImage],
                    workdir: Path) -> Dataset:
    run = ctx.run
    usable = [r for r in reviewed if r.accepted]
    if not usable:
        raise RuntimeError("Critic rejected every image — nothing to train on. "
                           "Try a more concrete prompt or lower critic thresholds.")

    # --- reuse the uploaded dataset record for BYOD, mint a new one otherwise
    if run.path == "byod" and run.source.dataset_id in store.datasets:
        dataset = store.datasets[run.source.dataset_id]
    else:
        dataset = Dataset(
            id=store.next_id("ds"), org_id=run.org_id, project_id=run.project_id,
            name=f"{run.name} · dataset", origin=run.path, status="labeling",
            image_count=0, labeled_count=0, classes=[], size_mb=0,
            created_at=now_iso(), run_id=run.id,
        )
        store.datasets[dataset.id] = dataset
    run.dataset_id = dataset.id
    dataset.run_id = run.id

    files_dir = DATA_DIR / "files" / "datasets" / dataset.id
    img_dir, thumb_dir = files_dir / "images", files_dir / "thumbs"
    yolo_dir = workdir / "yolo"
    for d in (img_dir, thumb_dir):
        d.mkdir(parents=True, exist_ok=True)
    for split in ("train", "val"):
        (yolo_dir / "images" / split).mkdir(parents=True, exist_ok=True)
        (yolo_dir / "labels" / split).mkdir(parents=True, exist_ok=True)

    # --- deterministic split: ~85/15 with at least one val image
    order = list(range(len(usable)))
    random.Random(42).shuffle(order)
    n_val = max(1, round(len(usable) * 0.15))
    val_idx = set(order[:n_val])

    records: list[AnnotatedImage] = []
    instance_counts: dict[int, int] = {}
    total_bytes = 0
    base_url = f"{settings.public_base_url}/files/datasets/{dataset.id}"

    for i, item in enumerate(reviewed):
        ctx.check_cancelled()
        file_name = item.path.name
        shutil.copy2(item.path, img_dir / file_name)
        total_bytes += item.path.stat().st_size
        with Image.open(item.path) as im:
            im.thumbnail((THUMB_SIZE, THUMB_SIZE))
            im.convert("RGB").save(thumb_dir / file_name, quality=80)

        if item.accepted:
            usable_pos = usable.index(item)
            split = "val" if usable_pos in val_idx else "train"
            shutil.copy2(item.path, yolo_dir / "images" / split / file_name)
            label_lines = []
            for b in item.boxes:
                label_lines.append(f"{b.class_id} {b.cx} {b.cy} {b.w} {b.h}")
                instance_counts[b.class_id] = instance_counts.get(b.class_id, 0) + 1
            (yolo_dir / "labels" / split / f"{item.path.stem}.txt").write_text(
                "\n".join(label_lines), encoding="utf-8"
            )
        else:
            split = "train"

        records.append(AnnotatedImage(
            id=f"{dataset.id}-img-{i:04d}", dataset_id=dataset.id,
            file_name=file_name, width=item.width, height=item.height,
            url=f"{base_url}/images/{file_name}",
            thumbnail_url=f"{base_url}/thumbs/{file_name}",
            boxes=item.boxes, split=split,
            curation_state="accepted" if item.accepted else "rejected",
            critique=item.critique,
        ))

    names = [c.replace("_", " ") for c in run.target_classes]
    (yolo_dir / "data.yaml").write_text(yaml.safe_dump({
        "path": str(yolo_dir).replace("\\", "/"),
        "train": "images/train", "val": "images/val",
        "names": {i: n for i, n in enumerate(names)},
    }), encoding="utf-8")

    dataset.classes = [
        DatasetClass(id=i, name=cls, color=CLASS_COLORS[i % len(CLASS_COLORS)],
                     instance_count=instance_counts.get(i, 0))
        for i, cls in enumerate(run.target_classes)
    ]
    dataset.image_count = len(records)
    dataset.labeled_count = len(usable)
    dataset.size_mb = round(total_bytes / 1024**2, 1)
    dataset.status = "ready"
    store.images[dataset.id] = records
    store.save()

    ctx.log("info",
            f"Dataset {dataset.id} compiled — {len(usable)} labeled images "
            f"({len(usable) - n_val} train / {n_val} val), "
            f"{sum(instance_counts.values())} instances, {dataset.size_mb} MB",
            agent="mlops")
    return dataset


