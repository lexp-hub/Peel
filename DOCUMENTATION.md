# PEEL — ARCHITECTURE & TECHNICAL DOCUMENTATION
# Minimalist, privacy-first AI background remover & matting studio running standalone on Node.js & on-device WebGPU.

================================================================================
TABLE OF CONTENTS
================================================================================
1. High-Level Overview & Philosophy
2. Core Pipeline & Execution Flow
3. Vision Models & Inference Strategy
4. Manual Mask Refinement Suite (Pen, Lasso, Magic Pen)
5. Studio Matting Algorithms & Mathematical Formulations
6. Telemetry & Quality Metrics Framework
7. Headless API Reference
8. Standalone Deployment & Configuration

================================================================================
1. HIGH-LEVEL OVERVIEW & PHILOSOPHY
================================================================================
Peel is engineered to eliminate cloud vendor lock-in, recurring subscriptions,
and privacy risks from background removal workflows.

Key Architecture Characteristics:
- Dual execution paradigm:
  * Client-first on-device acceleration: WebGPU/WASM running RMBG-1.4 or BiRefNet directly
    inside the browser sandbox. Images never traverse external networks.
  * Standalone Node.js HTTP server: Zero-dependency local backend for automated shell
    scripts, cURL pipelines, and server-side automation.
- Zero external runtime dependencies: Built using native Node.js HTTP and HTML5 Canvas 2D.
- Interactive fine-tuning at 60 FPS: Once the initial neural segmentation mask is computed,
  all alpha matting post-processing (feathering, threshold clipping, color decontamination,
  and background compositing) occurs in real time without re-running the neural model.

================================================================================
2. CORE PIPELINE & EXECUTION FLOW
================================================================================
When an image is submitted to Peel, it flows through four deterministic phases:

[Input Image]
      │
      ▼
┌────────────────────────────────────────────────────────┐
│ Phase 1: Neural Segmentation & Probability Field       │
│ • Model inference (RMBG-1.4 or BiRefNet)               │
│ • Generates single-channel 8-bit or float32 mask       │
│   representing foreground probability per pixel        │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ Phase 2: Manual Mask Refinement (Optional)             │
│ • Pen: pixel-precision erase or restore brush          │
│ • Lasso: freehand polygon loop cutter                  │
│ • Magic Pen: color-tolerance Euclidean flood wand      │
│ • Multi-step Undo & Reset history                      │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ Phase 3: Morphological & Threshold Filtering           │
│ • Adjustable threshold clipping [0.7*th, 1.3*th]       │
│ • Horizontal & vertical separable box blur feathering  │
│ • Boundary erosion (contract) or dilation (expand)     │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ Phase 4: Edge Decontamination & Defringing             │
│ • Detects semi-transparent boundary pixels (10 < a < 240)│
│ • Samples neighboring solid foreground chromaticity    │
│ • Clamps color halo bleeding from original background  │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ Phase 5: Compositing & Telemetry                       │
│ • Alpha compositing onto selected backdrop (OLED black,│
│   pure white, custom hex, or Gaussian bokeh blur)      │
│ • Real-time computation of Shannon alpha entropy,      │
│   foreground coverage %, and edge complexity index     │
└────────────────────────────────────────────────────────┘

================================================================================
3. VISION MODELS & INFERENCE STRATEGY
================================================================================
Peel supports multiple inference engines according to device capability:

1. RMBG-1.4 (Bria AI) [Default Client Mode]:
   - Specially trained high-resolution salient object segmentation.
   - Resolution: 1024x1024 internal tensor with bilinear interpolation back to original.
   - Execution: On-device WebGPU with automatic fallback to WebAssembly (WASM with SIMD).
   - Speed: Typically 80-250 ms on modern integrated/dedicated GPUs.

2. BiRefNet (General):
   - Bilateral Reference Network for high-resolution dichromatic matting.
   - Best for intricate subjects: fine hair strands, transparent veils, fur, lace.

3. Offline Heuristic Saliency (0 ms Latency):
   - Deterministic algorithm executing instantly with zero model weights.
   - Samples Euclidean color distances from image corners and combines with center-weighted
     elliptical saliency bias.

