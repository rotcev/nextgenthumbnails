import sharp from 'sharp';

export type MaskPolygon = {
  label: string;
  points: Array<{ xPct: number; yPct: number }>;
};

export async function buildEditMaskPng(args: {
  width: number;
  height: number;
  polygons: MaskPolygon[];
  includeLabel: (label: string) => boolean;
}): Promise<Buffer> {
  const { width, height, polygons, includeLabel } = args;
  if (!width || !height || width <= 0 || height <= 0) {
    throw new Error('Invalid mask dimensions');
  }

  // Default: fully opaque (protected). Transparent (alpha=0) means editable (per OpenAI mask docs).
  const rgba = Buffer.alloc(width * height * 4, 0);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4 + 3] = 255;
  }

  const polys = polygons.filter((p) =>
    includeLabel(String(p.label ?? '').trim()),
  );
  for (const p of polys) {
    const pts = (p.points ?? [])
      .map((pt) => ({
        x: clampInt(Math.round((Number(pt.xPct) / 100) * width), 0, width - 1),
        y: clampInt(
          Math.round((Number(pt.yPct) / 100) * height),
          0,
          height - 1,
        ),
      }))
      .filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y));
    if (pts.length < 3) continue;
    fillPolygonAlpha({ rgba, width, height, points: pts, alpha: 0 });
  }

  // PNG must be <4MB; use good compression. Alpha is the only important channel.
  return await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

export async function buildTextGlyphEditMaskPng(args: {
  width: number;
  height: number;
  templateImageAbsPath: string;
  polygons: MaskPolygon[];
  includeLabel: (label: string) => boolean;
}): Promise<Buffer> {
  const { width, height, templateImageAbsPath, polygons, includeLabel } = args;
  if (!width || !height || width <= 0 || height <= 0) {
    throw new Error('Invalid mask dimensions');
  }

  // Start by marking the entire text polygon(s) as editable, then shrink it down to
  // only the high-frequency (glyph/stroke/shadow) pixels found in the current base image.
  // This prevents the model from repainting the whole banner block (e.g. adding black panels).
  const rgba = Buffer.alloc(width * height * 4, 0);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4 + 3] = 255;
  }

  const polys = polygons.filter((p) =>
    includeLabel(String(p.label ?? '').trim()),
  );
  for (const p of polys) {
    const pts = (p.points ?? [])
      .map((pt) => ({
        x: clampInt(Math.round((Number(pt.xPct) / 100) * width), 0, width - 1),
        y: clampInt(
          Math.round((Number(pt.yPct) / 100) * height),
          0,
          height - 1,
        ),
      }))
      .filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y));
    if (pts.length < 3) continue;

    // 1) Make the full polygon editable.
    fillPolygonAlpha({ rgba, width, height, points: pts, alpha: 0 });

    // 2) Compute a "text glyph" mask inside the polygon bounds using a high-frequency detector
    // (difference vs blurred image) and then intersect with the polygon area.
    const bounds = polygonBounds(pts, width, height, 6);
    if (!bounds) continue;

    const { left, top, boxW, boxH } = bounds;
    const { data: orig } = await sharp(templateImageAbsPath)
      .ensureAlpha()
      .extract({ left, top, width: boxW, height: boxH })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { data: blurred } = await sharp(templateImageAbsPath)
      .ensureAlpha()
      .extract({ left, top, width: boxW, height: boxH })
      .blur(6)
      .raw()
      .toBuffer({ resolveWithObject: true });

    const edge = new Uint8Array(boxW * boxH);
    // Threshold tuned for 8-bit RGBA diffs; keep conservative.
    const threshold = 26;
    for (let y = 0; y < boxH; y++) {
      for (let x = 0; x < boxW; x++) {
        const i = (y * boxW + x) * 4;
        const d =
          Math.abs(orig[i + 0] - blurred[i + 0]) +
          Math.abs(orig[i + 1] - blurred[i + 1]) +
          Math.abs(orig[i + 2] - blurred[i + 2]);
        if (d >= threshold) edge[y * boxW + x] = 1;
      }
    }

    const grown = dilate(edge, boxW, boxH, 3);

    // Intersect: only keep pixels editable if they are inside the polygon (alpha=0)
    // AND in the detected glyph neighborhood.
    for (let y = 0; y < boxH; y++) {
      for (let x = 0; x < boxW; x++) {
        if (grown[y * boxW + x]) continue;
        const ax = left + x;
        const ay = top + y;
        const aIdx = (ay * width + ax) * 4 + 3;
        if (rgba[aIdx] === 0) rgba[aIdx] = 255;
      }
    }
  }

  return await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

function fillPolygonAlpha(args: {
  rgba: Buffer;
  width: number;
  height: number;
  points: Array<{ x: number; y: number }>;
  alpha: number;
}) {
  const { rgba, width, height, points, alpha } = args;

  // Scanline fill algorithm:
  // For each row, find intersections of polygon edges with the scanline and fill between pairs.
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  minY = clampInt(minY, 0, height - 1);
  maxY = clampInt(maxY, 0, height - 1);

  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];

      // Skip horizontal edges.
      if (a.y === b.y) continue;

      // Include edges where y is in [minY, maxY), using half-open to avoid double counting vertices.
      const yMin = Math.min(a.y, b.y);
      const yMax = Math.max(a.y, b.y);
      if (y < yMin || y >= yMax) continue;

      const t = (y - a.y) / (b.y - a.y);
      const x = a.x + t * (b.x - a.x);
      intersections.push(x);
    }

    if (intersections.length < 2) continue;
    intersections.sort((m, n) => m - n);

    for (let k = 0; k < intersections.length - 1; k += 2) {
      const x0 = clampInt(Math.ceil(intersections[k]), 0, width - 1);
      const x1 = clampInt(Math.floor(intersections[k + 1]), 0, width - 1);
      if (x1 < x0) continue;
      for (let x = x0; x <= x1; x++) {
        rgba[(y * width + x) * 4 + 3] = alpha;
      }
    }
  }
}

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n | 0));
}

function polygonBounds(
  points: Array<{ x: number; y: number }>,
  width: number,
  height: number,
  padPx: number,
): { left: number; top: number; boxW: number; boxH: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  const left = clampInt(minX - padPx, 0, width - 1);
  const top = clampInt(minY - padPx, 0, height - 1);
  const right = clampInt(maxX + padPx, 0, width - 1);
  const bottom = clampInt(maxY + padPx, 0, height - 1);
  const boxW = Math.max(1, right - left + 1);
  const boxH = Math.max(1, bottom - top + 1);
  return { left, top, boxW, boxH };
}

function dilate(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return src;
  const out = new Uint8Array(src.length);
  const r = radius | 0;
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height - 1, y + r);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width - 1, x + r);
      let on = 0;
      for (let yy = y0; yy <= y1 && !on; yy++) {
        const row = yy * width;
        for (let xx = x0; xx <= x1; xx++) {
          if (src[row + xx]) {
            on = 1;
            break;
          }
        }
      }
      out[y * width + x] = on;
    }
  }
  return out;
}
