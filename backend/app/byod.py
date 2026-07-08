"""BYOD (Path B) uploads.

`save_archive` is the real flow: a multipart .zip lands here, is extracted
to data/byod/{datasetId}/ and registered as a Dataset the run wizard can
pick. Three ingestion paths inside one archive:

  images only          -> unlabeled dataset, the swarm labels from scratch
  images + YOLO/COCO   -> labels are parsed into labels.json; a run on the
  annotation files        dataset AUDITS them (label_audit.py) instead of
                          running the Vision Agent
  video files          -> frames are extracted (OpenCV, evenly strided) and
                          treated as images

`register_archive_shell` keeps the contract's original JSON body working
(metadata-only registration).
"""

import json
import zipfile
from pathlib import Path

import yaml
from fastapi import HTTPException, UploadFile

from .config import DATA_DIR, settings
from .schemas import Dataset, DatasetClass, ImportedLabels
from .store import now_iso, store

IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".bmp", ".webp")
VIDEO_SUFFIXES = (".mp4", ".mov", ".avi", ".mkv", ".webm")

# Same validated palette the dataset compiler assigns.
from .agents.dataset_compiler import CLASS_COLORS  # noqa: E402


def _new_dataset(name: str, image_count: int, size_mb: float) -> Dataset:
    org = store.organizations[0]
    dataset = Dataset(
        id=store.next_id("ds"), org_id=org.id, name=name, origin="byod",
        status="unlabeled", image_count=image_count, labeled_count=0,
        classes=[], size_mb=round(size_mb, 1), created_at=now_iso(),
    )
    store.datasets[dataset.id] = dataset
    store.save()
    return dataset


def register_archive_shell(archive_name: str, size_mb: float) -> Dataset:
    return _new_dataset(archive_name.removesuffix(".zip"), 0, size_mb)


# --- video frames --------------------------------------------------------------


