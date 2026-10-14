---
name: materials
description: >-
  Use when creating, editing, or debugging materials — "create a material",
  "make it look metallic", "add transparency", "fix the material", "make it
  glow", "set up the PBR material", "add a clear coat". Covers PBR material
  properties, material graphs, blending modes, transparency, emission, and
  material instances.
---

# Materials

A material defines how a surface interacts with light: its colour, roughness,
metallic properties, transparency, and emission. A good material reads
correctly in every lighting condition.

## 1. PBR (Physically Based Rendering)

Modern real-time engines use PBR. The core properties are:

| Property    | What it controls                                   | Range   |
| ----------- | -------------------------------------------------- | ------- |
| Base colour | The albedo — the surface's intrinsic colour        | sRGB    |
| Metallic    | 0 = dielectric (plastic, wood), 1 = metal         | 0 or 1  |
| Roughness   | 0 = mirror smooth, 1 = fully diffuse              | 0 to 1  |
| Normal      | Perturbs the surface normal for detail             | texture |
| AO          | Ambient occlusion — darkens crevices              | 0 to 1  |
| Emission    | Light emitted from the surface                     | HDR     |

### Rules for PBR

- **Metallic is binary** in most materials: 0 or 1. Intermediate values are
  for special cases only.
- **Non-metals have a specular F0 of ~0.04** (4% reflectance at normal
  incidence). Metals have a coloured F0 equal to their base colour.
- **Albedo has no lighting** — no shadows, no highlights, no ambient. Just
  the surface's intrinsic colour.
- **Roughness maps** should be linear (grayscale), not sRGB.

## 2. Common material types

### Opaque

- The default. Renders in the opaque pass, writes to depth.
- Used for: metal, plastic, wood, stone, skin, fabric.

### Transparent

- Renders in the transparent pass, doesn't write to depth (by default).
- **Alpha blend** — standard transparency. Sort issues are common; use alpha
  test for cutout (foliage, fences) when possible.
- **Alpha test** — discards fragments below a threshold. No sorting issues,
  but hard edges. Use with dithered alpha for smoother results.
- **Additive** — adds the surface colour to the background. Used for glows,
  light shafts, holograms.

### Specialized

- **Subsurface** — for skin, wax, marble. Uses wrap lighting or a thickness
  map to simulate light scattering beneath the surface.
- **Clear coat** — a second specular layer on top of the base. For car paint,
  lacquered wood, wet surfaces.
- **Sheen** — a soft retroreflective layer for fabric (velvet, cloth).
- **Anisotropic** — highlights stretch in one direction. For brushed metal,
  hair, satin.

## 3. Material graph

In node-based editors (Blender, Unreal, Unity Shader Graph):

1. **Start with the Principled BSDF** (or equivalent) — it covers 90% of
   materials.
2. **Add texture maps** for base colour, roughness, metallic, normal, and
   AO. Connect them to the corresponding inputs.
3. **Use masks** to blend between two material states (clean vs worn, wet
   vs dry) using a colour or grayscale mask.
4. **Add variation** — no real surface is perfectly uniform. Use noise
   textures, colour ramps, or vertex colour to break up uniformity.

### Texture map packing

To reduce texture samples, pack multiple grayscale maps into one texture:

| Channel | Content         |
| ------- | --------------- |
| R       | Ambient occlusion |
| G       | Roughness       |
| B       | Metallic        |
| A       | (free)          |

This is the glTF standard and is supported by most engines.

## 4. Transparency and blending

- **Opaque** — no blending, depth write on. Cheapest, most correct.
- **Alpha test** — discard below threshold. No sorting issues, hard edges.
  Use for foliage, fences, grates.
- **Alpha blend** — standard transparency. Requires back-to-front sorting.
  Use for glass, water, particle effects.
- **Pre-multiplied alpha** — RGB is multiplied by alpha before blending.
  Reduces halos; requires the texture to be stored pre-multiplied.
- **Order-independent transparency** (OIT) — sorts per-pixel. Expensive but
  correct for complex overlapping transparency.

## 5. Emission and bloom

- **Emission** adds light to the surface. In HDR pipelines, values above 1.0
  trigger bloom.
- Use emission for: screens, lights, magical effects, glowing eyes.
- Keep emission subtle — too much bloom washes out the scene.
- Use an **emission mask** to control which parts glow.

## 6. Material instances and variants

- Use **material instances** (Unreal) or **material variants** (other engines)
  to create variations without duplicating the material graph.
- Instance only the properties that change (colour, roughness, texture).
- For large numbers of variants, use **material layers** or **material
  functions** to compose from reusable pieces.

## Definition of done

The material reads correctly in the renderer under multiple lighting
conditions (bright, dim, warm, cool), the PBR values are physically plausible
(metallic is binary, albedo has no baked lighting, roughness is in a sensible
range), texture maps are packed efficiently where possible, transparency
uses the correct blending mode for the use case, and the material graph is
organized with named nodes and no unused connections.
