"""Training on existing datasets, dataset-only runs, from-scratch training,
and the compile/preview/SAM 3 pool optimizations. CPU only, no models.

Run:  .venv\\Scripts\\python -m pytest tests/test_dataset_runs.py -q
"""

import sys
from pathlib import Path

import pytest
from PIL import Image
from starlette.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import routers  # noqa: E402
from app.agents import dataset_compiler, dataset_merge, sam3_bridge  # noqa: E402
from app.main import app  # noqa: E402
from app.orchestrator.context import RunContext  # noqa: E402
from app.orchestrator.pipeline import Pipeline, pipeline, stages_for  # noqa: E402
from app.schemas import (  # noqa: E402
    AnnotatedImage,
    BoundingBox,
    Dataset,
    DatasetClass,
    DatasetSourceConfig,
    PipelineRun,
    RunProgress,
    TrainingConfig,
)
from app.store import now_iso, store  # noqa: E402

client = TestClient(app)


def _training(**kw) -> dict:
    return {"architecture": "yolo26n", "task": "detect", "epochs": 3,
            "imageSize": 320, "batchSize": 4, "device": "cpu", **kw}


@pytest.fixture()
def data_dir(tmp_path, monkeypatch):
    """Point every module that writes files at a temp DATA_DIR."""
    for mod in (dataset_compiler, dataset_merge):
        monkeypatch.setattr(mod, "DATA_DIR", tmp_path)
    return tmp_path


def _make_dataset(data_dir: Path, ds_id: str, classes: list[str], n: int,
                  rejected: int = 0) -> Dataset:
    """A labeled dataset on disk + in the store (accepted images, splits)."""
    img_dir = data_dir / "files" / "datasets" / ds_id / "images"
    img_dir.mkdir(parents=True, exist_ok=True)
    records = []
    for i in range(n + rejected):
        name = f"img_{i:04d}.jpg"
        Image.new("RGB", (32, 24), (i * 20 % 255, 80, 120)).save(img_dir / name)
        records.append(AnnotatedImage(
            id=f"{ds_id}-img-{i:04d}", dataset_id=ds_id, file_name=name,
            width=32, height=24, url="u", thumbnail_url="t",
            boxes=[BoundingBox(class_id=i % len(classes), cx=0.5, cy=0.5,
                               w=0.4, h=0.4, confidence=0.9)],
            split="val" if i % 4 == 0 else "train",
            curation_state="rejected" if i >= n else "accepted",
        ))
    ds = Dataset(
        id=ds_id, org_id="org_t", name=f"{ds_id}-name", origin="synthetic",
        status="ready", image_count=n + rejected, labeled_count=n,
        classes=[DatasetClass(id=k, name=c, color="#000", instance_count=1)
                 for k, c in enumerate(classes)],
        size_mb=0.1, created_at=now_iso(),
    )
    store.datasets[ds_id] = ds
    store.images[ds_id] = records
    return ds


@pytest.fixture(autouse=True)
def seeded(monkeypatch):
    if not store.projects:
        store.seed()
    monkeypatch.setattr(pipeline, "launch", lambda run_id: None)
    created: list[str] = []
    yield created
    for ds_id in list(store.datasets):
        if ds_id.startswith("ds_t"):
            store.datasets.pop(ds_id, None)
            store.images.pop(ds_id, None)


def _dataset_body(ids, train=True, **training) -> dict:
    return {"projectId": store.projects[0].id, "name": "retrain",
            "source": {"path": "dataset", "datasetIds": ids},
            "training": _training(**training), "trainModel": train}


# --- run creation ---------------------------------------------------------------


def test_dataset_run_merges_classes_and_skips_labeler(data_dir):
    _make_dataset(data_dir, "ds_t1", ["hard_hat", "worker"], 6, rejected=2)
    _make_dataset(data_dir, "ds_t2", ["Hard Hat", "vest"], 4)
    r = client.post("/api/v1/runs", json=_dataset_body(["ds_t1", "ds_t2"]))
    assert r.status_code == 201, r.text
    run = r.json()
    assert run["targetClasses"] == ["hard_hat", "worker", "vest"]
    assert run["progress"]["imagesTotal"] == 10  # accepted images only
    assert run["pipelineMode"] == "sequential"
    assert run["visionBackend"] is None
    assert run["trainModel"] is True


