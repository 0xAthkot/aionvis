"""Pure-array geometry for the swarm — no OpenCV.

The agents' intelligence is the models (diffusion, open-vocab segmentation,
the Gemma VLM critic); the verification math is just math, and it lives
here as plain numpy so no first-party code imports cv2. (opencv-python
still ships transitively with ultralytics — do not import it.)

Replaces, 1:1:
  cv2.boundingRect            -> bounding_rect (float, no int snapping)
  cv2.arcLength               -> perimeter
  cv2.approxPolyDP            -> simplify_closed (Ramer–Douglas–Peucker)
  cv2.minAreaRect + boxPoints -> min_area_rect_corners (rotating calipers)
  cv2.findContours            -> mask_to_polygon (Moore-neighbor tracing)
"""

import numpy as np


def bounding_rect(points) -> tuple[float, float, float, float]:
    """Tight axis-aligned (x, y, w, h) around a point set."""
    pts = np.asarray(points, dtype=np.float32).reshape(-1, 2)
    x1, y1 = pts.min(axis=0)
    x2, y2 = pts.max(axis=0)
    return float(x1), float(y1), float(x2 - x1), float(y2 - y1)


def perimeter(points) -> float:
    """Closed-contour arc length."""
    pts = np.asarray(points, dtype=np.float32).reshape(-1, 2)
    if len(pts) < 2:
        return 0.0
    seg = np.diff(np.vstack([pts, pts[:1]]), axis=0)
    return float(np.hypot(seg[:, 0], seg[:, 1]).sum())


def _point_line_dist(pts: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    ab = b - a
    length = float(np.hypot(ab[0], ab[1]))
    if length < 1e-9:
        return np.hypot(pts[:, 0] - a[0], pts[:, 1] - a[1])
    cross = np.abs((pts[:, 0] - a[0]) * ab[1] - (pts[:, 1] - a[1]) * ab[0])
    return cross / length


def _rdp(pts: np.ndarray, epsilon: float) -> np.ndarray:
    """Ramer–Douglas–Peucker on an open chain (iterative, no recursion cap)."""
    n = len(pts)
    if n < 3:
        return pts
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        dists = _point_line_dist(pts[a + 1 : b], pts[a], pts[b])
        i = int(np.argmax(dists))
        if dists[i] > epsilon:
            mid = a + 1 + i
            keep[mid] = True
            stack.append((a, mid))
            stack.append((mid, b))
    return pts[keep]


def simplify_closed(points, epsilon: float) -> np.ndarray:
    """RDP for a closed contour: split at the vertex farthest from the
    start so the wrap-around edge can also be simplified."""
    pts = np.asarray(points, dtype=np.float32).reshape(-1, 2)
    if len(pts) < 4:
        return pts
    far = int(np.argmax(np.hypot(pts[:, 0] - pts[0, 0], pts[:, 1] - pts[0, 1])))
    if far == 0:
        return pts[:1]
    first = _rdp(pts[: far + 1], epsilon)
    second = _rdp(np.vstack([pts[far:], pts[:1]]), epsilon)
    return np.vstack([first[:-1], second[:-1]])


def convex_hull(points) -> np.ndarray:
    """Andrew's monotone chain, counter-clockwise, no collinear points."""
    pts = np.unique(np.asarray(points, dtype=np.float64).reshape(-1, 2), axis=0)
    if len(pts) <= 2:
        return pts
    order = np.lexsort((pts[:, 1], pts[:, 0]))
    pts = pts[order]

    def build(seq: np.ndarray) -> list[np.ndarray]:
        chain: list[np.ndarray] = []
        for p in seq:
            while len(chain) >= 2:
                u = chain[-1] - chain[-2]
                v = p - chain[-2]
                if u[0] * v[1] - u[1] * v[0] > 0:  # strict left turn: keep
                    break
                chain.pop()
            chain.append(p)
        return chain

    lower = build(pts)
    upper = build(pts[::-1])
    return np.array(lower[:-1] + upper[:-1])


def min_area_rect_corners(points) -> np.ndarray:
    """4 corners (float32, (4, 2)) of the minimum-area rotated rectangle:
    rotating calipers — the optimal rectangle shares an edge direction with
    the convex hull."""
    pts = np.asarray(points, dtype=np.float64).reshape(-1, 2)
    hull = convex_hull(pts)
    if len(hull) < 3:
        x, y, w, h = bounding_rect(pts)
        return np.array(
            [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], dtype=np.float32
        )
    best: tuple[float, np.ndarray, float, float, float, float] | None = None
    for i in range(len(hull)):
        edge = hull[(i + 1) % len(hull)] - hull[i]
        length = float(np.hypot(edge[0], edge[1]))
        if length < 1e-12:
            continue
        ux, uy = edge / length
        rot = np.array([[ux, uy], [-uy, ux]])  # world -> edge frame
        proj = hull @ rot.T
        x1, y1 = proj.min(axis=0)
        x2, y2 = proj.max(axis=0)
        area = (x2 - x1) * (y2 - y1)
        if best is None or area < best[0]:
            best = (float(area), rot, float(x1), float(y1), float(x2), float(y2))
    assert best is not None
    _, rot, x1, y1, x2, y2 = best
    frame_corners = np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]])
    return (frame_corners @ rot).astype(np.float32)  # rot is orthonormal


# Moore neighborhood, clockwise starting east.
_MOORE = np.array(
    [(0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1), (-1, 0), (-1, 1)]
)


def mask_to_polygon(mask, max_steps: int = 100_000) -> np.ndarray | None:
    """Outer boundary of the largest connected blob in a binary mask, as an
    ordered (N, 2) polygon in (x, y) pixel coords — Moore-neighbor tracing
    over scipy-labeled components. None for an empty mask."""
    from scipy import ndimage  # ships with ultralytics' dependency set

    grid = np.asarray(mask).astype(bool)
    if not grid.any():
        return None
    labels, count = ndimage.label(grid)
    if count > 1:
        sizes = ndimage.sum_labels(grid, labels, index=np.arange(1, count + 1))
        grid = labels == (int(np.argmax(sizes)) + 1)

    # Topmost-then-leftmost pixel: a canonical start on the outer boundary.
    rows, cols = np.nonzero(grid)  # row-major: rows[0] is the top row
    start = (int(rows[0]), int(cols[rows == rows[0]].min()))

    h, w = grid.shape

    def on(p: tuple[int, int]) -> bool:
        return 0 <= p[0] < h and 0 <= p[1] < w and grid[p]

    contour = [start]
    # Pretend we entered the start moving SE: the clockwise scan then
    # begins at N, which is guaranteed off-blob for a topmost-leftmost start.
    prev_dir = 1
    cur = start
    for _ in range(max_steps):
        # The previous pixel sits opposite the movement direction; scan
        # clockwise starting just past it.
        found = False
        for k in range(8):
            d = (prev_dir + 5 + k) % 8
            nxt = (cur[0] + _MOORE[d][0], cur[1] + _MOORE[d][1])
            if on(nxt):
                if nxt == start and len(contour) > 2:
                    return np.array(
                        [(c[1], c[0]) for c in contour], dtype=np.float32
                    )
                contour.append(nxt)
                cur = nxt
                prev_dir = d
                found = True
                break
        if not found:  # isolated single pixel
            return np.array([(c[1], c[0]) for c in contour], dtype=np.float32)
    return np.array([(c[1], c[0]) for c in contour], dtype=np.float32)
