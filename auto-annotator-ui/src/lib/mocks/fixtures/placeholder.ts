/**
 * Deterministic, offline SVG placeholder images (data URIs) so the mock UI
 * never depends on the network. Replaced by real image URLs once the backend
 * serves generated/uploaded files.
 */
export function placeholderImage(
  seed: number,
  label: string,
  width = 640,
  height = 480,
): string {
  // Golden-angle hue walk gives well-separated colors for consecutive seeds.
  const hue = Math.round((seed * 137.508) % 360);
  const bg = `hsl(${hue} 22% 16%)`;
  const box = `hsl(${(hue + 40) % 360} 60% 45%)`;

  // A fake "object" rectangle so bbox overlays have something plausible under them.
  const rx = 0.2 + (seed % 5) * 0.08;
  const ry = 0.25 + (seed % 4) * 0.09;
  const rw = 0.3 + (seed % 3) * 0.1;
  const rh = 0.28 + (seed % 3) * 0.08;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${bg}"/>` +
    `<rect x="${Math.round(rx * width)}" y="${Math.round(ry * height)}" width="${Math.round(rw * width)}" height="${Math.round(rh * height)}" rx="8" fill="${box}" opacity="0.85"/>` +
    `<text x="12" y="${height - 14}" font-family="monospace" font-size="16" fill="rgba(255,255,255,0.55)">${label}</text>` +
    `</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
