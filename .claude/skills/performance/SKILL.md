---
name: performance
description: >-
  Use when profiling, diagnosing, or optimizing performance — "it's slow",
  "optimize this", "profile the scene", "reduce draw calls", "fix the frame
  rate", "memory is too high", "GPU bound", "CPU bound". Covers frame
  profiling, draw call reduction, GPU/CPU bottleneck diagnosis, memory
  optimization, LOD strategies, occlusion culling, and render pipeline
  optimization.
---

# Performance

Real-time 3D is a balancing act between visual quality and frame rate. The
goal is a consistent frame rate (typically 30 or 60 fps) with the best
visuals the hardware can afford. Performance work is measurement-driven:
profile first, optimize what the profiler shows, then profile again.

## 1. The frame budget

At 60 fps, the frame budget is 16.67 ms. At 30 fps, it is 33.33 ms. The
budget is split:

| Stage             | Typical budget (60 fps) |
| ----------------- | ----------------------- |
| CPU (game logic)  | 2-4 ms                  |
| CPU (render prep) | 2-4 ms                  |
| GPU (rendering)   | 8-12 ms                 |
| Present           | 1 ms                    |

If the frame time exceeds the budget, the bottleneck is either CPU-bound
(the CPU can't prepare frames fast enough) or GPU-bound (the GPU can't render
them fast enough).

## 2. Profile before optimizing

Never optimize without profiling first. The profiler tells you where the time
actually goes — which is rarely where you expect.

### CPU profiling

- **What to look for:** long frames, spikes, specific functions that take
  too long.
- **Tools:** Unity Profiler, Unreal Insights, Chrome DevTools (for web),
  RenderDoc (for GPU traces), Xcode Instruments (for macOS/iOS).

### GPU profiling

- **What to look for:** overdraw, shader complexity, texture bandwidth,
  geometry throughput.
- **Tools:** RenderDoc, NVIDIA Nsight, AMD Radeon GPU Profiler, Xcode GPU
  frame capture.

### Memory profiling

- **What to look for:** texture memory, mesh memory, render target memory,
  garbage collection spikes.
- **Tools:** Unity Memory Profiler, Unreal Memory Insights, Chrome DevTools
  memory tab.

## 3. Draw call reduction

Each draw call is a command to the GPU to render a mesh with a material.
Draw calls are expensive on the CPU; reducing them is the most common CPU
optimization.

### Batching

- **Static batching** — combine static meshes that share a material into
  one draw call. Requires the meshes to be marked static.
- **Dynamic batching** — combine small dynamic meshes at runtime. Limited to
  meshes with the same material and low vertex counts.
- **GPU instancing** — render many copies of the same mesh with one draw
  call. Ideal for foliage, rocks, buildings, particles.
- **Indirect rendering** — GPU-driven draw calls, reducing CPU overhead.
  The most advanced technique for large scenes.

### Material and texture optimization

- **Share materials** — every unique material is a potential draw call.
  Use material instances or texture atlases to reduce material count.
- **Texture atlases** — pack many small textures into one large texture so
  many objects can share one material.
- **Shader variants** — each shader variant is a separate compile and draw
  call. Keep the variant count low.

## 4. GPU optimization

### Overdraw

Overdraw is when the same pixel is shaded multiple times. It is the most
common GPU performance issue.

- **Sort transparent objects** back-to-front.
- **Use alpha test** instead of alpha blend where possible.
- **Depth prepass** — render the depth buffer first, then shade only the
  closest fragments.
- **Reduce viewport size** — render at a lower resolution and upscale
  (dynamic resolution).

### Shader complexity

- **Reduce texture samples** — each sample costs bandwidth. Pack maps into
  shared channels.
- **Use the lowest precision** that looks correct (half on mobile).
- **Avoid branching** where possible; use `mix()` and `step()`.
- **Simplify lighting** — use a cheaper lighting model for distant objects.

### Geometry

- **Reduce triangle count** — use LODs (see `models`).
- **Use occlusion culling** — don't render objects that are behind other
  objects.
- **Frustum culling** — don't render objects outside the camera view.

## 5. LOD strategies

- **Mesh LODs** — multiple versions of the model at decreasing polygon
  counts, switched by distance.
- **Shader LODs** — simpler shader variants for distant objects.
- **Texture LODs** — lower-resolution textures for distant objects (mipmaps
  do this automatically).
- **Impostors** — billboarded images of the model for very distant objects.

## 6. Occlusion culling

- **Hardware occlusion queries** — test if an object is visible before
  rendering it.
- **Software occlusion culling** — use a low-resolution depth buffer from the
  previous frame to test visibility.
- **Umbra, HZB (Hierarchical Z-Buffer)** — modern occlusion culling
  algorithms that work well for complex scenes.
- **Portal culling** — for indoor scenes, only render what is visible through
  doorways and windows.

## 7. Memory optimization

### Textures

- **Compress textures** — use BC/DXT (desktop), ASTC (mobile), or ETC2
  (WebGL) compression.
- **Use mipmaps** — reduces memory bandwidth and improves cache coherence.
- **Reduce texture resolution** — 2K is enough for most assets; 4K only for
  hero assets.
- **Stream textures** — load high-resolution textures only when needed.

### Meshes

- **Compress vertex data** — use half-precision for normals and UVs.
- **Remove unused vertex attributes** — don't store vertex colour if no
  material uses it.
- **Index buffer optimization** — use 16-bit indices when possible.

### Render targets

- **Reuse render targets** — allocate a pool and reuse.
- **Reduce render target resolution** — half-resolution for SSAO, SSR, and
  bloom.
- **Use tile-based rendering** — on mobile, render in tiles to reduce
  memory bandwidth.

## 8. CPU optimization

- **Reduce per-frame allocations** — reuse objects, avoid garbage collection.
- **Spread work across frames** — update distant objects less frequently.
- **Use a job system / multithreading** — parallelize animation, physics, and
  culling.
- **Optimize physics** — use simplified collision meshes, reduce the
  physics update rate.

## 9. Platform-specific optimization

### Mobile

- **Tile-based rendering** — mobile GPUs are tile-based; overdraw is
  especially expensive.
- **Reduce texture bandwidth** — use ASTC compression, mipmaps, and
  lower-resolution textures.
- **Use half-precision** — for positions, normals, and colours.
- **Limit shader complexity** — mobile GPUs are fill-rate limited.

### Web (WebGL/WebGPU)

- **Reduce draw calls** — browsers have high per-draw-call overhead.
- **Use instanced rendering** — essential for any repeated geometry.
- **Compress textures** — use KTX2 or Basis Universal for GPU-native
  compression.
- **Limit shader complexity** — WebGL shaders compile at runtime; keep
  them simple.

## Definition of done

The scene runs at the target frame rate on the target hardware, the
profiler shows no single bottleneck consuming more than its budget, draw
calls are minimized through batching and instancing, textures are compressed
and at appropriate resolutions, LODs are set up for all repeated geometry,
occlusion culling is enabled where it helps, and the optimization is
measured — before and after numbers are recorded and compared.
