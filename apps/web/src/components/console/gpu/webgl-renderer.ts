import { GLYPH_COUNT } from "../glyphs";
import {
  type DrawOutcome,
  type MarkerRenderer,
  type PickResult,
  RendererError,
  type RenderLayer,
} from "../renderer";
import {
  AtlasLayout,
  CELL_PAD,
  MIP_LEVELS,
  rasteriseCell,
  TABLE_HEIGHT,
  TABLE_WIDTH,
} from "./atlas";
import {
  FLAG_ADAPTIVE,
  FLAG_FADED,
  INSTANCE_BYTES,
  type InstanceViews,
  instanceViews,
  MAX_INSTANCES,
  MOVING_INSTANCE_BYTES,
  OFFSET_DELTA,
  OFFSET_HEADINGS,
  OFFSET_HIGH,
  OFFSET_LOW,
  OFFSET_MOVING_STYLE,
  OFFSET_ROTATION,
  OFFSET_STYLE,
  OFFSET_TIMES,
  packInstance,
  packMovingInstance,
  unpackId,
} from "./encode";
import type { FrameUniforms } from "./frame";
import {
  DRAW_FRAGMENT_SOURCE,
  PICK_FRAGMENT_SOURCE,
  QUAD_CORNERS_DATA,
  VERTEX_SOURCE,
} from "./shaders";

const MIN_CAPACITY = 64;
const RADIANS = Math.PI / 180;
const ZERO_ID = new Uint32Array(4);

export const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  powerPreference: "high-performance",
};

const UNIFORM_NAMES = [
  "u_viewProjectionRte",
  "u_eyeHigh",
  "u_eyeLow",
  "u_eyeScaled",
  "u_inverseRadii",
  "u_viewport",
  "u_sized",
  "u_cells",
  "u_tones[0]",
  "u_pick",
  "u_layerIndex",
  "u_layerStale",
  "u_staleAlpha",
  "u_atlas",
  "u_moving",
  "u_now",
] as const;

type UniformName = (typeof UNIFORM_NAMES)[number];
type Uniforms = Partial<Record<UniformName, WebGLUniformLocation | null>>;

type Program = { program: WebGLProgram; uniforms: Uniforms };

type GlLayer = {
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  moving: boolean;
  capacity: number;
  staging: ArrayBuffer;
  views: InstanceViews;
  bytes: Uint8Array;
  source: RenderLayer;
};

type PickTarget = {
  framebuffer: WebGLFramebuffer;
  colour: WebGLTexture;
  depth: WebGLRenderbuffer;
  width: number;
  height: number;
};

type RendererOptions = {
  onRestore?: () => void;
  onWarn?: (message: string) => void;
};

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new RendererError("could not create a shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "";
    gl.deleteShader(shader);
    throw new RendererError(`shader compile failed: ${log}`);
  }
  return shader;
}

function link(
  gl: WebGL2RenderingContext,
  vertex: WebGLShader,
  fragment: string,
): Program {
  const compiled = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!program) throw new RendererError("could not create a program");
  gl.attachShader(program, vertex);
  gl.attachShader(program, compiled);
  gl.linkProgram(program);
  gl.deleteShader(compiled);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "";
    gl.deleteProgram(program);
    throw new RendererError(`program link failed: ${log}`);
  }
  const uniforms: Uniforms = {};
  for (const name of UNIFORM_NAMES) {
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return { program, uniforms };
}

function strideOf(layer: GlLayer): number {
  return layer.moving ? MOVING_INSTANCE_BYTES : INSTANCE_BYTES;
}

function powerOfTwoAtLeast(value: number): number {
  let capacity = MIN_CAPACITY;
  while (capacity < value) capacity *= 2;
  return capacity;
}

export class WebGlRenderer implements MarkerRenderer {
  readonly kind = "webgl2" as const;
  private readonly canvas: HTMLCanvasElement;
  private readonly options: RendererOptions;
  private gl: WebGL2RenderingContext;
  private drawProgram: Program | null = null;
  private pickProgram: Program | null = null;
  private quad: WebGLBuffer | null = null;
  private atlasTexture: WebGLTexture | null = null;
  private cellTexture: WebGLTexture | null = null;
  private pickTarget: PickTarget | null = null;
  private readonly layers = new Map<number, GlLayer>();
  private atlas: AtlasLayout;
  private uploaded = new Set<string>();
  private ratio = 1;
  private cssWidth = 1;
  private cssHeight = 1;
  private lost = false;
  private overflowWarned = false;
  private readonly pixel = new Uint32Array(4);
  private readonly onLost: (event: Event) => void;
  private readonly onRestored: () => void;
  private readonly selectProgram: (program: WebGLProgram) => void;

