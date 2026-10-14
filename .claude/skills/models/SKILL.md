---
name: models
description: >-
  Use when creating, importing, retopologizing, or optimizing 3D models —
  "create a model", "retopologize this", "optimize the mesh", "fix the
  topology", "LOD this model", "check the poly count", "UV this". Covers
  3D modeling, topology, mesh optimization, LOD generation, and model import
  pipelines.
---

# 3D models

A 3D model is geometry — vertices, edges, and faces — that defines the shape
of an object. The quality of a model is not just its silhouette but its
topology: how the geometry flows, how it deforms, and how efficiently it
renders.

## 1. Topology

Good topology is clean, predictable, and fit for purpose:

- **Quads** (four-sided polygons) are the standard. They subdivide cleanly,
  deform predictably, and UV unwrap well.
- **Triangles** are fine for static meshes and game assets (everything is
  triangulated at render time anyway), but avoid them in models that will be
  subdivided or deformed.
- **N-gons** (polygons with 5+ sides) are acceptable on flat, static surfaces
  but can cause artifacts when subdivided or deformed.
- **Poles** (vertices with more or fewer than 4 edges) are inevitable; place
  them in low-curvature areas where they won't cause visible artifacts.

### Edge flow

- Edges should follow the form: around muscles, along wrinkles, with the
  direction of motion.
- Loops should be continuous where possible — a loop that stops suddenly
  creates a visible artifact.
- Add edge loops where deformation needs control (joints, facial features).

## 2. Modeling workflow

1. **Blockout** — simple primitives to establish proportions and silhouette.
   Work in low resolution.
2. **Primary forms** — add the major shapes and define the overall form.
3. **Secondary forms** — add the medium details: panels, muscles, folds.
4. **Tertiary forms** — fine details: pores, scratches, stitches. Use textures
   (normal maps, displacement) for the finest details rather than geometry.

### Modeling tips

- Work symmetrically when the asset is symmetrical; mirror at the end.
- Use reference images — front, side, and back — and check proportions
  constantly.
- Step back and view the model in silhouette frequently; details can hide
  proportion problems.
- Name and organize objects logically (`body`, `head`, `arm_left`).

## 3. Retopology

When a high-poly sculpt needs to be animated or rendered in real time:

1. Create a low-poly base mesh that matches the silhouette of the sculpt.
2. Use automatic retopology (Quad Remesh, Instant Meshes, ZRemesher) as a
   starting point, then clean up manually.
3. Ensure the topology follows the form and has edge loops where needed for
   deformation.
4. Bake the high-poly detail onto the low-poly mesh as normal maps, AO, and
   curvature maps.
5. UV unwrap the low-poly mesh (see `texture`).

### Retopology rules

- Keep the polygon budget in mind: 5-10K for a mobile character, 20-50K for a
  PC character, 100K+ for a cinematic asset.
- More geometry in high-curvature areas, less in flat areas.
- The silhouette should match the high-poly; interior detail comes from
  textures.

## 4. Polygon budgets

| Asset type              | Mobile  | PC      | Cinematic |
| ----------------------- | ------- | ------- | --------- |
| Hero character          | 5-10K   | 20-50K  | 100K+     |
| Secondary character     | 2-5K    | 10-20K  | 50K+      |
| Environment prop        | 500-2K  | 2-10K   | 20K+      |
| Environment (large)     | 1-5K    | 10-30K  | 100K+     |

These are starting points; the budget depends on the asset's on-screen size
and importance.

## 5. LOD (Level of Detail)

Multiple versions of the model at decreasing polygon counts, switched based on
distance:

- **LOD0** — full detail, used up close.
- **LOD1** — 50% of LOD0, used at medium distance.
- **LOD2** — 25% of LOD0, used at far distance.
- **LOD3** — 10% of LOD0, used at very far distance (or impostor/billboard).

### LOD generation

1. Use automatic decimation as a starting point.
2. Manually clean up the silhouette — LODs should match the original
   silhouette as closely as possible.
3. Bake the LOD0 normal maps onto the lower LODs to preserve detail.
4. Test the switching distances; the transition should be imperceptible.

## 6. Model optimization

- **Remove hidden geometry** — interior faces, backfaces that are never seen.
- **Merge vertices** — weld seams where the mesh is continuous.
- **Remove degenerate faces** — zero-area triangles, duplicate faces.
- **Optimize for the target platform** — mobile needs aggressive optimization;
   desktop can afford more geometry.

## 7. Import pipeline

When importing models from external sources:

1. **Check the scale** — models from different sources have different units.
   Normalize to the engine's unit (usually metres).
2. **Check the orientation** — forward axis and up axis vary between tools.
   Fix on import, not by rotating the object.
3. **Check the normals** — ensure they are consistent and outward-facing.
   Recalculate if needed.
4. **Check the UVs** — ensure the model has UVs and they are in the 0-1
   range.
5. **Check the materials** — ensure materials are assigned and textures are
   linked.

## Definition of done

The model has clean topology with quads where it matters, edge loops follow
the form, the polygon count is within budget for the target platform, LODs are
generated and tested (if applicable), the silhouette is correct from all
angles, and the model imports cleanly into the engine with correct scale,
orientation, normals, UVs, and materials.
