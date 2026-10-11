/**
 * PEEL - Standalone HTTP Server Entry Point
 * Zero external cloud dependencies. Runs directly on Node.js.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import { renderDashboardHTML } from './ui.js';
import { analyzeAlphaMetrics } from './metrics.js';
import {
  peelViaRembgService,
  peelViaHuggingFace,
} from './engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let currentPort = parseInt(process.env.PORT || '3000', 10);
const REMBG_BACKEND_URL = process.env.REMBG_BACKEND_URL || '';
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY || '';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    });
    res.end();
    return;
  }

  // Base CORS headers
  const setCors = (headers: Record<string, string> = {}) => {
    return {
      'Access-Control-Allow-Origin': '*',
      ...headers,
    };
  };

  // 1. Dashboard Homepage
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const indexPath = path.join(rootDir, 'index.html');
    const htmlContent = fs.existsSync(indexPath)
      ? fs.readFileSync(indexPath, 'utf-8')
      : renderDashboardHTML();
    res.writeHead(200, setCors({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    }));
    res.end(htmlContent);
    return;
  }

  // 2. Logo SVG
  if (url.pathname === '/logo.svg') {
    const logoPath = path.join(rootDir, 'logo.svg');
    if (fs.existsSync(logoPath)) {
      res.writeHead(200, setCors({ 'Content-Type': 'image/svg+xml' }));
      res.end(fs.readFileSync(logoPath));
      return;
    }
  }

  // 3. Health & Status Check
  if (url.pathname === '/api/health' && req.method === 'GET') {
    res.writeHead(200, setCors({ 'Content-Type': 'application/json' }));
    res.end(JSON.stringify({
      status: 'healthy',
      app: 'Peel',
      version: '0.1.0',
      runtime: 'Node.js Standalone',
      rembgProxyConfigured: Boolean(REMBG_BACKEND_URL),
      huggingFaceConfigured: Boolean(HUGGINGFACE_API_KEY),
      mode: 'client-first-on-device',
    }));
    return;
  }

  // 4. Background Removal API (/api/peel or /api/remove-bg)
  if ((url.pathname === '/api/peel' || url.pathname === '/api/remove-bg') && req.method === 'POST') {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const rawBody = Buffer.concat(chunks);
      const contentType = req.headers['content-type'] || '';

      let imageBuffer: ArrayBuffer | null = null;

      if (contentType.includes('application/json')) {
        const json = JSON.parse(rawBody.toString('utf-8'));
        const imageBase64 = json.image || json.file;
        if (!imageBase64) {
          res.writeHead(400, setCors({ 'Content-Type': 'application/json' }));
          res.end(JSON.stringify({ error: 'Missing "image" base64 payload' }));
          return;
        }
        const cleanBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
        const buf = Buffer.from(cleanBase64, 'base64');
        imageBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      } else {
        // Raw image binary or multipart buffer
        imageBuffer = rawBody.buffer.slice(rawBody.byteOffset, rawBody.byteOffset + rawBody.byteLength);
      }

      if (!imageBuffer || imageBuffer.byteLength === 0) {
        res.writeHead(400, setCors({ 'Content-Type': 'application/json' }));
        res.end(JSON.stringify({ error: 'Image body cannot be empty' }));
        return;
      }

      // Check if upstream Rembg microservice is configured
      if (REMBG_BACKEND_URL) {
        const rembgRes = await peelViaRembgService(imageBuffer, REMBG_BACKEND_URL);
        if (rembgRes.success && rembgRes.data) {
          res.writeHead(200, setCors({
            'Content-Type': 'image/png',
            'X-Peel-Engine': 'Rembg-Upstream',
          }));
          res.end(Buffer.from(rembgRes.data));
          return;
        }
      }

      // Check if HuggingFace Inference API is configured
      if (HUGGINGFACE_API_KEY) {
        const hfRes = await peelViaHuggingFace(imageBuffer, HUGGINGFACE_API_KEY, 'briaai/RMBG-1.4');
        if (hfRes.success && hfRes.data) {
          res.writeHead(200, setCors({
            'Content-Type': 'image/png',
            'X-Peel-Engine': 'HuggingFace-RMBG-1.4',
          }));
          res.end(Buffer.from(hfRes.data));
          return;
        }
      }

      // Default client-first mode response
      res.writeHead(200, setCors({ 'Content-Type': 'application/json' }));
      res.end(JSON.stringify({
        status: 'ready_for_client_gpu',
        message: 'Peel client-first mode: segmentation runs losslessly on client WebGPU/WASM.',
        sizeBytes: imageBuffer.byteLength,
      }));
      return;
    } catch (err: any) {
      res.writeHead(500, setCors({ 'Content-Type': 'application/json' }));
      res.end(JSON.stringify({ error: err.message || 'Processing failed' }));
      return;
    }
  }

  // 5. Metrics Endpoint
  if (url.pathname === '/api/metrics' && req.method === 'POST') {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      const width = body.width || 800;
      const height = body.height || 600;
      const alphaArray = new Uint8Array(width * height);
      const metrics = analyzeAlphaMetrics(alphaArray, width, height);

      res.writeHead(200, setCors({ 'Content-Type': 'application/json' }));
      res.end(JSON.stringify({ success: true, metrics }));
      return;
    } catch (err: any) {
      res.writeHead(400, setCors({ 'Content-Type': 'application/json' }));
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  // 404
  res.writeHead(404, setCors({ 'Content-Type': 'application/json' }));
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${currentPort} is in use, attempting ${currentPort + 1}...`);
    currentPort++;
    server.listen(currentPort, '0.0.0.0');
  } else {
    console.error('Server error:', err);
  }
});

server.listen(currentPort, '0.0.0.0', () => {
  console.log('============================================================');
  console.log('  PEEL // BACKGROUND REMOVAL STUDIO');
  console.log(`  Running locally on http://localhost:${currentPort}`);
  console.log('============================================================');
});
