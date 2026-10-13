---
name: shaders
description: >-
  Use when writing, debugging, or optimizing shaders — "write a shader",
  "create a material", "make it glow", "add a fresnel effect", "fix the
  shader error", "optimize the fragment shader", "make a toon shader", "add
  parallax". Covers GLSL, HLSL, ShaderLab, node-based shaders, the rendering
  pipeline, lighting models, and shader debugging.
---

# Shaders

Shaders are small programs that run on the GPU to compute the appearance of
each pixel. Writing them well means understanding the rendering pipeline,
the math of light, and the constraints of the target hardware.

## 1. Know the pipeline

| Stage              | What it does                                        |
| ------------------ | --------------------------------------------------- |
| Vertex             | Transforms vertices from model to clip space        |
| Tessellation       | Subdivides geometry (optional)                      |
| Geometry           | Generates or discards primitives (optional)         |
| Rasterization      | Converts primitives to fragments                    |
| Fragment (pixel)   | Computes the final colour of each pixel             |
| Post-processing    | Applies screen-space effects (bloom, tonemapping)   |

Shaders run in parallel across thousands of fragments. Branching is expensive;
loops must have a fixed or predictable iteration count.

## 2. Shader languages

| Language  | Where it runs                              |
| --------- | ------------------------------------------ |
| GLSL      | OpenGL, WebGL, Vulkan (via SPIR-V)         |
| HLSL      | Direct3D, Unity                             |
| ShaderLab | Unity's wrapper around HLSL                |
| Node-based| Blender, Unreal, Shader Graph (no code)    |

The math is the same across languages; only the syntax differs.

## 3. The lighting model

Most real-time shaders implement some variant of the **Cook-Torrance** or
**Lambert + Blinn-Phong** model:

```
final = diffuse + specular + ambient + emission
```

### Diffuse

- **Lambert**: `NdotL * lightColor` — simple, fast, good for matte surfaces.
- **Half-Lambert**: wraps the light around the surface for softer falloff.

### Specular

- **Blinn-Phong**: `pow(NdotH, shininess) * lightColor` — fast, classic.
- **GGX (Cook-Torrance)**: physically based, uses roughness and Fresnel.
  The standard for modern PBR.

### Fresnel

- Surfaces reflect more at grazing angles. Use a Fresnel term to add rim
  light or to modulate specular intensity.
- Schlick's approximation: `F0 + (1 - F0) * pow(1 - NdotV, 5)`.

## 4. Common shader effects

### Rim light

```glsl
float rim = 1.0 - max(dot(normal, viewDir), 0.0);
rim = pow(rim, rimPower);
color += rimColor * rim * rimIntensity;
```

### Fresnel

```glsl
float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);
color = mix(baseColor, reflectionColor, fresnel);
```

### Normal mapping

- Perturb the surface normal using a tangent-space normal map.
- `N = normalize(TBN * sampledNormal)` where TBN is the tangent-binormal-
  normal matrix.

### Parallax occlusion mapping

- Offset UV coordinates based on the height map and view direction.
- Steps through the height field to find the intersection, giving the
  illusion of depth without extra geometry.

### Subsurface scattering

- Approximate with wrap lighting: `max(0, (NdotL + wrap) / (1 + wrap))`.
- Or use a thickness map to modulate transmission.

## 5. Node-based shaders

In Blender, Unreal, or Shader Graph:

- **Principled BSDF** (Blender) / **Default Lit** (Unreal) covers 90% of
  materials. Start there and only add custom nodes when needed.
- Use **texture coordinate** nodes (UV, object, world, generated) to drive
  mapping. Object or world coordinates are essential for triplanar mapping.
- **Mix** nodes blend between two inputs using a factor. Use them to combine
  detail masks, roughness variation, or colour variation.
- Keep node graphs organized: name nodes, use frames/comment groups, and
  avoid spaghetti.

## 6. Shader debugging

1. **Visualize intermediates** — output the normal, UV, depth, or a single
   colour channel as the final colour to see what is wrong.
2. **Check the math** — is the dot product normalized? Is the power function
   getting a value in [0, 1]?
3. **Simplify** — strip the shader down to a basic diffuse, then add terms
   back one at a time.
4. **Test on the target hardware** — a shader that works in the editor may
   fail on mobile or WebGL.
5. **Check precision** — mobile GPUs use lowp/mediump by default; explicit
   precision qualifiers prevent artifacts.

## 7. Performance

- **Minimize texture samples** — each sample costs bandwidth. Pack maps
  into shared channels (occlusion in R, roughness in G, metallic in B).
- **Avoid branching** where possible; use `mix()` and `step()` instead of
  `if`.
- **Use the lowest precision** that looks correct (half on mobile).
- **Reduce overdraw** — transparent shaders are expensive; use alpha test
  instead of alpha blend when possible.
- **LOD shaders** — use a simpler shader variant for distant objects.

## Definition of done

The shader compiles without errors or warnings on the target platform, the
visual output matches the intended effect (verified in the renderer, not just
in code review), the math is correct (normalized inputs, correct colour
space), the node graph is organized and named, and performance is acceptable
for the target hardware.