  constructor(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
    const gl = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
    if (!gl) throw new RendererError("WebGL2 is not available");
    this.canvas = canvas;
    this.options = options;
    this.gl = gl;
    this.selectProgram = gl.useProgram.bind(gl);
    this.atlas = new AtlasLayout(1);
    this.build();
    this.onLost = (event) => {
      event.preventDefault();
      this.lost = true;
    };
    this.onRestored = () => {
      try {
        this.pickTarget = null;
        this.uploaded = new Set();
        this.build();
        for (const layer of this.layers.values()) this.recreate(layer);
        this.lost = false;
        this.options.onRestore?.();
      } catch (error) {
        this.lost = true;
        this.options.onWarn?.(
          error instanceof Error ? error.message : "context restore failed",
        );
      }
    };
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
  }

  get contextLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  resize(cssWidth: number, cssHeight: number, ratio: number): void {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    const width = Math.max(1, Math.round(cssWidth * ratio));
    const height = Math.max(1, Math.round(cssHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    if (ratio !== this.ratio) {
      this.ratio = ratio;
      this.rebuildAtlas();
    }
  }

  syncLayer(layer: RenderLayer): void {
    if (this.contextLost) {
      this.rememberLayer(layer);
      return;
    }
    const gl = this.gl;
    let target = this.layers.get(layer.slot);
    if (!target) {
      target = this.createLayer(layer);
      this.layers.set(layer.slot, target);
    }
    target.source = layer;
    if (target.moving !== layer.moving) this.relayout(target, layer.moving);
    const stride = strideOf(target);
    this.ensureCapacity(target, layer.count);
    this.ensureCellsFor(layer);
    this.pack(target, layer, 0, layer.count);
    gl.bindBuffer(gl.ARRAY_BUFFER, target.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, target.bytes, 0, layer.count * stride);
  }

  updatePositions(layer: RenderLayer, from: number, to: number): void {
    const target = this.layers.get(layer.slot);
    if (!target || this.contextLost || to <= from) return;
    const gl = this.gl;
    const end = Math.min(to, layer.count);
    const stride = strideOf(target);
    this.pack(target, layer, from, end);
    gl.bindBuffer(gl.ARRAY_BUFFER, target.buffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      from * stride,
      target.bytes,
      from * stride,
      (end - from) * stride,
    );
  }

  removeLayer(slot: number): void {
    const target = this.layers.get(slot);
    if (!target) return;
    this.layers.delete(slot);
    if (this.contextLost) return;
    this.gl.deleteVertexArray(target.vao);
    this.gl.deleteBuffer(target.buffer);
  }

  draw(
    frame: FrameUniforms,
    layers: readonly RenderLayer[],
  ): DrawOutcome | null {
    if (this.contextLost || !this.drawProgram) return null;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const visible = layers.filter((layer) => layer.count > 0);
    if (visible.length === 0) return null;
    for (const layer of visible) {
      if (layer.sizedGlyph >= 0)
        this.ensureCell(layer.sizedGlyph, layer.sizedSize);
    }
    this.flushAtlas();
    const { program, uniforms } = this.drawProgram;
    this.selectProgram(program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.bindTextures(uniforms);
    this.setFrame(uniforms, frame, 0);
    for (const layer of visible) {
      const target = this.layers.get(layer.slot);
      if (!target) continue;
      this.setLayer(uniforms, layer);
      gl.bindVertexArray(target.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, layer.count);
    }
    gl.bindVertexArray(null);
    return null;
  }

  pick(
    cssX: number,
    cssY: number,
    frame: FrameUniforms,
    layers: readonly RenderLayer[],
  ): PickResult | null {
    if (this.contextLost || !this.pickProgram) return null;
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const target = this.ensurePickTarget(width, height);
    if (!target) return null;
    const x = Math.floor(cssX * this.ratio);
    const y = height - 1 - Math.floor(cssY * this.ratio);
    if (x < 0 || y < 0 || x >= width || y >= height) return null;

    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, 1, 1);
    gl.depthMask(true);
    gl.clearBufferuiv(gl.COLOR, 0, ZERO_ID);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);

    const { program, uniforms } = this.pickProgram;
    this.selectProgram(program);
    this.bindTextures(uniforms);
    this.setFrame(uniforms, frame, 1);
    const bySlot = new Map<number, RenderLayer>();
    for (const layer of layers) {
      if (!layer.pickable || layer.count === 0) continue;
      const glLayer = this.layers.get(layer.slot);
      if (!glLayer) continue;
      bySlot.set(layer.slot, layer);
      this.setLayer(uniforms, layer);
      gl.bindVertexArray(glLayer.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, layer.count);
    }
    gl.bindVertexArray(null);
    gl.readPixels(x, y, 1, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, this.pixel);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const found = unpackId(this.pixel[0]);
    if (!found) return null;
    const layer = bySlot.get(found.layerIndex);
    if (!layer || found.instanceIndex >= layer.count) return null;
    return { slot: layer.slot, marker: layer.order[found.instanceIndex] };
  }

  destroy(): void {
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    if (!this.gl.isContextLost()) {
      const gl = this.gl;
      for (const layer of this.layers.values()) {
        gl.deleteVertexArray(layer.vao);
        gl.deleteBuffer(layer.buffer);
      }
      if (this.drawProgram) gl.deleteProgram(this.drawProgram.program);
      if (this.pickProgram) gl.deleteProgram(this.pickProgram.program);
      if (this.quad) gl.deleteBuffer(this.quad);
      if (this.atlasTexture) gl.deleteTexture(this.atlasTexture);
      if (this.cellTexture) gl.deleteTexture(this.cellTexture);
      this.deletePickTarget();
    }
    this.layers.clear();
    this.drawProgram = null;
    this.pickProgram = null;
  }

  private build(): void {
    const gl = this.gl;
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
    try {
      this.drawProgram = link(gl, vertex, DRAW_FRAGMENT_SOURCE);
      this.pickProgram = link(gl, vertex, PICK_FRAGMENT_SOURCE);
    } finally {
      gl.deleteShader(vertex);
    }
    const quad = gl.createBuffer();
    if (!quad) throw new RendererError("could not create a buffer");
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_CORNERS_DATA, gl.STATIC_DRAW);
    this.quad = quad;
    this.buildTextures();
  }

