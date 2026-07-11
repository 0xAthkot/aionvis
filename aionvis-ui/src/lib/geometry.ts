/**
 * Minimal 2D geometry for the dataset "model output" view: derive the
 * rotated box an OBB run trains on from a stored mask contour — the same
 * min-area-rectangle (convex hull + rotating calipers) the backend's
 * dataset compiler uses, so the preview matches the training label.
 */
type Pt = [number, number];

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Monotone-chain convex hull, counter-clockwise, no duplicate endpoint. */
export function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 2) return pts;
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * Minimum-area rotated rectangle around a flat normalized polygon
 * [x1, y1, x2, y2, …]. Returns the 4 corners flattened the same way, or
 * null when the contour is degenerate. `aspect` (width/height of the
 * image) unskews the rotation math for non-square images.
 */
export function minAreaRect(flat: number[], aspect = 1): number[] | null {
  if (flat.length < 6) return null;
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2)
    pts.push([flat[i] * aspect, flat[i + 1]]);
  const hull = convexHull(pts);
  if (hull.length < 3) return null;

  let best: { area: number; corners: Pt[] } | null = null;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % hull.length];
    const ex = x2 - x1, ey = y2 - y1;
    const len = Math.hypot(ex, ey);
    if (len === 0) continue;
    const ux = ex / len, uy = ey / len;   // edge direction
    const vx = -uy, vy = ux;              // normal
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [px, py] of hull) {
      const u = px * ux + py * uy;
      const v = px * vx + py * vy;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      best = {
        area,
        corners: [
          [minU * ux + minV * vx, minU * uy + minV * vy],
          [maxU * ux + minV * vx, maxU * uy + minV * vy],
          [maxU * ux + maxV * vx, maxU * uy + maxV * vy],
          [minU * ux + maxV * vx, minU * uy + maxV * vy],
        ],
      };
    }
  }
  if (!best) return null;
  return best.corners.flatMap(([x, y]) => [x / aspect, y]);
}
