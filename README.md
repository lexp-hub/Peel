<div align="center">
  <img src="logo.svg" alt="Peel Logo" width="160" />
  <p align="center">
    <strong>Minimalist, zero-cloud AI image background remover</strong>
  </p>
  <p align="center">
    <a href="https://lexp-hub.github.io/Peel/"><img src="https://img.shields.io/badge/Live_Demo-GitHub_Pages-10b981?style=flat-square&logo=githubpages&logoColor=white" alt="Live Demo" /></a>
    <img src="https://img.shields.io/badge/Runtime-Node.js_Standalone-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js Standalone" />
    <img src="https://img.shields.io/badge/On--Device_AI-WebGPU_/_WASM-10b981?style=flat-square&logo=webgpu" alt="WebGPU" />
    <img src="https://img.shields.io/badge/Default_Model-RMBG--1.4-FF7000?style=flat-square&logo=huggingface&logoColor=white" alt="RMBG-1.4" />
    <img src="https://img.shields.io/badge/License-MIT-emerald?style=flat-square" alt="License" />
  </p>
  <p align="center">
    <strong><a href="https://lexp-hub.github.io/Peel/">Open Web Studio &rarr;</a></strong>
  </p>
</div>

---

Peel is an open-source, privacy-first alternative to remove.bg. It removes image backgrounds locally in your browser via WebGPU/WASM or through a standalone Node.js server. No cloud accounts, subscriptions, or external API calls required.

### Features

- **On-device inference**: WebGPU and WASM execution with RMBG-1.4 and BiRefNet. No data leaves your machine.
- **Manual mask refinement**: Pen, Lasso, and Magic Pen (color-tolerance wand) with multi-step undo.
- **Real-time alpha matting**: 60 FPS canvas post-processing for thresholding, feathering, defringe, and blur.
- **Standalone server & API**: Native Node.js HTTP server with `/api/peel`, `/api/health`, and `/api/metrics` endpoints.

For architecture, matting equations, and API documentation, refer to [DOCUMENTATION.md](DOCUMENTATION.md).

---

## License

[MIT](LICENSE) &bull; Inspired by [Skew](https://github.com/lexp-hub/Skew)
