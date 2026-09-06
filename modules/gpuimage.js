/* ============================================================
   GPUImage — WebGPU-accelerated photo compression
   ------------------------------------------------------------
   Downscales + re-encodes user-uploaded photos before they
   are stored in a project. Uses the GPU (hardware bilinear
   sampling) when WebGPU is available; otherwise falls back to
   the exact canvas path Studio used before, so uploads never
   break on machines without a GPU or on WebGPU-less browsers.

   Privacy by construction: the source file is decoded to raw
   pixels and re-encoded, so EXIF/GPS metadata never survives
   into a project (browser decode also applies EXIF orientation
   automatically, so portrait phone photos land upright).

   Output format: WebP is used when the browser can encode it
   (Electron and modern Chromium can) — it is smaller than an
   equivalent JPEG at the same quality. JPEG is the fallback.

   Global API (loaded as a plain <script> like the other modules):

     GPUImage.process(file, { maxW, thumbMax, q, thumbQ })
       → Promise<{ data, thumb, name, w, h, format } | null>

     GPUImage.mode       // 'webgpu' | 'canvas' (last pipeline used)
     GPUImage.format     // 'webp' | 'jpeg' (last output format)
     GPUImage.lastMs     // time spent in the last process() call

   This module intentionally does NOT throw: any failure along
   the WebGPU path is swallowed and retried on canvas, and only
   a total failure returns null (caller keeps today's behavior).
   ============================================================ */
