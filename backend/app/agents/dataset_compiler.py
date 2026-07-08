"""Dataset compilation: reviewed images → YOLO dataset on disk + API records.

Produces
  data/files/datasets/{id}/images/…  + thumbs/…   (served at /files/…)
  {workdir}/yolo/{images,labels}/{train,val}/ + data.yaml (for training)

Label format follows run.training.task:
  detect   — cls cx cy w h
  segment  — cls x1 y1 x2 y2 …            (Critic-verified mask polygon)
  obb      — cls 4 corner pairs           (min-area rect around the polygon)
  pose     — detect line + 17 COCO kpts   (pretrained teacher, see config)
  classify — detect labels as usual PLUS {workdir}/cls/{split}/{class}/ crops
             cut from the verified boxes (imagefolder layout for YOLO-cls)
"""

import random
import shutil
from pathlib import Path

import yaml
from PIL import Image

from ..config import DATA_DIR, settings
from ..orchestrator.context import RunContext
from ..schemas import AnnotatedImage, BoundingBox, Dataset, DatasetClass
from ..store import now_iso, store
from .critic_agent import ReviewedImage

# Same validated 8-hue palette the frontend uses for class chips/charts.
CLASS_COLORS = ["#d97706", "#0284c7", "#65a30d", "#c026d3",
                "#e11d48", "#059669", "#a16207", "#6366f1"]

THUMB_SIZE = 320


def _copy_shared(src: Path, dst: Path) -> None:
    """Copy an image whose source other runs may hold open concurrently.

    shutil.copy2 delegates to CopyFile2 on Windows, which conflicts with a
    sibling run's handle on the same source when GPU_SLOTS > 1 and two runs
    compile from one dataset (WinError 32); plain buffered streams share fine.
    """
    with open(src, "rb") as f_in, open(dst, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)


def _box_corners(b: BoundingBox) -> list[float]:
    x1, y1 = b.cx - b.w / 2, b.cy - b.h / 2
    x2, y2 = b.cx + b.w / 2, b.cy + b.h / 2
    return [x1, y1, x2, y1, x2, y2, x1, y2]


def _seg_line(b: BoundingBox) -> str:
    poly = b.polygon if b.polygon and len(b.polygon) >= 6 else _box_corners(b)
    return f"{b.class_id} " + " ".join(f"{v:.4f}" for v in poly)


def _obb_line(b: BoundingBox, width: int, height: int) -> str:
    import cv2
    import numpy as np

    if b.polygon and len(b.polygon) >= 6:
        pts = np.array(b.polygon, dtype=np.float32).reshape(-1, 2)
        pts[:, 0] *= width
        pts[:, 1] *= height
        corners = cv2.boxPoints(cv2.minAreaRect(pts))
        flat = []
        for x, y in corners:
            flat.append(min(max(float(x) / width, 0.0), 1.0))
            flat.append(min(max(float(y) / height, 0.0), 1.0))
    else:
        flat = _box_corners(b)
    return f"{b.class_id} " + " ".join(f"{v:.4f}" for v in flat)


# COCO-17 horizontal-flip pairing, required for flip augmentation on pose.
COCO_FLIP_IDX = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15]


def _pose_keypoints(ctx: RunContext, items: list[ReviewedImage]) -> dict[Path, list]:
    """Teacher pass: per image, [(person box xyxyn, (17,3) normalized kpts)]."""
    from ultralytics import YOLO

    from .gpu import device_str

    ctx.log("info", f"Pose teacher {settings.pose_teacher_model} keypointing "
                    f"{len(items)} images", agent="mlops")
    teacher = YOLO(settings.pose_teacher_model)
    out: dict[Path, list] = {}
    for item in items:
        res = teacher.predict(source=str(item.path), device=device_str(),
                              conf=settings.pose_teacher_conf, verbose=False)[0]
        pairs = []
        if res.keypoints is not None and res.boxes is not None:
            xyn = res.keypoints.xyn.cpu().numpy()          # (n, 17, 2)
            conf = (res.keypoints.conf.cpu().numpy()
                    if res.keypoints.conf is not None else None)
            for j, box in enumerate(res.boxes):
                kpts = []
                for k in range(xyn.shape[1]):
                    v = 2 if conf is None or conf[j][k] > 0.5 else 0
                    kpts.append((float(xyn[j][k][0]), float(xyn[j][k][1]), v))
                pairs.append((box.xyxyn[0].tolist(), kpts))
        out[item.path] = pairs
    del teacher
    return out


