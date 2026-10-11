/**
 * PEEL - Core Image Segmentation & Alpha Matting Engine
 * Multi-layer pipeline supporting Edge AI models, upstream rembg, and deterministic matting.
 */

import { PeelProcessingOptions, PeelResponse, ImageMetrics } from './types.js';
import { analyzeAlphaMetrics } from './metrics.js';

/**
 * Fast box blur on single-channel 8-bit alpha buffer (O(N) separable horizontal/vertical blur)
 */
export function boxBlurAlpha(
  alpha: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  if (radius <= 0) return new Uint8Array(alpha);
  const r = Math.min(Math.round(radius), 15);
  const out = new Uint8Array(alpha.length);
  const temp = new Uint8Array(alpha.length);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    let sum = 0;
    const windowSize = 2 * r + 1;

    for (let i = -r; i <= r; i++) {
      const x = Math.min(width - 1, Math.max(0, i));
      sum += alpha[rowOffset + x];
    }

    for (let x = 0; x < width; x++) {
      temp[rowOffset + x] = Math.round(sum / windowSize);
      const nextX = Math.min(width - 1, x + r + 1);
      const prevX = Math.max(0, x - r);
      sum += alpha[rowOffset + nextX] - alpha[rowOffset + prevX];
    }
  }

  // Vertical pass
  for (let x = 0; x < width; x++) {
    let sum = 0;
    const windowSize = 2 * r + 1;

    for (let i = -r; i <= r; i++) {
      const y = Math.min(height - 1, Math.max(0, i));
      sum += temp[y * width + x];
    }

    for (let y = 0; y < height; y++) {
      out[y * width + x] = Math.round(sum / windowSize);
      const nextY = Math.min(height - 1, y + r + 1);
      const prevY = Math.max(0, y - r);
      sum += temp[nextY * width + x] - temp[prevY * width + x];
    }
  }

  return out;
}

/**
 * Morphological dilation (>0) or erosion (<0) on 8-bit alpha buffer
 */
export function morphErodeDilate(
  alpha: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  delta: number
): Uint8Array {
  if (delta === 0) return new Uint8Array(alpha);
  const out = new Uint8Array(alpha.length);
  const steps = Math.min(Math.abs(delta), 8);
  const isDilate = delta > 0;

  let current = new Uint8Array(alpha);

  for (let s = 0; s < steps; s++) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        let val = current[idx];

        const x0 = Math.max(0, x - 1);
        const x1 = Math.min(width - 1, x + 1);
        const y0 = Math.max(0, y - 1);
        const y1 = Math.min(height - 1, y + 1);

        const neighbors = [
          current[y0 * width + x],
          current[y1 * width + x],
          current[y * width + x0],
          current[y * width + x1],
        ];

        if (isDilate) {
          for (const n of neighbors) {
            if (n > val) val = n;
          }
        } else {
          for (const n of neighbors) {
            if (n < val) val = n;
          }
        }
        next[idx] = val;
      }
    }
    current = next;
  }

  return current;
}

/**
 * Color Decontamination / Defringe: removes background color halo around boundary pixels
 */
export function defringeRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  strength: number = 40
): void {
  if (strength <= 0) return;
  const factor = Math.min(1, strength / 100);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const alpha = rgba[idx + 3];

      // Defringe only semi-transparent edge pixels
      if (alpha > 10 && alpha < 240) {
        // Search adjacent solid pixels (alpha >= 240)
        let rSum = 0, gSum = 0, bSum = 0, count = 0;

        const offsets = [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1];
        for (const off of offsets) {
          const nIdx = idx + off * 4;
          if (rgba[nIdx + 3] >= 240) {
            rSum += rgba[nIdx];
            gSum += rgba[nIdx + 1];
            bSum += rgba[nIdx + 2];
            count++;
          }
        }

        if (count > 0) {
          const avgR = rSum / count;
          const avgG = gSum / count;
          const avgB = bSum / count;

          rgba[idx] = Math.round(rgba[idx] * (1 - factor) + avgR * factor);
          rgba[idx + 1] = Math.round(rgba[idx + 1] * (1 - factor) + avgG * factor);
          rgba[idx + 2] = Math.round(rgba[idx + 2] * (1 - factor) + avgB * factor);
        }
      }
    }
  }
}

/**
 * Heuristic saliency & background boundary segmentation (Offline zero-dependency mode)
 * Uses corner background color sampling, Otsu variance, and center-weighted Euclidean distance.
 */
export function heuristicSegmentImage(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const total = width * height;
  const mask = new Uint8Array(total);

  // Sample corner background colors (top-left, top-right, bottom-left, bottom-right)
  const corners = [
    0, // top-left
    width - 1, // top-right
    (height - 1) * width, // bottom-left
    total - 1 // bottom-right
  ];

  let bgR = 0, bgG = 0, bgB = 0;
  for (const c of corners) {
    const idx = c * 4;
    bgR += rgba[idx];
    bgG += rgba[idx + 1];
    bgB += rgba[idx + 2];
  }
  bgR /= 4;
  bgG /= 4;
  bgB /= 4;

  const centerX = width / 2;
  const centerY = height / 2;
  const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];

      // Color distance from background corners
      const dr = r - bgR;
      const dg = g - bgG;
      const db = b - bgB;
      const colorDist = Math.sqrt(dr * dr + dg * dg + db * db); // 0 - ~441

      // Center bias (subjects usually near center)
      const dx = (x - centerX);
      const dy = (y - centerY);
      const distFromCenter = Math.sqrt(dx * dx + dy * dy);
      const centerFactor = 1.0 - (distFromCenter / maxDist) * 0.45;

      const score = (colorDist / 441) * 255 * centerFactor;

      // Soft sigmoid thresholding
      if (score > 65) {
        mask[y * width + x] = Math.min(255, Math.round((score - 65) * 3.5));
      } else {
        mask[y * width + x] = 0;
      }
    }
  }

  return mask;
}

/**
 * Handles upstream Rembg / Python microservice if configured
 */
export async function peelViaRembgService(
  imageBuffer: ArrayBuffer,
  endpointUrl: string
): Promise<{ success: boolean; data?: ArrayBuffer; error?: string }> {
  try {
    const formData = new FormData();
    formData.append('file', new Blob([imageBuffer], { type: 'image/png' }), 'image.png');

    const res = await fetch(endpointUrl, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      return { success: false, error: `Upstream Rembg returned HTTP ${res.status}: ${await res.text()}` };
    }

    const data = await res.arrayBuffer();
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed connecting to upstream Rembg backend' };
  }
}

/**
 * Handles HuggingFace Inference API with RMBG-1.4 or BiRefNet
 */
export async function peelViaHuggingFace(
  imageBuffer: ArrayBuffer,
  apiKey: string,
  modelName: string = 'briaai/RMBG-1.4'
): Promise<{ success: boolean; data?: ArrayBuffer; error?: string }> {
  try {
    const res = await fetch(`https://api-inference.huggingface.co/models/${modelName}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/octet-stream',
      },
      body: imageBuffer,
    });

    if (!res.ok) {
      return { success: false, error: `HuggingFace API returned ${res.status}: ${await res.text()}` };
    }

    const data = await res.arrayBuffer();
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'HuggingFace inference failed' };
  }
}