(function () {
  'use strict';

  const GPUImage = {
    mode: 'unavailable',
    format: 'jpeg',
    lastMs: 0
  };

  // Detect WebP encode support once. Plain data: URLs only — this is a
  // capability probe, not a real image.
  const OUTPUT_FORMAT = (() => {
    try {
      const probe = document.createElement('canvas');
      probe.width = 1; probe.height = 1;
      const out = probe.toDataURL('image/webp', 0.8);
      return out.indexOf('data:image/webp') === 0 ? 'image/webp' : 'image/jpeg';
    } catch (e) {
      return 'image/jpeg';
    }
  })();

  /* ---------- WebGPU device cache (lazy, survives failures) ---------- */
  let gpu = null;          // { device, sampler, bindGroupLayout, pipeline }
  let gpuPromise = null;
  let gpuBroken = false;

  const SHADER = `
    @group(0) @binding(0) var srcTex: texture_2d<f32>;
    @group(0) @binding(1) var samp: sampler;
    @group(0) @binding(2) var dstTex: texture_storage_2d<rgba8unorm, write>;

    @compute @workgroup_size(8, 8)
    fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
      let s = vec2<i32>(textureDimensions(dstTex));
      if (gid.x >= u32(s.x) || gid.y >= u32(s.y)) { return; }
      // Centre-aligned bilinear sample — the GPU's texture unit does the
      // filtering, which is what makes the downscale fast.
      let uv = (vec2<f32>(gid.xy) + vec2<f32>(0.5)) / vec2<f32>(s);
      let c = textureSampleLevel(srcTex, samp, uv, 0.0);
      textureStore(dstTex, vec2<i32>(gid.xy), vec4<f32>(c.rgb, 1.0));
    }
  `;

  // One-time sanity probe: some WebGPU implementations (sandboxed or software
  // GPU processes) accept compute pipelines but silently no-op storage writes,
  // which would turn every uploaded photo black. So before trusting the GPU we
  // run one 1×1 downscale and verify the pixel actually came back.
  async function probeGPU(device, sampler, bindGroupLayout, pipeline) {
    try {
      const src = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      device.queue.writeTexture({ texture: src }, new Uint8Array([250, 128, 64, 255]), { bytesPerRow: 4 }, [1, 1]);
      const dst = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, device.createBindGroup({ layout: bindGroupLayout, entries: [
        { binding: 0, resource: src.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: dst.createView() }
      ] }));
      pass.dispatchWorkgroups(1, 1);
      pass.end();
      const buf = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      enc.copyTextureToBuffer({ texture: dst }, { buffer: buf, bytesPerRow: 256 }, { width: 1, height: 1 });
      device.queue.submit([enc.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const px = new Uint8Array(buf.getMappedRange()).slice(0, 4);
      buf.unmap(); src.destroy(); dst.destroy();
      return px[0] > 200 && px[1] > 100 && px[3] === 255;
    } catch (e) { return false; }
  }

  async function initGPU() {
    if (gpuBroken) return null;
    if (gpu) return gpu;
    if (gpuPromise) return gpuPromise;
    gpuPromise = (async () => {
      if (!navigator.gpu) throw new Error('no WebGPU');
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) throw new Error('no adapter');
      const device = await adapter.requestDevice();
      device.lost.then(() => { gpu = null; gpuPromise = null; });
      const sampler = device.createSampler({
        magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'nearest'
      });
      const bindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba8unorm', access: 'write-only', viewDimension: '2d' } }
        ]
      });
      const pipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        compute: { module: device.createShaderModule({ code: SHADER }) }
      });
      if (!(await probeGPU(device, sampler, bindGroupLayout, pipeline))) {
        throw new Error('GPU compute probe failed');
      }
      gpu = { device, sampler, bindGroupLayout, pipeline };
      return gpu;
    })();
    gpuPromise.catch(() => { gpuPromise = null; gpuBroken = true; });
    return gpuPromise;
  }

  // Run one downscale pass: srcView (full-res) → new w×h RGBA texture,
  // then read the pixels back into a packed Uint8ClampedArray.
  async function gpuDownscale(srcView, w, h) {
    const ctx = await initGPU();
    if (!ctx) return null;
    const { device, sampler, bindGroupLayout, pipeline } = ctx;

    const dst = device.createTexture({
      size: [w, h, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: srcView },
        { binding: 1, resource: sampler },
        { binding: 2, resource: dst.createView() }
      ]
    }));
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
    pass.end();

    const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
    const buf = device.createBuffer({
      size: bytesPerRow * h,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    encoder.copyTextureToBuffer(
      { texture: dst, mipLevel: 0 },
      { buffer: buf, bytesPerRow },
      { width: w, height: h }
    );
    device.queue.submit([encoder.finish()]);

    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) out.set(src.subarray(y * bytesPerRow, y * bytesPerRow + w * 4), y * w * 4);
    buf.unmap();
    dst.destroy();
    return out;
  }

  /* ---------- Canvas encoding helpers (shared by both paths) ---------- */
  function canvasFromData(w, h, rgba) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { alpha: false });
    const img = new ImageData(new Uint8ClampedArray(rgba), w, h);
    cx.putImageData(img, 0, 0);
    return cv;
  }
  // Encode through the chosen format (WebP when supported, else JPEG).
  // Re-encoding from raw pixels is what strips EXIF/GPS metadata.
  function toJpeg(cv, q) { return cv.toDataURL(OUTPUT_FORMAT, q); }

  // Legacy path — byte-for-byte the old compressPhoto behaviour (white
  // flatten behind photos, small canvas thumbnails).
  function canvasProcess(file, maxW, thumbMax, q, thumbQ) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      const done = (v) => { try { URL.revokeObjectURL(url); } catch (e) { /* noop */ } resolve(v); };
      img.onload = () => {
        try {
          const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
          if (!w0 || !h0) return done(null);
          const sc = Math.min(1, maxW / Math.max(w0, h0));
          const w = Math.max(1, Math.round(w0 * sc)), h = Math.max(1, Math.round(h0 * sc));
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const cx = cv.getContext('2d');
          cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);
          cx.drawImage(img, 0, 0, w, h);
          const data = cv.toDataURL(OUTPUT_FORMAT, q);
          const ts = Math.min(1, thumbMax / Math.max(w0, h0));
          const tw = Math.max(1, Math.round(w0 * ts)), th = Math.max(1, Math.round(h0 * ts));
          const tv = document.createElement('canvas');
          tv.width = tw; tv.height = th;
          const tx = tv.getContext('2d');
          tx.fillStyle = '#fff'; tx.fillRect(0, 0, tw, th);
          tx.drawImage(img, 0, 0, tw, th);
          done({ data, thumb: tv.toDataURL(OUTPUT_FORMAT, thumbQ), name: file.name || 'photo.jpg', w, h, format: OUTPUT_FORMAT === 'image/webp' ? 'webp' : 'jpeg' });
        } catch (e) { done(null); }
      };
      img.onerror = () => done(null);
      img.src = url;
    });
  }

  // WebGPU path — decodes once, downscales main + thumb on the GPU
  // (both sample the single full-res source texture), then JPEG-encodes
  // the small results on the CPU.
  async function gpuProcess(file, maxW, thumbMax, q, thumbQ) {
    const bitmap = await createImageBitmap(file);
    const w0 = bitmap.width, h0 = bitmap.height;
    if (!w0 || !h0) { bitmap.close(); return null; }

    const sc = Math.min(1, maxW / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * sc)), h = Math.max(1, Math.round(h0 * sc));
    const ts = Math.min(1, thumbMax / Math.max(w0, h0));
    const tw = Math.max(1, Math.round(w0 * ts)), th = Math.max(1, Math.round(h0 * ts));

    // Beyond the 8192 default texture limit → let the canvas path take it.
    if (w0 > 8192 || h0 > 8192) { bitmap.close(); return null; }

    const ctx = await initGPU();
    if (!ctx) return null;

    const { device } = ctx;
    const src = device.createTexture({
      size: [w0, h0, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: src }, [w0, h0]);
    bitmap.close();
    const srcView = src.createView();

    const mainPx = await gpuDownscale(srcView, w, h); // uses cached ctx
    if (!mainPx) { src.destroy(); return null; }
    const thumbPx = (tw === w && th === h) ? mainPx : await gpuDownscale(srcView, tw, th);
    src.destroy();

    const data = toJpeg(canvasFromData(w, h, mainPx), q);
    const thumb = toJpeg(canvasFromData(tw, th, thumbPx), thumbQ);
    if (!data || !thumb) return null;
    return { data, thumb, name: file.name || 'photo.jpg', w, h, format: OUTPUT_FORMAT === 'image/webp' ? 'webp' : 'jpeg' };
  }

  /* ---------- Public API ---------- */
  GPUImage.process = async function (file, opts) {
    opts = opts || {};
    const maxW = opts.maxW || 1280;
    const thumbMax = opts.thumbMax || 300;
    const q = (opts.q === undefined) ? 0.78 : opts.q;
    const thumbQ = (opts.thumbQ === undefined) ? 0.72 : opts.thumbQ;
    const t0 = performance.now();
    let out = null;

    // 1) Try the GPU pipeline.
    try {
      out = await gpuProcess(file, maxW, thumbMax, q, thumbQ);
      if (out) GPUImage.mode = 'webgpu';
    } catch (e) { /* fall through to canvas */ }

    // 2) Canvas fallback — identical legacy behaviour.
    if (!out) {
      out = await canvasProcess(file, maxW, thumbMax, q, thumbQ);
      if (out) GPUImage.mode = 'canvas';
    }

    if (out) GPUImage.format = OUTPUT_FORMAT === 'image/webp' ? 'webp' : 'jpeg';
    GPUImage.lastMs = performance.now() - t0;
    return out;
  };

  // Exposed for tooling/tests: force the canvas path regardless of WebGPU.
  GPUImage.forceCanvas = async function (file, opts) {
    opts = opts || {};
    const maxW = opts.maxW || 1280;
    const thumbMax = opts.thumbMax || 300;
    const q = (opts.q === undefined) ? 0.78 : opts.q;
    const thumbQ = (opts.thumbQ === undefined) ? 0.72 : opts.thumbQ;
    GPUImage.mode = 'canvas';
    return canvasProcess(file, maxW, thumbMax, q, thumbQ);
  };

  window.GPUImage = GPUImage;
})();