def _iou_xyxyn(a, b) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(ix2 - ix1, 0) * max(iy2 - iy1, 0)
    union = ((a[2] - a[0]) * (a[3] - a[1])
             + (b[2] - b[0]) * (b[3] - b[1]) - inter)
    return inter / union if union > 0 else 0.0


def _pose_line(b: BoundingBox, teacher_pairs: list) -> tuple[str, bool]:
    """Detect line + best-matching teacher keypoints (v=0 when unmatched)."""
    box_xyxyn = (b.cx - b.w / 2, b.cy - b.h / 2, b.cx + b.w / 2, b.cy + b.h / 2)
    best, best_iou = None, settings.pose_match_iou
    for person_box, kpts in teacher_pairs:
        iou = _iou_xyxyn(box_xyxyn, person_box)
        if iou >= best_iou:
            best, best_iou = kpts, iou
    kpts = best or [(0.0, 0.0, 0)] * 17
    flat = " ".join(f"{x:.4f} {y:.4f} {v}" for x, y, v in kpts)
    return f"{b.class_id} {b.cx} {b.cy} {b.w} {b.h} {flat}", best is not None


def _write_rfdetr_coco(pairs: list[tuple[ReviewedImage, str]], workdir: Path,
                       names: list[str]) -> None:
    """Roboflow-COCO layout for the RF-DETR worker: {train,valid}/ dirs each
    holding images + _annotations.coco.json (category ids are 1-based)."""
    import json

    root = workdir / "rfdetr"
    categories = [{"id": i + 1, "name": n, "supercategory": "object"}
                  for i, n in enumerate(names)]
    by_split = {"train": [], "valid": []}
    for item, split in pairs:
        by_split["valid" if split == "val" else "train"].append(item)
    if not by_split["valid"]:  # single-split dataset validates on train
        by_split["valid"] = by_split["train"]

    for split, items in by_split.items():
        split_dir = root / split
        split_dir.mkdir(parents=True, exist_ok=True)
        coco = {"images": [], "annotations": [], "categories": categories}
        ann_id = 1
        for idx, item in enumerate(items):
            _copy_shared(item.path, split_dir / item.path.name)
            coco["images"].append({
                "id": idx, "file_name": item.path.name,
                "width": item.width, "height": item.height,
            })
            for b in item.boxes:
                w, h = b.w * item.width, b.h * item.height
                x = b.cx * item.width - w / 2
                y = b.cy * item.height - h / 2
                coco["annotations"].append({
                    "id": ann_id, "image_id": idx,
                    "category_id": b.class_id + 1,
                    "bbox": [round(x, 2), round(y, 2), round(w, 2), round(h, 2)],
                    "area": round(w * h, 2), "iscrowd": 0,
                })
                ann_id += 1
        (split_dir / "_annotations.coco.json").write_text(
            json.dumps(coco), encoding="utf-8")


MIN_CROP_PX = 16  # skip classification crops smaller than this on either side


def _write_cls_crops(ctx: RunContext, pairs: list[tuple[ReviewedImage, str]],
                     workdir: Path, class_names: list[str]) -> None:
    """Per-class crop folders from the verified boxes — the imagefolder
    layout `YOLO(...-cls.pt).train(data=...)` expects. Class indices in the
    trained model follow the SORTED folder names; mlops reads them back."""
    root = workdir / "cls"
    counts: dict[str, int] = {}
    for item, split in pairs:
        with Image.open(item.path) as im:
            im = im.convert("RGB")
            for i, b in enumerate(item.boxes):
                if b.class_id >= len(class_names):
                    continue
                # Denormalize with 8% context padding, clamped to the frame.
                bw, bh = b.w * item.width, b.h * item.height
                x1 = max((b.cx * item.width) - bw / 2 - bw * 0.08, 0)
                y1 = max((b.cy * item.height) - bh / 2 - bh * 0.08, 0)
                x2 = min((b.cx * item.width) + bw / 2 + bw * 0.08, item.width)
                y2 = min((b.cy * item.height) + bh / 2 + bh * 0.08, item.height)
                if x2 - x1 < MIN_CROP_PX or y2 - y1 < MIN_CROP_PX:
                    continue
                name = class_names[b.class_id]
                out_dir = root / split / name
                out_dir.mkdir(parents=True, exist_ok=True)
                crop = im.crop((int(x1), int(y1), int(x2), int(y2)))
                crop.save(out_dir / f"{item.path.stem}_{i}.jpg", quality=90)
                counts[name] = counts.get(name, 0) + 1

    if not counts:
        raise RuntimeError(
            "Classify task: no verified box was large enough to crop "
            f"(≥{MIN_CROP_PX}px). Use detect for this scene, or generate "
            "closer-up imagery."
        )
    # Degenerate case: every usable crop came from val images.
    if not (root / "train").exists():
        shutil.copytree(root / "val", root / "train")
    # Val must exist and mirror train's class folders, or the classifier
    # can't validate — reuse train crops for any class with no val crop.
    for train_cls in (root / "train").iterdir():
        val_cls = root / "val" / train_cls.name
        if not val_cls.exists() or not any(val_cls.iterdir()):
            val_cls.mkdir(parents=True, exist_ok=True)
            for f in list(train_cls.iterdir())[:4]:
                shutil.copy2(f, val_cls / f.name)
    ctx.log("info",
            "Classification crops cut from verified boxes — "
            + ", ".join(f"{n}: {c}" for n, c in sorted(counts.items())),
            agent="mlops")


