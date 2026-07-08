"""Pure-numpy geometry vs known ground truths (no cv2 anywhere).

Run:  .venv\\Scripts\\python -m pytest tests/test_geometry.py -q
"""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agents.geometry import (  # noqa: E402
    bounding_rect,
    convex_hull,
    mask_to_polygon,
    min_area_rect_corners,
    perimeter,
    simplify_closed,
)


def test_bounding_rect_exact():
    pts = [(10, 20), (30, 25), (15, 60), (12, 22)]
    assert bounding_rect(pts) == (10.0, 20.0, 20.0, 40.0)


def test_perimeter_square():
    square = [(0, 0), (10, 0), (10, 10), (0, 10)]
    assert perimeter(square) == pytest.approx(40.0)


def test_simplify_closed_recovers_square_corners():
    # A square densely sampled along its edges must simplify back to ~4 pts.
    edges = []
    for a, b in [((0, 0), (100, 0)), ((100, 0), (100, 100)),
                 ((100, 100), (0, 100)), ((0, 100), (0, 0))]:
        for t in np.linspace(0, 1, 50, endpoint=False):
            edges.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    simplified = simplify_closed(np.array(edges), epsilon=1.0)
    assert len(simplified) <= 6
    for corner in [(0, 0), (100, 0), (100, 100), (0, 100)]:
        dists = np.hypot(simplified[:, 0] - corner[0], simplified[:, 1] - corner[1])
        assert dists.min() < 2.0, f"corner {corner} lost"


def test_convex_hull_square_with_interior_points():
    pts = [(0, 0), (10, 0), (10, 10), (0, 10), (5, 5), (2, 7), (9, 1)]
    hull = convex_hull(pts)
    assert len(hull) == 4
    assert {tuple(p) for p in hull} == {(0, 0), (10, 0), (10, 10), (0, 10)}


def _polygon_area(corners: np.ndarray) -> float:
    x, y = corners[:, 0], corners[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))


def test_min_area_rect_axis_aligned():
    pts = [(0, 0), (40, 0), (40, 20), (0, 20), (10, 10)]
    corners = min_area_rect_corners(pts)
    assert _polygon_area(corners) == pytest.approx(800.0, rel=1e-6)


def test_min_area_rect_rotated_beats_aabb():
    # A thin bar at 45°: the rotated rect is far smaller than the AABB.
    t = np.linspace(0, 100, 60)
    bar = np.stack([t, t], axis=1)
    bar = np.vstack([bar + (0, 3), bar - (0, 3)])  # width ~ 3*sqrt(2)... px
    corners = min_area_rect_corners(bar)
    area = _polygon_area(corners)
    x, y, w, h = bounding_rect(bar)
    aabb_area = w * h
    assert area < aabb_area * 0.25
    # All input points inside (or on) the rect: area test via triangulation
    # is overkill — check distances from center along the rect's axes.
    center = corners.mean(axis=0)
    ax1 = corners[1] - corners[0]
    ax2 = corners[3] - corners[0]
    for axis in (ax1, ax2):
        half = np.hypot(*axis) / 2 + 1e-6
        unit = axis / np.hypot(*axis)
        proj = np.abs((bar - center) @ unit)
        assert proj.max() <= half + 1e-4


def test_mask_to_polygon_rectangle():
    mask = np.zeros((60, 80), dtype=bool)
    mask[10:40, 20:70] = True  # 30 x 50 rectangle
    poly = mask_to_polygon(mask)
    assert poly is not None
    x, y, w, h = bounding_rect(poly)
    assert (x, y) == (20.0, 10.0)
    assert (w, h) == (49.0, 29.0)  # pixel-center corners span n-1


def test_mask_to_polygon_picks_largest_blob():
    mask = np.zeros((50, 50), dtype=bool)
    mask[2:6, 2:6] = True        # small blob
    mask[10:45, 10:45] = True    # big blob
    poly = mask_to_polygon(mask)
    x, y, w, h = bounding_rect(poly)
    assert x >= 10 and y >= 10, "traced the small blob instead of the largest"


def test_mask_to_polygon_disc_perimeter_sane():
    yy, xx = np.mgrid[0:100, 0:100]
    disc = (xx - 50) ** 2 + (yy - 50) ** 2 <= 30**2
    poly = mask_to_polygon(disc)
    assert poly is not None
    # Boundary length of a rasterized disc ≈ 2πr within tracing tolerance.
    assert perimeter(poly) == pytest.approx(2 * np.pi * 30, rel=0.25)
    x, y, w, h = bounding_rect(poly)
    assert w == pytest.approx(60, abs=2) and h == pytest.approx(60, abs=2)


def test_mask_to_polygon_empty_and_single():
    assert mask_to_polygon(np.zeros((10, 10), dtype=bool)) is None
    single = np.zeros((10, 10), dtype=bool)
    single[4, 7] = True
    poly = mask_to_polygon(single)
    assert poly is not None and tuple(poly[0]) == (7.0, 4.0)
