"""BYOD (Path B) uploads.

`save_archive` is the real flow: a multipart .zip lands here, is extracted
to data/byod/{datasetId}/ and registered as an unlabeled Dataset the run
wizard can pick. `register_archive_shell` keeps the contract's original
JSON body working (metadata-only registration).
"""

import zipfile
from pathlib import Path

from fastapi import HTTPException, UploadFile

from .config import DATA_DIR
from .schemas import Dataset
from .store import now_iso, store

IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".bmp", ".webp")


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


async def save_archive(archive: UploadFile) -> Dataset:
    name = (archive.filename or "upload.zip").removesuffix(".zip")
    dataset = _new_dataset(name, 0, 0)
    target_dir = DATA_DIR / "byod" / dataset.id
    target_dir.mkdir(parents=True, exist_ok=True)
    zip_path = target_dir / "archive.zip"

    size = 0
    with zip_path.open("wb") as out:
        while chunk := await archive.read(1024 * 1024):
            size += len(chunk)
            out.write(chunk)

    extracted = 0
    try:
        with zipfile.ZipFile(zip_path) as zf:
            for info in zf.infolist():
                suffix = Path(info.filename).suffix.lower()
                if info.is_dir() or suffix not in IMAGE_SUFFIXES:
                    continue
                # Flatten + sanitize: ignore any path components in the zip.
                safe_name = f"byod_{extracted:04d}{suffix}"
                with zf.open(info) as src, (target_dir / safe_name).open("wb") as dst:
                    dst.write(src.read())
                extracted += 1
    except zipfile.BadZipFile:
        del store.datasets[dataset.id]
        store.save()
        raise HTTPException(400, "Uploaded file is not a valid .zip archive")
    finally:
        zip_path.unlink(missing_ok=True)

    if extracted == 0:
        del store.datasets[dataset.id]
        store.save()
        raise HTTPException(400, "Archive contains no images (jpg/png/bmp/webp)")

    dataset.image_count = extracted
    dataset.size_mb = round(size / 1024**2, 1)
    store.save()
    return dataset