  private createLayer(source: RenderLayer): GlLayer {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (!vao || !buffer || !this.quad) {
      throw new RendererError("could not create layer buffers");
    }
    const capacity = powerOfTwoAtLeast(source.count);
    const stride = source.moving ? MOVING_INSTANCE_BYTES : INSTANCE_BYTES;
    const staging = new ArrayBuffer(capacity * stride);
    const layer: GlLayer = {
      vao,
      buffer,
      moving: source.moving,
      capacity: 0,
      staging,
      views: instanceViews(staging),
      bytes: new Uint8Array(staging),
      source,
    };
    this.configureVao(layer);
    return layer;
  }

  private configureVao(layer: GlLayer): void {
    const gl = this.gl;
    const stride = strideOf(layer);
    gl.bindVertexArray(layer.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, layer.buffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, OFFSET_HIGH);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, OFFSET_LOW);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribIPointer(
      4,
      4,
      gl.UNSIGNED_BYTE,
      stride,
      layer.moving ? OFFSET_MOVING_STYLE : OFFSET_STYLE,
    );
    gl.vertexAttribDivisor(4, 1);
    if (layer.moving) {
      gl.disableVertexAttribArray(3);
      gl.vertexAttrib1f(3, 0);
      gl.enableVertexAttribArray(5);
      gl.vertexAttribPointer(5, 3, gl.FLOAT, false, stride, OFFSET_DELTA);
      gl.vertexAttribDivisor(5, 1);
      gl.enableVertexAttribArray(6);
      gl.vertexAttribPointer(6, 2, gl.FLOAT, false, stride, OFFSET_TIMES);
      gl.vertexAttribDivisor(6, 1);
      gl.enableVertexAttribArray(7);
      gl.vertexAttribPointer(7, 2, gl.FLOAT, false, stride, OFFSET_HEADINGS);
      gl.vertexAttribDivisor(7, 1);
    } else {
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, OFFSET_ROTATION);
      gl.vertexAttribDivisor(3, 1);
      gl.disableVertexAttribArray(5);
      gl.disableVertexAttribArray(6);
      gl.disableVertexAttribArray(7);
      gl.vertexAttrib3f(5, 0, 0, 0);
      gl.vertexAttrib2f(6, 0, 0);
      gl.vertexAttrib2f(7, 0, 0);
    }
    gl.bindVertexArray(null);
  }

  private relayout(layer: GlLayer, moving: boolean): void {
    layer.moving = moving;
    layer.capacity = 0;
    layer.staging = new ArrayBuffer(0);
    layer.views = instanceViews(layer.staging);
    layer.bytes = new Uint8Array(layer.staging);
    this.configureVao(layer);
  }

  private recreate(layer: GlLayer): void {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (!vao || !buffer)
      throw new RendererError("could not create layer buffers");
    layer.vao = vao;
    layer.buffer = buffer;
    layer.capacity = 0;
    this.configureVao(layer);
    this.syncLayer(layer.source);
  }

  private rememberLayer(layer: RenderLayer): void {
    const known = this.layers.get(layer.slot);
    if (known) known.source = layer;
  }

  private ensureCapacity(layer: GlLayer, count: number): void {
    const gl = this.gl;
    const wanted = powerOfTwoAtLeast(count);
    const stride = strideOf(layer);
    if (wanted * stride > layer.staging.byteLength) {
      layer.staging = new ArrayBuffer(wanted * stride);
      layer.views = instanceViews(layer.staging);
      layer.bytes = new Uint8Array(layer.staging);
    }
    if (wanted > layer.capacity) {
      gl.bindBuffer(gl.ARRAY_BUFFER, layer.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, wanted * stride, gl.DYNAMIC_DRAW);
      layer.capacity = wanted;
    }
  }

  private pack(
    target: GlLayer,
    layer: RenderLayer,
    from: number,
    to: number,
  ): void {
    if (layer.count > MAX_INSTANCES) {
      throw new RangeError("a layer cannot hold more than 16,777,216 markers");
    }
    const { order, ecef, rotationDeg, glyph, size, tone, adaptive, faded } =
      layer;
    const { delta, times, headings } = layer;
    if (layer.moving && delta && times && headings) {
      for (let k = from; k < to; k++) {
        const m = order[k];
        packMovingInstance(
          target.views,
          k,
          ecef,
          delta,
          m * 3,
          times[m * 2] - layer.epoch,
          times[m * 2 + 1] - layer.epoch,
          headings[m * 2],
          headings[m * 2 + 1],
          glyph[m],
          size[m],
          tone[m],
          (adaptive[m] ? FLAG_ADAPTIVE : 0) | (faded[m] ? FLAG_FADED : 0),
        );
      }
      return;
    }
    for (let k = from; k < to; k++) {
      const m = order[k];
      packInstance(
        target.views,
        k,
        ecef,
        m * 3,
        rotationDeg[m] * RADIANS,
        glyph[m],
        size[m],
        tone[m],
        (adaptive[m] ? FLAG_ADAPTIVE : 0) | (faded[m] ? FLAG_FADED : 0),
      );
    }
  }

  private ensureCellsFor(layer: RenderLayer): void {
    const seen = new Set<number>();
    for (let m = 0; m < layer.count; m++) {
      const key = layer.glyph[m] * TABLE_WIDTH + layer.size[m];
      if (seen.has(key)) continue;
      seen.add(key);
      this.ensureCell(layer.glyph[m], layer.size[m]);
    }
    if (layer.sizedGlyph >= 0)
      this.ensureCell(layer.sizedGlyph, layer.sizedSize);
  }

  private ensureCell(glyph: number, size: number): void {
    if (glyph < 0 || glyph >= GLYPH_COUNT || size < 1) return;
    if (this.atlas.has(glyph, size)) return;
    if (this.atlas.add(glyph, size)) return;
    if (!this.overflowWarned) {
      this.overflowWarned = true;
      this.options.onWarn?.("marker atlas is full, some sizes will not draw");
    }
  }

  private flushAtlas(): void {
    const gl = this.gl;
    if (!this.atlasTexture) return;
    let changed = false;
    for (const cell of this.atlas.cells()) {
      const key = `${cell.glyph}:${cell.size}`;
      if (this.uploaded.has(key)) continue;
      this.uploaded.add(key);
      const canvas = rasteriseCell(cell, this.atlas.scale);
      if (!canvas) continue;
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        cell.x - CELL_PAD,
        cell.y - CELL_PAD,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        canvas,
      );
      changed = true;
    }
    if (!changed) return;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.uploadTable();
  }

  private uploadTable(): void {
    const gl = this.gl;
    if (!this.cellTexture) return;
    gl.bindTexture(gl.TEXTURE_2D, this.cellTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      TABLE_WIDTH,
      TABLE_HEIGHT,
      gl.RGBA,
      gl.FLOAT,
      this.atlas.table(),
    );
  }

  private rebuildAtlas(): void {
    const keys = this.atlas.cells().map((cell) => [cell.glyph, cell.size]);
    this.atlas = new AtlasLayout(this.ratio);
    this.uploaded = new Set();
    for (const [glyph, size] of keys) this.atlas.add(glyph, size);
    if (this.contextLost) return;
    const gl = this.gl;
    if (this.atlasTexture) gl.deleteTexture(this.atlasTexture);
    if (this.cellTexture) gl.deleteTexture(this.cellTexture);
    this.atlasTexture = null;
    this.cellTexture = null;
    this.buildTextures();
  }

  private buildTextures(): void {
    const gl = this.gl;
    const atlas = gl.createTexture();
    const cells = gl.createTexture();
    if (!atlas || !cells) throw new RendererError("could not create a texture");
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.texStorage2D(
      gl.TEXTURE_2D,
      MIP_LEVELS,
      gl.RGBA8,
      this.atlas.textureSize,
      this.atlas.textureSize,
    );
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, MIP_LEVELS - 1);
    this.atlasTexture = atlas;
    gl.bindTexture(gl.TEXTURE_2D, cells);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, TABLE_WIDTH, TABLE_HEIGHT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.cellTexture = cells;
    this.uploadTable();
  }

  private bindTextures(uniforms: Uniforms): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.cellTexture);
    gl.uniform1i(uniforms.u_atlas ?? null, 0);
    gl.uniform1i(uniforms.u_cells ?? null, 1);
  }

  private setFrame(
    uniforms: Uniforms,
    frame: FrameUniforms,
    pick: number,
  ): void {
    const gl = this.gl;
    gl.uniformMatrix4fv(
      uniforms.u_viewProjectionRte ?? null,
      false,
      frame.viewProjectionRte,
    );
    gl.uniform3fv(uniforms.u_eyeHigh ?? null, frame.eyeHigh);
    gl.uniform3fv(uniforms.u_eyeLow ?? null, frame.eyeLow);
    gl.uniform3fv(uniforms.u_eyeScaled ?? null, frame.eyeScaled);
    gl.uniform3fv(uniforms.u_inverseRadii ?? null, frame.inverseRadii);
    gl.uniform2f(uniforms.u_viewport ?? null, this.cssWidth, this.cssHeight);
    gl.uniform4fv(uniforms["u_tones[0]"] ?? null, frame.tones);
    gl.uniform1f(uniforms.u_staleAlpha ?? null, frame.staleAlpha);
    gl.uniform1i(uniforms.u_pick ?? null, pick);
    gl.uniform1f(uniforms.u_now ?? null, frame.now - frame.epoch);
  }

  private setLayer(uniforms: Uniforms, layer: RenderLayer): void {
    const gl = this.gl;
    gl.uniform1i(uniforms.u_layerIndex ?? null, layer.slot);
    gl.uniform1i(uniforms.u_layerStale ?? null, layer.stale ? 1 : 0);
    gl.uniform1i(uniforms.u_moving ?? null, layer.moving ? 1 : 0);
    gl.uniform2i(
      uniforms.u_sized ?? null,
      layer.sizedGlyph,
      layer.sizedGlyph >= 0 ? layer.sizedSize : 0,
    );
  }

  private ensurePickTarget(width: number, height: number): PickTarget | null {
    const known = this.pickTarget;
    if (known && known.width === width && known.height === height) return known;
    this.deletePickTarget();
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    const colour = gl.createTexture();
    const depth = gl.createRenderbuffer();
    if (!framebuffer || !colour || !depth) return null;
    gl.bindTexture(gl.TEXTURE_2D, colour);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32UI, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(
      gl.RENDERBUFFER,
      gl.DEPTH_COMPONENT16,
      width,
      height,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      colour,
      0,
    );
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      depth,
    );
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const target = { framebuffer, colour, depth, width, height };
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      this.pickTarget = target;
      this.deletePickTarget();
      this.options.onWarn?.("picking framebuffer is incomplete");
      return null;
    }
    this.pickTarget = target;
    return target;
  }

  private deletePickTarget(): void {
    const target = this.pickTarget;
    if (!target) return;
    const gl = this.gl;
    gl.deleteFramebuffer(target.framebuffer);
    gl.deleteTexture(target.colour);
    gl.deleteRenderbuffer(target.depth);
    this.pickTarget = null;
  }
}