@pytest.mark.parametrize("ids,train,status,needle", [
    ([], True, 400, "at least one dataset"),
    (["ds_nope"], True, 404, "ds_nope"),
    (["ds_t1"], False, 400, "two or more"),
])
def test_dataset_run_rejections(data_dir, ids, train, status, needle):
    _make_dataset(data_dir, "ds_t1", ["a"], 2)
    r = client.post("/api/v1/runs", json=_dataset_body(ids, train=train))
    assert r.status_code == status
    assert needle in r.json()["message"]


def test_unlabeled_dataset_is_rejected(data_dir):
    _make_dataset(data_dir, "ds_t1", ["a"], 0, rejected=3)
    r = client.post("/api/v1/runs", json=_dataset_body(["ds_t1"]))
    assert r.status_code == 400 and "no labeled images" in r.json()["message"]


def test_dataset_only_synthetic_run_has_no_epochs():
    body = {
        "projectId": store.projects[0].id, "name": "dataset-only",
        "targetClasses": ["widget"],
        "source": {"path": "synthetic", "useCase": "a bench camera detects widgets",
                   "generator": "sdxl",
                   "randomization": {"lightingVariation": 0.5,
                                     "cameraAngleVariation": 0.5,
                                     "backgroundDiversity": 0.5,
                                     "occlusionRate": 0.2, "scenarioCount": 4,
                                     "imageCount": 4, "guidanceScale": 7.5}},
        "training": _training(pretrained=False), "trainModel": False,
        "visionBackend": "yoloe",
    }
    r = client.post("/api/v1/runs", json=body)
    assert r.status_code == 201, r.text
    run = r.json()
    assert run["trainModel"] is False
    assert run["progress"]["totalEpochs"] == 0
    assert run["training"]["pretrained"] is False
    est = client.post("/api/v1/runs/estimate", json=body).json()
    assert "training" not in [row["stage"] for row in est["breakdown"]]


def test_rf_detr_from_scratch_is_rejected(monkeypatch):
    from app.agents import rfdetr_bridge

    monkeypatch.setattr(rfdetr_bridge, "available", lambda: True)
    body = _dataset_body(["x"], architecture="rf-detr-nano", pretrained=False)
    r = client.post("/api/v1/runs", json=body)
    assert r.status_code == 400 and "pretrained weights only" in r.json()["message"]


def test_pretrained_defaults_true_for_old_payloads():
    assert TrainingConfig.model_validate(
        {"architecture": "yolo11n", "epochs": 1, "imageSize": 320,
         "batchSize": 1, "device": "cpu"}).pretrained is True


# --- stage plan -----------------------------------------------------------------


def _run(path="dataset", train=True, ids=("ds_t1",), classes=("a",)) -> PipelineRun:
    return PipelineRun(
        id="run_t_ds", org_id="org_t", project_id="proj_t", name="t",
        path=path, status="running", stage="queued",
        source=DatasetSourceConfig(path="dataset", dataset_ids=list(ids)),
        training=TrainingConfig(architecture="yolo26n", epochs=1, image_size=320,
                                batch_size=2, device="cpu"),
        train_model=train, target_classes=list(classes),
        progress=RunProgress(pct=0, images_generated=0, images_total=0,
                             masks_accepted=0, masks_rejected=0,
                             current_epoch=0, total_epochs=1),
        created_by="m", created_at=now_iso(),
    )


def test_stages_for_dataset_and_dataset_only_runs():
    assert stages_for(_run()) == ["dataset_compile", "training"]
    assert stages_for(_run(train=False)) == ["dataset_compile"]


# --- reusing stored labels --------------------------------------------------------


