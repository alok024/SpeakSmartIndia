# public/vad — Static assets for Voice Activity Detection (barge-in)

These files are loaded at runtime by `@ricky0123/vad-web` (Silero VAD via
onnxruntime-web) in the `useBargeIn` hook (`features/avatar/useBargeIn.ts`).

## Files

| File | Source | Size | Purpose |
|------|--------|------|---------|
| `silero_vad_legacy.onnx` | `@ricky0123/vad-web/dist/` | ~1.8 MB | Silero VAD ONNX model (legacy variant) |
| `vad.worklet.bundle.min.js` | `@ricky0123/vad-web/dist/` | ~2.5 KB | AudioWorklet processor registered by vad-web |
| `ort-wasm-simd-threaded.wasm` | `onnxruntime-web/dist/` | ~13 MB | ONNX Runtime WASM backend (SIMD + threads) |

## Why files are here (not loaded from a CDN)

- Keeps the CSP `connect-src` directive tight (`'self'` only).
- Zero CDN dependency during the live interview session — a CDN blip at a
  critical moment would silently kill barge-in for that user.
- Model files are cached by the browser's standard HTTP cache after the first
  load (long `Cache-Control` headers are set by Next.js for `/_next/static/`
  assets; Cloudflare Pages caches `public/` assets similarly).

## Keeping in sync with package upgrades

When upgrading `@ricky0123/vad-web` or `onnxruntime-web`, re-copy the files:

```sh
cp node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx  frontend/public/vad/
cp node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js frontend/public/vad/
cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm  frontend/public/vad/
```

A CI lint step that diffs these would prevent silent drift.

## CSP requirements

`next.config.ts` includes the following directives required by this feature:

- `'wasm-unsafe-eval'` in `script-src` — needed for WASM compilation inside
  the AudioWorklet thread.
- `blob:` in `worker-src` — vad-web registers its AudioWorklet from a `blob:`
  URL derived from the bundled worklet script.