4. Headless Server Mode (/api/peel):
   - Handles headless requests from curl, node, and python.
   - Supports upstream proxies to self-hosted Rembg containers (`REMBG_BACKEND_URL`)
     or HuggingFace Inference API (`HUGGINGFACE_API_KEY`).

================================================================================
4. MANUAL MASK REFINEMENT SUITE
================================================================================
- Pen (Brush):
  Raster circle stamp applying binary 0 (Erase) or 255 (Restore) directly to mask buffer.
  Radius: 2px to 80px.
- Lasso:
  Freehand polygon path. On mouse-up, the path is rasterized via 2D canvas and stamped
  into the mask buffer.
- Magic Pen (Wand):
  Four-way queue-based flood fill with 3D RGB Euclidean color distance:
    Distance = sqrt((r - tr)^2 + (g - tg)^2 + (b - tb)^2)
  Thresholded against user tolerance percentage (max distance = 441.67).
- Undo Stack:
  Maintains up to 10 historical snapshots of the mask array for non-destructive edits.

================================================================================
5. STUDIO MATTING ALGORITHMS & MATHEMATICAL FORMULATIONS
================================================================================

A. Threshold Sigmoid Mapping:
   Given probability map P(x, y) in [0, 255] and user threshold T in [0, 255]:
     lowerBound = T * 0.7
     upperBound = T * 1.3
     If P(x, y) < lowerBound => Alpha(x, y) = 0
     If P(x, y) > upperBound => Alpha(x, y) = 255
     Else => Alpha(x, y) = round(((P - lowerBound) / (upperBound - lowerBound)) * 255)

B. Separable Box Blur Feathering (O(N) Per Dimension):
   Approximates Gaussian smoothing across the alpha channel with a separable sliding
   accumulator of window size W = 2*r + 1:
     Horizontal:
       Accum(x) = Accum(x-1) + Alpha(x + r) - Alpha(x - r - 1)
       Temp(x) = Accum(x) / W
     Vertical:
       Accum(y) = Accum(y-1) + Temp(y + r) - Temp(y - r - 1)
       Out(y) = Accum(y) / W

C. Color Decontamination (Defringe):
   For any pixel p where 10 < Alpha(p) < 240:
     Sample 8-connected solid foreground neighbors N = { q | Alpha(q) >= 240 }
     Compute mean chromatic vector:
       C_fg = (1 / |N|) * sum(Color(q))
     Blend edge color:
       Color(p)' = (1 - factor) * Color(p) + factor * C_fg

================================================================================
6. TELEMETRY & QUALITY METRICS FRAMEWORK
================================================================================
- Megapixels & Resolution: Width x Height / 1,000,000.
- Foreground Coverage Ratio: (Sum(Alpha >= 250) / TotalPixels) * 100%.
- Shannon Alpha Entropy:
    Bins = 16 uniform intervals across [0, 255]
    H = - sum(p_i * log2(p_i)) for i in 1..16
    NormalizedEntropy = min(100, round((H / 4) * 100))
- Edge Complexity Score:
  Normalized ratio of semi-transparent and boundary transition pixels relative to
  foreground surface area.
- Quality Grading:
  * [A+] Pristine: Rich transition entropy (15-75), low fringe risk, clean contours.
  * [A]  High Quality: Clean subject separation with minimal border artifacts.
  * [B]  Standard: Slight edge aliasing.

================================================================================
7. HEADLESS API REFERENCE
================================================================================

POST /api/peel (or /api/remove-bg)
Removes background and returns transparent PNG.

Headers:
- Content-Type: multipart/form-data | application/json | image/*
- Accept: image/png | application/json

GET /api/health
Returns server status and available engine capabilities.

================================================================================
8. STANDALONE DEPLOYMENT & CONFIGURATION
================================================================================

Start Server:
```bash
npm start
# Server listens on http://localhost:8788
```

Environment Variables (`.env`):
- `PORT`: Server port (default: 8788)
- `REMBG_BACKEND_URL`: Optional URL to a self-hosted Python Rembg container
- `HUGGINGFACE_API_KEY`: Optional HuggingFace inference API token

================================================================================
EOF
