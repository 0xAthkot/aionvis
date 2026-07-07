"""Dataset export: package a compiled dataset as a YOLO or COCO zip.

Rebuilt from the store records + the served image files, so it works for any
dataset regardless of whether its run workdir still exists. Curation is
honored: only accepted images with at least one box are exported.
"""

import json
import zipfile
from pathlib import Path

import yaml

from ..config import DATA_DIR, settings
from ..schemas import AnnotatedImage, Dataset


def export_dataset(dataset: Dataset, images: list[AnnotatedImage], fmt: str) -> str:
    """Write (or refresh) the export zip and return its download URL."""
    files_dir = DATA_DIR / "files" / "datasets" / dataset.id
    img_dir = files_dir / "images"
    out_dir = files_dir / "exports"
    out_dir.mkdir(parents=True, exist_ok=True)

    usable = [
        i for i in images
        if i.curation_state == "accepted" and i.boxes
        and (img_dir / i.file_name).exists()
    ]
    if not usable:
        raise ValueError("dataset has no accepted labeled images to export")

    zip_path = out_dir / f"{dataset.id}-{fmt}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        if fmt == "yolo":
            _write_yolo(zf, dataset, usable, img_dir)
        else:
            _write_coco(zf, dataset, usable, img_dir)

    return (f"{settings.public_base_url}/files/datasets/{dataset.id}"
            f"/exports/{zip_path.name}")


def _write_yolo(zf: zipfile.ZipFile, dataset: Dataset,
                images: list[AnnotatedImage], img_dir: Path) -> None:
    root = f"{dataset.id}-yolo"
    splits = {i.split for i in images}
    zf.writestr(f"{root}/data.yaml", yaml.safe_dump({
        "path": ".",
        "train": "images/train",
        # Single-split datasets validate on train, same as the pipeline does.
        "val": "images/val" if "val" in splits else "images/train",
        "names": {c.id: c.name for c in dataset.classes},
    }))
    for img in images:
        split = "val" if img.split == "val" else "train"
        zf.write(img_dir / img.file_name, f"{root}/images/{split}/{img.file_name}")
        lines = [f"{b.class_id} {b.cx} {b.cy} {b.w} {b.h}" for b in img.boxes]
        zf.writestr(
            f"{root}/labels/{split}/{Path(img.file_name).stem}.txt",
            "\n".join(lines),
        )


def _write_coco(zf: zipfile.ZipFile, dataset: Dataset,
                images: list[AnnotatedImage], img_dir: Path) -> None:
    root = f"{dataset.id}-coco"
    coco: dict = {
        "info": {
            "description": f"{dataset.name} — generated and self-verified by "
                           "Auto-Annotator",
            "date_created": dataset.created_at,
        },
        "images": [],
        "annotations": [],
        "categories": [
            {"id": c.id, "name": c.name, "supercategory": "object"}
            for c in dataset.classes
        ],
    }
    ann_id = 1
    for idx, img in enumerate(images):
        zf.write(img_dir / img.file_name, f"{root}/images/{img.file_name}")
        coco["images"].append({
            "id": idx, "file_name": img.file_name,
            "width": img.width, "height": img.height,
        })
        for b in img.boxes:
            # YOLO-normalized center box → COCO absolute [x_min, y_min, w, h].
            w, h = b.w * img.width, b.h * img.height
            x, y = b.cx * img.width - w / 2, b.cy * img.height - h / 2
            coco["annotations"].append({
                "id": ann_id, "image_id": idx, "category_id": b.class_id,
                "bbox": [round(x, 2), round(y, 2), round(w, 2), round(h, 2)],
                "area": round(w * h, 2), "iscrowd": 0,
            })
            ann_id += 1
    zf.writestr(f"{root}/annotations/instances.json", json.dumps(coco, indent=2))