def _extract_video_frames(data: bytes, suffix: str, target_dir: Path,
                          start_index: int) -> list[str]:
    """Evenly strided frames from one video, saved as byod_*.jpg.
    Returns the safe names written."""
    import cv2

    tmp = target_dir / f"__video{suffix}"
    tmp.write_bytes(data)
    names: list[str] = []
    try:
        cap = cv2.VideoCapture(str(tmp))
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        if total <= 0:
            cap.release()
            return names
        n = min(settings.video_max_frames, total)
        stride = max(total // n, 1)
        for i in range(n):
            cap.set(cv2.CAP_PROP_POS_FRAMES, i * stride)
            ok, frame = cap.read()
            if not ok:
                break
            name = f"byod_{start_index + len(names):04d}.jpg"
            cv2.imwrite(str(target_dir / name), frame)
            names.append(name)
        cap.release()
    finally:
        tmp.unlink(missing_ok=True)
    return names


# --- label parsing -------------------------------------------------------------


def _parse_yolo_labels(txts: dict[str, str]) -> dict[str, list[dict]]:
    """{image stem: [box dict]} from YOLO txt bodies (detect or seg lines)."""
    out: dict[str, list[dict]] = {}
    for stem, body in txts.items():
        boxes = []
        for line in body.splitlines():
            parts = line.split()
            if len(parts) < 5:
                continue
            try:
                cls = int(float(parts[0]))
                vals = [float(v) for v in parts[1:]]
            except ValueError:
                continue
            if len(vals) == 4:  # detect: cx cy w h
                cx, cy, w, h = vals
                poly = None
            elif len(vals) >= 6 and len(vals) % 2 == 0:  # seg polygon
                xs, ys = vals[0::2], vals[1::2]
                x1, x2 = min(xs), max(xs)
                y1, y2 = min(ys), max(ys)
                cx, cy, w, h = (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1
                poly = [round(v, 4) for v in vals]
            else:
                continue
            boxes.append({"classId": cls, "cx": round(cx, 4), "cy": round(cy, 4),
                          "w": round(w, 4), "h": round(h, 4), "polygon": poly})
        if boxes:
            out[stem] = boxes
    return out


def _parse_coco(doc: dict) -> tuple[dict[str, list[dict]], list[str]]:
    """COCO instances json -> ({image stem: [box dict]}, class names).
    Category ids are remapped to a dense 0-based index."""
    cats = sorted(doc.get("categories", []), key=lambda c: c.get("id", 0))
    id_map = {c["id"]: i for i, c in enumerate(cats)}
    names = [str(c.get("name", f"class_{i}")) for i, c in enumerate(cats)]
    images = {img["id"]: img for img in doc.get("images", [])}
    out: dict[str, list[dict]] = {}
    for ann in doc.get("annotations", []):
        img = images.get(ann.get("image_id"))
        if img is None or ann.get("category_id") not in id_map:
            continue
        iw, ih = float(img.get("width", 0)), float(img.get("height", 0))
        if iw <= 0 or ih <= 0:
            continue
        x, y, w, h = (float(v) for v in ann.get("bbox", [0, 0, 0, 0]))
        poly = None
        seg = ann.get("segmentation")
        if isinstance(seg, list) and seg and isinstance(seg[0], list) and len(seg[0]) >= 6:
            flat = seg[0]
            poly = [round((v / iw) if i % 2 == 0 else (v / ih), 4)
                    for i, v in enumerate(flat)]
        stem = Path(str(img.get("file_name", ""))).stem
        out.setdefault(stem, []).append({
            "classId": id_map[ann["category_id"]],
            "cx": round((x + w / 2) / iw, 4), "cy": round((y + h / 2) / ih, 4),
            "w": round(w / iw, 4), "h": round(h / ih, 4), "polygon": poly,
        })
    return out, names


def _class_names_from_yolo_meta(yaml_bodies: list[str],
                                classes_txt: str | None,
                                max_id: int) -> list[str]:
    for body in yaml_bodies:
        try:
            doc = yaml.safe_load(body)
        except yaml.YAMLError:
            continue
        names = (doc or {}).get("names")
        if isinstance(names, dict):
            return [str(names[k]) for k in sorted(names, key=int)]
        if isinstance(names, list):
            return [str(n) for n in names]
    if classes_txt:
        lines = [ln.strip() for ln in classes_txt.splitlines() if ln.strip()]
        if lines:
            return lines
    return [f"class_{i}" for i in range(max_id + 1)]


def _slug(name: str) -> str:
    return name.strip().lower().replace(" ", "_") or "object"


# --- the upload ---------------------------------------------------------------


async def save_archive(archive: UploadFile) -> Dataset:
    filename = archive.filename or "upload.zip"
    suffix = Path(filename).suffix.lower()

    # A bare video file uploads without zipping.
    if suffix in VIDEO_SUFFIXES:
        return await _save_bare_video(archive, filename, suffix)
    return await _save_zip(archive, filename)


async def _save_bare_video(archive: UploadFile, filename: str,
                           suffix: str) -> Dataset:
    dataset = _new_dataset(Path(filename).stem, 0, 0)
    target_dir = DATA_DIR / "byod" / dataset.id
    target_dir.mkdir(parents=True, exist_ok=True)
    data = await archive.read()
    frames = _extract_video_frames(data, suffix, target_dir, 0)
    if not frames:
        del store.datasets[dataset.id]
        store.save()
        raise HTTPException(400, f"Could not decode any frames from {filename}")
    dataset.image_count = len(frames)
    dataset.video_frame_count = len(frames)
    dataset.size_mb = round(len(data) / 1024**2, 1)
    store.save()
    return dataset


async def _save_zip(archive: UploadFile, filename: str) -> Dataset:
    dataset = _new_dataset(filename.removesuffix(".zip"), 0, 0)
    target_dir = DATA_DIR / "byod" / dataset.id
    target_dir.mkdir(parents=True, exist_ok=True)
    zip_path = target_dir / "archive.zip"

    size = 0
    with zip_path.open("wb") as out:
        while chunk := await archive.read(1024 * 1024):
            size += len(chunk)
            out.write(chunk)

    extracted = 0
    video_frames = 0
    stem_to_safe: dict[str, str] = {}   # original stem -> safe image name
    label_txts: dict[str, str] = {}     # original stem -> YOLO txt body
    yaml_bodies: list[str] = []
    classes_txt: str | None = None
    coco_docs: list[dict] = []

    try:
        with zipfile.ZipFile(zip_path) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                p = Path(info.filename)
                sfx = p.suffix.lower()
                if sfx in IMAGE_SUFFIXES:
                    # Flatten + sanitize: ignore any path components.
                    safe_name = f"byod_{extracted:04d}{sfx}"
                    with zf.open(info) as src, (target_dir / safe_name).open("wb") as dst:
                        dst.write(src.read())
                    stem_to_safe[p.stem] = safe_name
                    extracted += 1
                elif sfx in VIDEO_SUFFIXES:
                    names = _extract_video_frames(
                        zf.read(info), sfx, target_dir, extracted)
                    extracted += len(names)
                    video_frames += len(names)
                elif sfx == ".txt" and p.name.lower() == "classes.txt":
                    classes_txt = zf.read(info).decode("utf-8", "replace")
                elif sfx == ".txt":
                    label_txts[p.stem] = zf.read(info).decode("utf-8", "replace")
                elif sfx in (".yaml", ".yml"):
                    yaml_bodies.append(zf.read(info).decode("utf-8", "replace"))
                elif sfx == ".json":
                    try:
                        doc = json.loads(zf.read(info).decode("utf-8", "replace"))
                    except json.JSONDecodeError:
                        continue
                    if isinstance(doc, dict) and "annotations" in doc and "images" in doc:
                        coco_docs.append(doc)
    except zipfile.BadZipFile:
        del store.datasets[dataset.id]
        store.save()
        raise HTTPException(400, "Uploaded file is not a valid .zip archive")
    finally:
        zip_path.unlink(missing_ok=True)

    if extracted == 0:
        del store.datasets[dataset.id]
        store.save()
        raise HTTPException(
            400, "Archive contains no images (jpg/png/bmp/webp) or videos "
                 "(mp4/mov/avi/mkv/webm)")

    # --- provided labels: parse into one normalized labels.json manifest
    by_stem: dict[str, list[dict]] = {}
    class_names: list[str] = []
    fmt: str | None = None
    if coco_docs:
        fmt = "coco"
        for doc in coco_docs:
            parsed, class_names = _parse_coco(doc)
            by_stem.update(parsed)
    elif label_txts:
        fmt = "yolo"
        by_stem = _parse_yolo_labels(label_txts)
        max_id = max((b["classId"] for boxes in by_stem.values() for b in boxes),
                     default=0)
        class_names = _class_names_from_yolo_meta(yaml_bodies, classes_txt, max_id)

    manifest: dict[str, list[dict]] = {}
    box_count = 0
    for stem, boxes in by_stem.items():
        safe = stem_to_safe.get(stem)
        if safe is None:
            continue
        manifest[safe] = boxes
        box_count += len(boxes)

    if fmt and box_count:
        class_names = [_slug(n) for n in class_names]
        (target_dir / "labels.json").write_text(
            json.dumps({"format": fmt, "classNames": class_names,
                        "images": manifest}),
            encoding="utf-8")
        dataset.imported_labels = ImportedLabels(
            format=fmt, class_names=class_names, box_count=box_count)
        dataset.labeled_count = len(manifest)
        dataset.status = "curating"  # labeled, but not yet Critic-audited
        counts: dict[int, int] = {}
        for boxes in manifest.values():
            for b in boxes:
                counts[b["classId"]] = counts.get(b["classId"], 0) + 1
        dataset.classes = [
            DatasetClass(id=i, name=n, color=CLASS_COLORS[i % len(CLASS_COLORS)],
                         instance_count=counts.get(i, 0))
            for i, n in enumerate(class_names)
        ]

    dataset.image_count = extracted
    if video_frames:
        dataset.video_frame_count = video_frames
    dataset.size_mb = round(size / 1024**2, 1)
    store.save()
    return dataset
