"""Training on datasets that already exist (run.path == "dataset").

Turns stored, labeled datasets back into the ReviewedImage list the compiler
consumes, so a new model (another architecture, from scratch, ...) can train
on them without generating or labeling anything again. Two or more datasets
merge by class name, ignoring case and `_` vs space.
"""

from ..config import DATA_DIR
from ..schemas import AnnotatedImage, CritiqueRecord
from ..store import store
from .critic_agent import ReviewedImage


def norm(name: str) -> str:
    return " ".join(name.replace("_", " ").lower().split())


def accepted_images(dataset_id: str) -> list[AnnotatedImage]:
    """Images a training run may use: accepted by the Critic or the user."""
    return [img for img in store.images.get(dataset_id, [])
            if img.curation_state == "accepted"]


def merged_class_names(dataset_ids: list[str]) -> list[str]:
    """Union of the datasets' classes, first spelling wins, stable order."""
    names: list[str] = []
    seen: set[str] = set()
    for did in dataset_ids:
        for cls in sorted(store.datasets[did].classes, key=lambda c: c.id):
            key = norm(cls.name)
            if key not in seen:
                seen.add(key)
                names.append(cls.name)
    return names


def reviewed_from_datasets(dataset_ids: list[str],
                           class_names: list[str]) -> list[ReviewedImage]:
    """Rebuild compiler input from stored records. Boxes are deep copies
    with class ids remapped onto `class_names` (compiling may attach pose
    keypoints to boxes; the source dataset must never change). Merged images
    get a dataset-prefixed file name so img_0000.jpg from two datasets can't
    collide."""
    index = {norm(n): i for i, n in enumerate(class_names)}
    prefix = len(dataset_ids) > 1
    reviewed: list[ReviewedImage] = []
    for did in dataset_ids:
        id_to_name = {c.id: c.name for c in store.datasets[did].classes}
        img_dir = DATA_DIR / "files" / "datasets" / did / "images"
        for rec in accepted_images(did):
            path = img_dir / rec.file_name
            if not path.exists():
                continue
            boxes = []
            for b in rec.boxes:
                name = id_to_name.get(b.class_id)
                if name is None or norm(name) not in index:
                    continue
                boxes.append(b.model_copy(
                    deep=True, update={"class_id": index[norm(name)]}))
            reviewed.append(ReviewedImage(
                path=path, width=rec.width, height=rec.height, boxes=boxes,
                critique=(rec.critique.model_copy(deep=True) if rec.critique
                          else CritiqueRecord(verdict="accepted", attempts=1,
                                              critic="imported")),
                accepted=True,
                out_name=f"{did}_{rec.file_name}" if prefix else None,
                # Held-out images (val or test) stay held out.
                split="train" if rec.split == "train" else "val",
            ))
    return reviewed
