// satellite.js ships WebAssembly runtimes we never call (only its plain JS
// propagator is used). Turbopack follows their dynamic imports and stalls on
// the Emscripten pthreads loader, so the build aliases them to this stub.
export default function noWasm(): never {
  throw new Error("satellite.js WebAssembly runtimes are not bundled");
}
