/**
 * PEEL - Core TypeScript Type Definitions
 */

export interface ImageMetrics {
  width: number;
  height: number;
  megapixels: number;
  aspectRatio: string;
  foregroundRatio: number;      // Percentage of pixels that are foreground (0 - 100%)
  backgroundRatio: number;      // Percentage of pixels that are background (0 - 100%)
  edgeComplexity: number;       // Ratio measuring perimeter detail / hair / fur complexity (0 - 100)
  alphaEntropy: number;         // Transition sharpness vs gradient matting softness (0 - 100)
  colorSpillScore: number;      // Risk score for color halos/fringing on edges (0 - 100)
  matteQualityGrade: 'A+' | 'A' | 'B' | 'C' | 'Review';
}

export interface PeelProcessingOptions {
  threshold?: number;           // Binary mask cutoff (0 - 100, default 50)
  feather?: number;             // Edge gaussian feathering radius in px (0 - 20, default 1)
  defringe?: number;            // Color decontamination strength (0 - 100, default 40)
  expand?: number;              // Mask erosion (< 0) or dilation (> 0) in px (-10 to +10, default 0)
  invert?: boolean;             // Invert foreground/background selection
  backgroundColor?: string;     // 'transparent' or hex code (#ffffff, #000000, etc.)
  format?: 'png' | 'webp' | 'mask'; // Export format
  mode?: 'client-webgpu' | 'client-wasm' | 'server-rembg' | 'server-huggingface' | 'heuristic';
}

export interface PeelResponse {
  success: boolean;
  error?: string;
  image?: string;               // Resulting image (data URL or relative URL)
  mask?: string;                // Alpha mask binary/grayscale data URL
  metrics?: ImageMetrics;
  timing?: {
    totalMs: number;
    inferenceMs?: number;
    postProcessMs?: number;
  };
  engine?: string;
}

export interface PeelConfig {
  port?: number;
  rembgBackendUrl?: string;
  huggingFaceApiKey?: string;
}
