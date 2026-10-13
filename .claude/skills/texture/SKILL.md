---
name: texture
description: >-
  Use when working on texture creation, UV mapping, texture painting, PBR texture
  authoring, texture baking, or texture atlasing — "UV unwrap this model", "create
  a texture", "paint the texture", "bake the AO", "atlas the UVs", "fix stretching",
  "tile this texture". Covers UV layout, texel density, texture resolution, PBR
  texture maps (albedo, normal, roughness, metallic, AO, emissive), texture
  projection, and baking workflows.
---

# Textures and UV mapping

Textures give a model its surface detail: colour, roughness, normals, ambient
occlusion and emission. A great model with bad UVs or stretched textures looks
worse than a simple model with clean texel density.

## 1. Plan the texture

Before unwrapping, decide:

- **Texture resolution** — 1K for small props, 2K for characters and hero
  assets, 4K for cinematic close-ups. Match the resolution to the asset's
  on-screen size.
- **UV layout strategy** — one UV island per logical part (head, torso, arm),
  or a single atlas for small props that share one material.
- **Texel density** — keep texel density uniform across the model so details
  appear at the same scale. Most DCCs have a texel-density checker; use it.
- **Texture maps needed** — albedo (base colour), normal, roughness, metallic,
  AO, and emissive for anything that glows. Height/displacement for close-up
  detail.

## 2. UV unwrap

1. **Mark seams** along natural boundaries: underarms, inside of legs, back of
   ears, anywhere a real seam would exist. Keep seams short and hidden.
2. **Unwrap** using angle-based or conformal unwrapping. Angle-based preserves
   shapes better for hard surfaces; conformal is faster for organic models.
3. **Straighten** UV islands where the geometry is straight (walls, boxes) so
   texels align to the grid.
4. **Pack** islands with consistent margins — enough to prevent bleeding at
   mip levels, but not so much that resolution is wasted.
5. **Check for stretching** — apply a checker or UV grid texture and look for
   distorted squares. Fix stretching by adjusting seams or relaxing the unwrap.

### UV rules

- No UV island should be inverted (flipped normals on the texture).
- Overlapping UVs are intentional only for mirrored or identical parts.
- Keep islands inside the 0-1 UV space unless tiling is planned.
- Leave padding between islands — 2-4 texels per 1K, more for tiled textures.

## 3. Author the texture maps

### Albedo (base colour)

- Start with a neutral mid-grey or the dominant colour, then layer detail.
- No lighting information in the albedo — no baked shadows or highlights.
- Keep values in sRGB space; the engine converts to linear at render time.

### Normal map

- Bake from a high-poly sculpt or a displacement map.
- Tangent-space normal maps (the standard) use the mesh's UVs; object-space
  normal maps are rotation-dependent and rarely used.
- Check the green channel convention (OpenGL vs DirectX) matches the engine.

### Roughness and metallic

- Roughness: white is fully rough, black is mirror-smooth. Most materials fall
  in the 0.2-0.8 range.
- Metallic: binary — 0 for dielectric (plastic, wood, skin), 1 for metal.
  Never use intermediate values except for special cases like corroded metal.

### Ambient occlusion

- Bake from geometry or paint manually.
- Multiply with the albedo in the shader, or store in a separate channel of a
  packed texture (e.g., occlusion in R, roughness in G, metallic in B — the
  glTF convention).

### Emissive

- For anything that glows: lights, screens, magical effects.
- Keep emissive values HDR when the engine supports bloom.

## 4. Texture painting workflow

1. Paint in layers, starting with broad shapes and finishing with fine detail.
2. Use stencil or projection painting for hard-surface details (panel lines,
   rivets, labels).
3. Paint masks (roughness variation, edge wear) in grayscale, then use them as
   inputs to the material.
4. Save incremental versions — texture painting is hard to undo.

## 5. Baking

When baking from a high-poly to a low-poly model:

1. Ensure the low-poly model has UVs.
2. Create a cage or use ray-distance projection so rays don't miss thin geometry.
3. Bake one map at a time and inspect each: AO, normal, curvature, position,
   thickness.
4. Fix baking artifacts (light leaks, shadow acne) by adjusting the cage,
   ray distance, or by baking at higher resolution and downsampling.

## 6. Tiling and procedural textures

- For tiled textures, ensure the edges match by using a tileable source or by
  mirroring at the seams.
- Break up obvious tiling with variation: colour masks, roughness maps, or
  decal overlays.
- Use world-space or triplanar projection for large surfaces where UV tiling
  would be obvious.

## Definition of done

The model has clean UVs with no stretching or overlapping (intentional mirrors
excepted), uniform texel density across parts, every texture map the material
needs is authored at the right resolution, the albedo has no baked lighting,
the normal map convention matches the engine, and the result looks correct in
the renderer with no visible seams, bleeding, or tiling artifacts.
