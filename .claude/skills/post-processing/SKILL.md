---
name: post-processing
description: >-
  Use when setting up, debugging, or optimizing post-processing effects —
  "add bloom", "set up SSAO", "add motion blur", "fix the post-processing",
  "make it look cinematic", "add colour grading", "tone mapping". Covers
  render passes, post-processing stack, screen-space effects (SSAO, SSR, SSS),
  bloom, motion blur, depth of field, colour grading, and tone mapping.
---

# Post-processing

Post-processing transforms the rendered image into the final image. It is
where the visual style is defined: the look of the lighting, the mood of the
colour grade, and the cinematic effects that sell the image.

## 1. The post-processing pipeline

Post-processing effects run in sequence, each reading the output of the previous:

```
Scene render -> HDR buffer -> Effects chain -> Tone mapping -> LDR output
```

Effects operate on the HDR (high dynamic range) buffer before tone mapping
converts to LDR (low dynamic range) for display.

### Common effect order

1. **Screen-space effects** — SSAO, SSR, SSS (need depth and normals)
2. **Lighting effects** — bloom, lens flares
3. **Camera effects** — motion blur, depth of field
4. **Colour effects** — colour grading, vignette, chromatic aberration
5. **Tone mapping** — always last before output

## 2. Screen-space effects

These use the depth and normal buffers to compute effects across the screen.

### SSAO (Screen-Space Ambient Occlusion)

- Darkens crevices and contact points where ambient light would be occluded.
- Cheap, effective, and almost always worth enabling.
- **HBAO** (Horizon-Based AO) and **GTAO** (Ground-Truth AO) are modern
  improvements over classic SSAO — less noise, better contact shadows.

### SSR (Screen-Space Reflections)

- Reflects the scene on glossy surfaces by tracing rays in screen space.
- Falls back to cubemaps or planar reflections where screen-space data is
  missing.
- Noisy; use a denoiser or fall back to static reflections for distant
  surfaces.

### SSS (Screen-Space Subsurface Scattering)

- Approximates light scattering through thin materials (skin, leaves, wax).
- Expensive; use only where it matters, or bake into the material.

## 3. Bloom

Bloom spreads bright pixels outward, simulating light scattering in the lens
or eye.

- **Threshold** — only pixels above this brightness contribute. Set it high
  so only emissive and specular highlights bloom.
- **Intensity** — how much the bloom spreads. Subtle is usually better.
- **Radius** — how far the bloom spreads. Larger for a dreamy look.
- Use a **dual-kawase** or **downsample/upsample** chain for performance.

## 4. Motion blur

- **Per-object** — blurs based on the object's velocity. Cheaper, but doesn't
  handle camera motion.
- **Camera (screen-space)** — blurs based on the difference between the
  current and previous frame's view matrices. Handles camera motion but
  causes ghosting on fast-moving objects.
- Keep motion blur subtle — too much makes the image look smeared.

## 5. Depth of field (DOF)

- Blurs objects outside the focal range, simulating a camera lens.
- **Bokeh** — the shape of the out-of-focus highlights. Use a bokeh texture
  for a cinematic look.
- Set the **focal distance** to the subject's distance and the **aperture**
  to control the blur amount.
- Use **circle of confusion** maps for accurate near-field and far-field
  blur.

## 6. Colour grading

Colour grading adjusts the overall mood and tone of the image.

- **Lift/Gamma/Gain** — adjust shadows, midtones, and highlights
  independently.
- **Color curves** — adjust the tonal response per channel.
- **LUT (Look-Up Table)** — apply a pre-defined colour transformation. Fast
  and consistent across the project.
- **White balance** — adjust the colour temperature and tint.

### Colour grading workflow

1. Start with **exposure** and **white balance** to get a neutral image.
2. Adjust **contrast** and **saturation** for the overall mood.
3. Use **curves** for fine-tuning specific tonal ranges.
4. Add a **LUT** for the final stylistic look.

## 7. Tone mapping

Tone mapping compresses the HDR range into the LDR range the display can show.

| Operator      | Character                              | Use when                    |
| ------------- | -------------------------------------- | --------------------------- |
| Reinhard      | Simple, desaturates highlights         | General purpose             |
| ACES          | Filmic, preserves highlight colour     | Cinematic, realistic        |
| Filmic        | Soft rolloff, natural                  | Unreal Engine default       |
| AgX           | Neutral, preserves colour, no highlight clipping | Blender default |

- **ACES** and **AgX** are the modern standards for realistic rendering.
- Always apply tone mapping after all other effects.

## 8. Common post-processing stack

A typical cinematic post-processing chain:

1. **SSAO / GTAO** — contact shadows
2. **SSR** — glossy reflections (or fallback)
3. **Bloom** — emissive glow
4. **Motion blur** — camera and object motion
5. **Depth of field** — focal plane
6. **Colour grading** — mood and style
7. **Tone mapping** — HDR to LDR
8. **FXAA / TAA** — anti-aliasing (see `performance` for TAA details)

## 9. Performance

Post-processing is expensive. Each effect adds a full-screen pass:

- **SSAO/SSAO** — moderate cost, high visual impact. Almost always worth it.
- **SSR** — high cost. Use only on hero surfaces or with a fallback.
- **Bloom** — low cost. Always worth it.
- **Motion blur** — moderate cost. Use when the camera moves fast.
- **DOF** — moderate cost. Use selectively.
- **Colour grading** — very low cost (LUT). Always worth it.
- **TAA** — low cost, high quality. Preferred over MSAA for deferred
  rendering.

### Optimization

- Use **half-resolution** for SSAO, SSR, and bloom.
- **Temporal** effects (TAA, TSSR) reuse previous frames to reduce cost.
- Disable effects on lower-end hardware; provide quality settings.
- Profile the post-processing stack — it is often the bottleneck.

## Definition of done

The post-processing stack is set up with effects in the correct order, the
visual style is consistent with the project's art direction, tone mapping is
applied last, the effects are optimized for the target hardware, and the
result looks correct in the running application — not just in the editor.