def compile_dataset(ctx: RunContext, reviewed: list[ReviewedImage],
                    workdir: Path) -> Dataset:
    run = ctx.run
    usable = [r for r in reviewed if r.accepted]
    if not usable:
        raise RuntimeError("Critic rejected every image — nothing to train on. "
                           "Try a more concrete prompt or lower critic thresholds.")
    task = run.training.task

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

    # --- deterministic split: ~85/15 with at least one val image, and never
    # an empty train set (a single-image dataset trains and validates on it).
    order = list(range(len(usable)))
    random.Random(42).shuffle(order)
    n_val = max(1, round(len(usable) * 0.15))
    if n_val >= len(usable):
        n_val = 0  # too few images to hold any out; val reuses train below
    val_idx = set(order[:n_val])

    records: list[AnnotatedImage] = []
    instance_counts: dict[int, int] = {}
    total_bytes = 0
    base_url = f"{settings.public_base_url}/files/datasets/{dataset.id}"

    pose_lookup = _pose_keypoints(ctx, usable) if task == "pose" else {}
    pose_matched = 0
    split_pairs: list[tuple[ReviewedImage, str]] = []

    for i, item in enumerate(reviewed):
        ctx.check_cancelled()
        file_name = item.path.name
        _copy_shared(item.path, img_dir / file_name)
        total_bytes += item.path.stat().st_size
        with Image.open(item.path) as im:
            im.thumbnail((THUMB_SIZE, THUMB_SIZE))
            im.convert("RGB").save(thumb_dir / file_name, quality=80)

        if item.accepted:
            usable_pos = usable.index(item)
            split = "val" if usable_pos in val_idx else "train"
            split_pairs.append((item, split))
            _copy_shared(item.path, yolo_dir / "images" / split / file_name)
            label_lines = []
            for b in item.boxes:
                if task == "segment":
                    label_lines.append(_seg_line(b))
                elif task == "obb":
                    label_lines.append(_obb_line(b, item.width, item.height))
                elif task == "pose":
                    line, matched = _pose_line(b, pose_lookup.get(item.path, []))
                    label_lines.append(line)
                    pose_matched += matched
                else:
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

    if run.training.architecture.startswith("rf-detr"):
        _write_rfdetr_coco(split_pairs, workdir,
                           [c.replace("_", " ") for c in run.target_classes])

    if task == "classify":
        _write_cls_crops(ctx, split_pairs, workdir, run.target_classes)

    if task == "pose" and pose_matched == 0:
        raise RuntimeError(
            "Pose task: the keypoint teacher matched no instances — pose needs "
            "person-like target classes (worker, pedestrian, …). Use detect or "
            "segment for this scene instead."
        )

    names = [c.replace("_", " ") for c in run.target_classes]
    data_yaml: dict = {
        "path": str(yolo_dir).replace("\\", "/"),
        "train": "images/train",
        "val": "images/val" if n_val else "images/train",
        "names": {i: n for i, n in enumerate(names)},
    }
    if task == "pose":
        data_yaml["kpt_shape"] = [17, 3]
        data_yaml["flip_idx"] = COCO_FLIP_IDX
    (yolo_dir / "data.yaml").write_text(yaml.safe_dump(data_yaml),
                                        encoding="utf-8")

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


