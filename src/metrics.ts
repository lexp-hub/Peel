/**
 * PEEL - Alpha Matting & Image Quality Metrics
 * Deterministic mathematical analysis of segmentation masks and edge gradients.
 */

import { ImageMetrics } from './types.js';

/**
 * Calculates GCD for aspect ratio simplification
 */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Formats width and height into simplified aspect ratio string (e.g. "16:9", "1:1")
 */
export function calculateAspectRatio(width: number, height: number): string {
  if (width <= 0 || height <= 0) return '1:1';
  const divisor = gcd(Math.round(width), Math.round(height));
  const w = Math.round(width / divisor);
  const h = Math.round(height / divisor);
  if (w > 32 || h > 32) {
    // If numbers are too odd, return decimal ratio
    return `${(width / height).toFixed(2)}:1`;
  }
  return `${w}:${h}`;
}

/**
 * Computes alpha matte statistics from an RGBA buffer or alpha channel array
 */
export function analyzeAlphaMetrics(
  alphaBuffer: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  rgbBuffer?: Uint8ClampedArray | Uint8Array
): ImageMetrics {
  const totalPixels = width * height;
  if (totalPixels <= 0 || alphaBuffer.length === 0) {
    return {
      width,
      height,
      megapixels: 0,
      aspectRatio: '1:1',
      foregroundRatio: 0,
      backgroundRatio: 100,
      edgeComplexity: 0,
      alphaEntropy: 0,
      colorSpillScore: 0,
      matteQualityGrade: 'Review',
    };
  }

  let foregroundCount = 0;
  let backgroundCount = 0;
  let semiTransparentCount = 0;
  let edgeTransitions = 0;

  // Histogram of 16 alpha bins for Shannon entropy
  const alphaBins = new Array(16).fill(0);

  // Check whether alphaBuffer is packed RGBA (length = 4 * totalPixels) or planar alpha (length = totalPixels)
  const isPackedRgba = alphaBuffer.length >= totalPixels * 4;
  const stride = isPackedRgba ? 4 : 1;
  const alphaOffset = isPackedRgba ? 3 : 0;

  for (let i = 0; i < totalPixels; i++) {
    const a = alphaBuffer[i * stride + alphaOffset];
    const binIndex = Math.min(15, Math.floor(a / 16));
    alphaBins[binIndex]++;

    if (a >= 250) {
      foregroundCount++;
    } else if (a <= 5) {
      backgroundCount++;
    } else {
      semiTransparentCount++;
    }
  }

  // Shannon Entropy of alpha channel (measures transition gradient depth)
  let alphaEntropy = 0;
  for (let i = 0; i < 16; i++) {
    if (alphaBins[i] > 0) {
      const p = alphaBins[i] / totalPixels;
      alphaEntropy -= p * Math.log2(p);
    }
  }
  // Max entropy for 16 bins is 4 bits. Normalize to 0-100 score.
  const normalizedEntropy = Math.min(100, Math.round((alphaEntropy / 4) * 100));

  // Edge complexity: measure 4-neighborhood boundary changes
  let boundaryPixels = 0;
  for (let y = 1; y < height - 1; y += 2) { // sample every other row for speed
    for (let x = 1; x < width - 1; x += 2) {
      const idx = (y * width + x) * stride + alphaOffset;
      const curr = alphaBuffer[idx] > 128 ? 1 : 0;

      const right = alphaBuffer[idx + stride] > 128 ? 1 : 0;
      const down = alphaBuffer[idx + width * stride] > 128 ? 1 : 0;

      if (curr !== right || curr !== down) {
        boundaryPixels++;
      }
    }
  }

  // Edge complexity index based on normalized perimeter to sqrt(area)
  const fgPixels = Math.max(1, foregroundCount);
  const rawComplexity = (boundaryPixels * 4) / Math.sqrt(fgPixels);
  const edgeComplexity = Math.min(100, Math.round(rawComplexity * 3.5));

  // Color spill risk: ratio of semi-transparent border pixels to total border
  const borderTotal = semiTransparentCount + boundaryPixels;
  let colorSpillScore = 0;
  if (borderTotal > 0) {
    const semiRatio = semiTransparentCount / Math.max(1, semiTransparentCount + foregroundCount * 0.1);
    colorSpillScore = Math.min(100, Math.round(semiRatio * 120));
  }

  const fgPercent = Math.round((foregroundCount / totalPixels) * 1000) / 10;
  const bgPercent = Math.round((backgroundCount / totalPixels) * 1000) / 10;
  const megapixels = Math.round((totalPixels / 1_000_000) * 100) / 100;

  // Compute Quality Grade
  let matteQualityGrade: ImageMetrics['matteQualityGrade'] = 'B';
  if (fgPercent > 5 && fgPercent < 95) {
    if (normalizedEntropy > 20 && normalizedEntropy < 75 && edgeComplexity < 60) {
      matteQualityGrade = 'A+';
    } else if (normalizedEntropy >= 10 && edgeComplexity < 80) {
      matteQualityGrade = 'A';
    } else {
      matteQualityGrade = 'B';
    }
  } else if (fgPercent <= 5 || fgPercent >= 98) {
    matteQualityGrade = 'Review';
  } else {
    matteQualityGrade = 'C';
  }

  return {
    width,
    height,
    megapixels,
    aspectRatio: calculateAspectRatio(width, height),
    foregroundRatio: fgPercent,
    backgroundRatio: bgPercent,
    edgeComplexity,
    alphaEntropy: normalizedEntropy,
    colorSpillScore,
    matteQualityGrade,
  };
}