def test_reviewed_from_datasets_remaps_without_touching_sources(data_dir):
    _make_dataset(data_dir, "ds_t1", ["cat", "dog"], 4, rejected=1)
    _make_dataset(data_dir, "ds_t2", ["DOG"], 2)
    names = dataset_merge.merged_class_names(["ds_t1", "ds_t2"])
    assert names == ["cat", "dog"]
    reviewed = dataset_merge.reviewed_from_datasets(["ds_t1", "ds_t2"], names)
    assert len(reviewed) == 6  # rejected image excluded
    from_t2 = [r for r in reviewed if r.path.parent.parent.name == "ds_t2"]
    assert all(b.class_id == 1 for r in from_t2 for b in r.boxes)  # DOG -> dog
    assert len({r.out_name for r in reviewed if r.out_name}) == 6  # unique
    # Deep copies: mutating a reviewed box never reaches the stored record.
    reviewed[0].boxes[0].keypoints = [1.0]
    assert store.images["ds_t1"][0].boxes[0].keypoints is None
    assert reviewed[0].split == "val"  # kept from the source record


def test_compile_in_place_leaves_dataset_untouched(data_dir, tmp_path):
    ds = _make_dataset(data_dir, "ds_t1", ["a", "b"], 8)
    before = [r.model_dump() for r in store.images["ds_t1"]]
    run = _run(ids=["ds_t1"], classes=["a", "b"])
    ctx = RunContext(run)
    reviewed = dataset_merge.reviewed_from_datasets(["ds_t1"], run.target_classes)
    out = dataset_compiler.compile_dataset(ctx, reviewed, tmp_path / "work",
                                           register=False)
    assert out.id == "ds_t1" and run.dataset_id == "ds_t1"
    assert [r.model_dump() for r in store.images["ds_t1"]] == before
    assert ds.image_count == 8
    yolo = tmp_path / "work" / "yolo"
    assert len(list((yolo / "images" / "val").iterdir())) == 2  # kept splits
    assert len(list((yolo / "labels" / "train").iterdir())) == 6
    assert (yolo / "data.yaml").exists()


def test_project_keeps_every_class_in_order():
    """Simple builds take their classes from the project: no silent cap."""
    names = [f"class {i}" for i in range(20)]
    r = client.post("/api/v1/projects", json={"name": "Twenty", "targetClasses": names})
    assert r.status_code == 201
    project = r.json()
    try:
        assert project["targetClasses"] == [f"class_{i}" for i in range(20)]
    finally:
        store.projects[:] = [p for p in store.projects if p.id != project["id"]]


def test_yolo_export_trains_from_any_directory(data_dir, tmp_path, monkeypatch):
    """The exported data.yaml must resolve its splits next to itself, not in
    whatever directory the user's shell happens to be in."""
    import zipfile

    import ultralytics.data.utils as yolo_utils

    from app.agents import dataset_export

    monkeypatch.setattr(dataset_export, "DATA_DIR", data_dir)
    monkeypatch.setattr(yolo_utils, "check_font", lambda *a, **k: None)  # no download
    ds = _make_dataset(data_dir, "ds_t1", ["cat", "dog"], 8)
    dataset_export.export_dataset(ds, store.images["ds_t1"], "yolo")
    zip_path = data_dir / "files" / "datasets" / "ds_t1" / "exports" / "ds_t1-yolo.zip"
    zipfile.ZipFile(zip_path).extractall(tmp_path / "unzipped")
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    data = yolo_utils.check_det_dataset(str(tmp_path / "unzipped" / "ds_t1-yolo" / "data.yaml"))
    assert Path(data["train"]) == tmp_path / "unzipped" / "ds_t1-yolo" / "images" / "train"
    assert len(list(Path(data["val"]).iterdir())) == 2
    assert data["names"] == {0: "cat", 1: "dog"}


def test_compile_merge_mints_new_dataset_with_unique_files(data_dir, tmp_path):
    _make_dataset(data_dir, "ds_t1", ["a"], 3)
    _make_dataset(data_dir, "ds_t2", ["a"], 3)  # same file names as ds_t1
    run = _run(ids=["ds_t1", "ds_t2"], classes=["a"])
    ctx = RunContext(run)
    reviewed = dataset_merge.reviewed_from_datasets(["ds_t1", "ds_t2"], ["a"])
    merged = dataset_compiler.compile_dataset(ctx, reviewed, tmp_path / "work")
    try:
        assert merged.id not in ("ds_t1", "ds_t2")
        assert merged.origin == "dataset"
        assert merged.merged_from == ["ds_t1", "ds_t2"]
        assert merged.image_count == 6
        files = list((data_dir / "files" / "datasets" / merged.id / "images").iterdir())
        assert len(files) == 6  # no collisions between the two img_0000.jpg
        thumbs = list((data_dir / "files" / "datasets" / merged.id / "thumbs").iterdir())
        assert len(thumbs) == 6
    finally:
        store.datasets.pop(merged.id, None)
        store.images.pop(merged.id, None)


