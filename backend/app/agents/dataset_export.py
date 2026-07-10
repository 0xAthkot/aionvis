"""Dataset export: package a compiled dataset as a YOLO/COCO/VOC/CSV zip.

Format parity with Label Studio's computer-vision exports (YOLO, COCO,
Pascal VOC XML, CSV) — the point being that datasets labeled by the swarm
leave in whatever format the user's downstream tooling already speaks.

Rebuilt from the store records + the served image files, so it works for any
dataset regardless of whether its run workdir still exists. Curation is
honored: only accepted images with at least one box are exported.
"""

import csv
import io
import json
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

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

    writers = {
        "yolo": _write_yolo,
        "coco": _write_coco,
        "voc": _write_voc,
        "csv": _write_csv,
    }
    zip_path = out_dir / f"{dataset.id}-{fmt}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        writers[fmt](zf, dataset, usable, img_dir)

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
                           "aionVIS",
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
            ann = {
                "id": ann_id, "image_id": idx, "category_id": b.class_id,
                "bbox": [round(x, 2), round(y, 2), round(w, 2), round(h, 2)],
                "area": round(w * h, 2), "iscrowd": 0,
            }
            if b.polygon and len(b.polygon) >= 6:
                # Critic-verified mask contour → absolute COCO segmentation.
                ann["segmentation"] = [[
                    round(v * (img.width if i % 2 == 0 else img.height), 2)
                    for i, v in enumerate(b.polygon)
                ]]
            coco["annotations"].append(ann)
            ann_id += 1
    zf.writestr(f"{root}/annotations/instances.json", json.dumps(coco, indent=2))


def _abs_xyxy(b, img) -> tuple[float, float, float, float]:
    x1 = max((b.cx - b.w / 2) * img.width, 0)
    y1 = max((b.cy - b.h / 2) * img.height, 0)
    x2 = min((b.cx + b.w / 2) * img.width, img.width)
    y2 = min((b.cy + b.h / 2) * img.height, img.height)
    return x1, y1, x2, y2


def _write_voc(zf: zipfile.ZipFile, dataset: Dataset,
               images: list[AnnotatedImage], img_dir: Path) -> None:
    """Pascal VOC: one XML per image + the images, Label Studio-compatible."""
    root = f"{dataset.id}-voc"
    names = {c.id: c.name for c in dataset.classes}
    for img in images:
        zf.write(img_dir / img.file_name, f"{root}/images/{img.file_name}")
        objects = []
        for b in img.boxes:
            x1, y1, x2, y2 = _abs_xyxy(b, img)
            objects.append(
                "  <object>\n"
                f"    <name>{escape(names.get(b.class_id, str(b.class_id)))}</name>\n"
                "    <pose>Unspecified</pose>\n"
                "    <truncated>0</truncated>\n"
                "    <difficult>0</difficult>\n"
                "    <bndbox>\n"
                f"      <xmin>{round(x1)}</xmin>\n"
                f"      <ymin>{round(y1)}</ymin>\n"
                f"      <xmax>{round(x2)}</xmax>\n"
                f"      <ymax>{round(y2)}</ymax>\n"
                "    </bndbox>\n"
                "  </object>"
            )
        xml = (
            "<annotation>\n"
            "  <folder>images</folder>\n"
            f"  <filename>{escape(img.file_name)}</filename>\n"
            "  <size>\n"
            f"    <width>{img.width}</width>\n"
            f"    <height>{img.height}</height>\n"
            "    <depth>3</depth>\n"
            "  </size>\n"
            "  <segmented>0</segmented>\n"
            + "\n".join(objects) + "\n"
            "</annotation>\n"
        )
        zf.writestr(f"{root}/annotations/{Path(img.file_name).stem}.xml", xml)


def _write_csv(zf: zipfile.ZipFile, dataset: Dataset,
               images: list[AnnotatedImage], img_dir: Path) -> None:
    """Flat CSV of absolute-pixel boxes + the images."""
    root = f"{dataset.id}-csv"
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(["image", "width", "height", "label",
                     "xmin", "ymin", "xmax", "ymax", "confidence"])
    names = {c.id: c.name for c in dataset.classes}
    for img in images:
        zf.write(img_dir / img.file_name, f"{root}/images/{img.file_name}")
        for b in img.boxes:
            x1, y1, x2, y2 = _abs_xyxy(b, img)
            writer.writerow([
                img.file_name, img.width, img.height,
                names.get(b.class_id, str(b.class_id)),
                round(x1), round(y1), round(x2), round(y2),
                b.confidence if b.confidence is not None else "",
            ])
    zf.writestr(f"{root}/annotations.csv", buf.getvalue())
