// Close narrow gaps in the foreground before flooding, protecting white stripes
// that touch the outline. Integral images keep both passes linear in image size.
function closeForeground(input: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const pass = (source: Uint8Array, dilate: boolean) => {
    const stride = width + 1, sum = new Int32Array(stride * (height + 1)), output = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      let row = 0;
      for (let x = 0; x < width; x++) { row += source[y * width + x]; sum[(y + 1) * stride + x + 1] = sum[y * stride + x + 1] + row; }
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius), right = Math.min(width, x + radius + 1), top = Math.max(0, y - radius), bottom = Math.min(height, y + radius + 1);
      const n = sum[bottom * stride + right] - sum[top * stride + right] - sum[bottom * stride + left] + sum[top * stride + left];
      output[y * width + x] = +(dilate ? n > 0 : n === (right - left) * (bottom - top));
    }
    return output;
  };
  return pass(pass(input, true), false);
}

/** Flood only background connected to the image border; enclosed print stays intact. */
export function removeBackground(pixels: Uint8ClampedArray, width: number, height: number, tolerance = 38): Uint8ClampedArray<ArrayBuffer> {
  const result = new Uint8ClampedArray(pixels), count = width * height;
  const seen = new Uint8Array(count), queue = new Int32Array(count);
  const buckets = new Map<number, { n: number; rgb: number[] }>();
  const border: number[] = [];
  for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x);
  for (let y = 1; y < height - 1; y++) border.push(y * width, y * width + width - 1);
  for (const p of border) {
    const i = p * 4; if (pixels[i + 3] < 20) continue;
    const key = (pixels[i] >> 5) * 64 + (pixels[i + 1] >> 5) * 8 + (pixels[i + 2] >> 5);
    const b = buckets.get(key) ?? { n: 0, rgb: [0, 0, 0] };
    b.n++; for (let c = 0; c < 3; c++) b.rgb[c] += pixels[i + c]; buckets.set(key, b);
  }
  const dominant = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
  if (!dominant) return result;
  const bg = dominant.rgb.map(c => c / dominant.n);
  const foreground = new Uint8Array(count);
  for (let p = 0; p < count; p++) {
    const i = p * 4;
    foreground[p] = +(pixels[i + 3] >= 20 && Math.hypot(pixels[i] - bg[0], pixels[i + 1] - bg[1], pixels[i + 2] - bg[2]) > tolerance);
  }
  const protectedPrint = closeForeground(foreground, width, height, Math.max(1, Math.floor(Math.min(width, height) * .02)));
  let head = 0, tail = 0;
  const visit = (p: number) => {
    if (seen[p]) return; seen[p] = 1;
    const i = p * 4;
    if (pixels[i + 3] < 20 || (!foreground[p] && !protectedPrint[p])) queue[tail++] = p;
  };
  border.forEach(visit);
  while (head < tail) {
    const p = queue[head++]; result[p * 4 + 3] = 0;
    if (p % width) visit(p - 1);
    if (p % width < width - 1) visit(p + 1);
    if (p >= width) visit(p - width);
    if (p < count - width) visit(p + width);
  }
  return result;
}

export function dominantColor(pixels: Uint8ClampedArray): string {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bin.n++; bin.r += r; bin.g += g; bin.b += b; bins.set(key, bin);
  }
  const best = [...bins.values()].sort((a, b) => b.n - a.n)[0];
  return best ? '#' + [best.r, best.g, best.b].map(c => Math.round(c / best.n).toString(16).padStart(2, '0')).join('') : '#b9b9b9';
}

export function foregroundBounds(pixels: Uint8ClampedArray, width: number, height: number) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3] > 32) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return right < left ? undefined : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export async function readPhoto(file: File): Promise<HTMLCanvasElement> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('JPEG・PNG・WebPの写真を選んでください。');
  if (file.size > 15 * 1024 * 1024) throw new Error('15 MB以下の写真を選んでください。');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('写真を読み込めませんでした。別の画像でお試しください。'); }
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close(); return canvas;
}