def test_compile_links_instead_of_copying(tmp_path):
    src = tmp_path / "src.jpg"
    Image.new("RGB", (8, 8)).save(src)
    dst = tmp_path / "dst.jpg"
    dataset_compiler._link_or_copy(src, dst)
    assert dst.read_bytes() == src.read_bytes()
    dataset_compiler._link_or_copy(src, dst)  # idempotent on the same file
    assert dst.exists()


def test_dataset_only_pipeline_trains_nothing(data_dir, tmp_path, monkeypatch):
    _make_dataset(data_dir, "ds_t1", ["a"], 3)
    _make_dataset(data_dir, "ds_t2", ["a"], 3)
    run = _run(ids=["ds_t1", "ds_t2"], classes=["a"], train=False)
    store.runs[run.id] = run
    monkeypatch.setattr("app.orchestrator.pipeline.DATA_DIR", tmp_path)
    from app.agents import mlops_agent as mlops_mod

    monkeypatch.setattr(mlops_mod.mlops_agent, "train",
                        lambda *a, **k: pytest.fail("training must not run"))
    p = Pipeline()
    ctx = RunContext(run)
    p.active[run.id] = ctx
    try:
        p._worker(ctx)
        assert run.status == "succeeded", run.failure_reason
        assert run.model_id is None
        assert store.datasets[run.dataset_id].merged_from == ["ds_t1", "ds_t2"]
    finally:
        store.runs.pop(run.id, None)
        if run.dataset_id:
            store.datasets.pop(run.dataset_id, None)
            store.images.pop(run.dataset_id, None)


# --- preview window ---------------------------------------------------------------


def test_preview_offset_limit(tmp_path, monkeypatch):
    import json

    monkeypatch.setattr("app.config.DATA_DIR", tmp_path)
    run = _run()
    store.runs[run.id] = run
    try:
        d = tmp_path / "files" / "runs" / run.id
        d.mkdir(parents=True)
        (d / "preview.json").write_text(json.dumps(
            [{"fileName": f"img_{i:04d}.jpg", "scenario": "s"} for i in range(30)]))
        all_ = client.get(f"/api/v1/runs/{run.id}/preview").json()
        page = client.get(f"/api/v1/runs/{run.id}/preview?offset=24&limit=24").json()
        assert len(all_) == 30
        assert [p["fileName"] for p in page] == [f"img_{i:04d}.jpg" for i in range(24, 30)]
    finally:
        store.runs.pop(run.id, None)
        routers._manifest_cache.clear()


# --- SAM 3 worker pool --------------------------------------------------------------


class _FakeSession:
    made = 0

    def __init__(self, on_log=None):
        _FakeSession.made += 1
        self.closed = False

    def alive(self):
        return not self.closed

    def close(self):
        self.closed = True


def test_sam3_pool_gives_concurrent_runs_their_own_worker(monkeypatch):
    monkeypatch.setattr(sam3_bridge, "Sam3Session", _FakeSession)
    monkeypatch.setattr(sam3_bridge.settings, "keep_models_warm", True)
    monkeypatch.setattr(sam3_bridge.settings, "gpu_slots", 2)
    monkeypatch.setattr(sam3_bridge, "_idle", [])
    _FakeSession.made = 0
    a, b = sam3_bridge.get_session(), sam3_bridge.get_session()
    assert a is not b and _FakeSession.made == 2  # parallel runs, parallel workers
    sam3_bridge.release_session(a)
    sam3_bridge.release_session(b)
    c = sam3_bridge.get_session()
    assert c in (a, b) and _FakeSession.made == 2  # warm worker reused
    sam3_bridge.release_session(c)
    extra = _FakeSession()
    sam3_bridge.release_session(extra)  # pool already holds gpu_slots workers
    assert extra.closed
