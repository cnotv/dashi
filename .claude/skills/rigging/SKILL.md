---
name: rigging
description: >-
  Use when building a character rig, adding bones, skinning a mesh to a
  skeleton, setting up constraints, creating an IK chain, or painting skin
  weights — "rig this character", "add an IK handle", "paint the weights",
  "fix the deformation", "add a bone", "set up the face rig". Covers skeleton
  hierarchy, joint placement, skinning, weight painting, constraints, IK/FK
  setups, and corrective blendshapes.
---

# Rigging

A rig is the skeleton and control system that lets an animator pose and
animate a model. A good rig deforms cleanly, is intuitive to pose, and hides
complexity behind simple controls.

## 1. Plan the rig

Before placing a single bone, decide:

- **What needs to move** — body, face, fingers, cloth, mechanical parts. Each
  may need its own rig system.
- **Deformation quality** — how much detail is needed at each joint? A game
  character needs clean deformation with minimal bones; a film character may
  use corrective blendshapes and complex joint systems.
- **Control scheme** — FK for arcs and overlapping motion, IK for hands and
  feet that need to stay planted. Most limbs use IK with an FK/IK switch.
- **Deformers** — joints (bones), blendshapes (morph targets), corrective
  shapes, lattice deformers. Use each where it is strongest.

## 2. Build the skeleton

### Joint hierarchy

- Follow the anatomy: spine -> neck -> head, shoulder -> elbow -> wrist,
  hip -> knee -> ankle.
- Name every joint descriptively and consistently (`spine_01`, `spine_02`,
  `left_upper_arm`, `right_lower_leg`). Naming conventions matter when the rig
  is scripted or shared.
- Joints should be oriented consistently — typically with X pointing down the
  bone and Z up (or the convention the engine expects).

### Joint placement

- Place joints at the centre of rotation, not at the surface of the mesh.
- Add enough spine joints for smooth curvature: typically 3-5 for the torso,
  2-3 for the neck.
- For joints that need volume preservation (shoulders, hips), consider adding
  a "roll" bone or using a multi-joint setup.

## 3. Skin the mesh

1. **Bind** the mesh to the skeleton using smooth (weighted) binding. Rigid
   binding is only for mechanical or hard-surface parts.
2. **Paint weights** starting from the joints with the most influence:
   - Hips before spine, spine before neck.
   - Thigh before calf before foot.
   - Upper arm before forearm before hand.
3. **Test the deformation** by posing each joint to its extremes and watching
   the mesh. Look for collapsing, twisting, or pinching.
4. **Refine weights** with a combination of painting and smoothing. Use weight
   normalization to ensure all weights at a vertex sum to 1.

### Weight painting rules

- Sharp transitions at hard boundaries (skull, pelvis), smooth gradients at
  soft transitions (shoulder, elbow).
- Use a low-resolution weight map for broad strokes, then smooth.
- Mirror weights across the symmetry axis when the mesh is symmetric.
- A vertex should never have more than 3-4 influencing bones.

## 4. Set up controls

### FK (Forward Kinematics)

- Simple hierarchy: each joint rotates the one below it.
- Good for tails, tentacles, and chains where overlapping motion matters.
- Add a control curve at the end of the chain for the animator to grab.

### IK (Inverse Kinematics)

- One handle drives the position of the end effector; the solver calculates
  the intermediate joint rotations.
- Set up a pole vector (elbow/knee target) to control the bending direction.
- Add an IK/FK switch for limbs that need both modes.

### Constraints

- **Parent constraint** — keeps an object at a target's transform while
  allowing the target to move.
- **Aim constraint** — points an object at a target (useful for eyes).
- **Point constraint** — locks position only.
- **Orient constraint** — locks rotation only.
- Use constraints to connect the rig to the controls, not to drive the
  skeleton directly.

## 5. Corrective shapes

When a joint deforms poorly no matter how the weights are painted:

1. Pose the joint to the problematic extreme.
2. Sculpt the correction on the mesh.
3. Create a blendshape (morph target) from the sculpted version.
4. Drive the blendshape with the joint's rotation so it activates
   automatically at the extreme.

Common corrective shapes: shoulder bulge, elbow pinch, knee compression,
hip twist.

## 6. Face rig

- Use a combination of joints (jaw, brow, eyelids) and blendshapes (phonemes,
  expressions).
- Follow the FACS (Facial Action Coding System) for expression targets.
- Keep the face rig simple: 20-40 blendshapes cover most expressions; add more
  only for close-up work.
- Test with phonemes (A, E, I, O, U, M, F, L, etc.) to ensure the mouth
  shapes read correctly.

## 7. Deformation testing

A rig is not done until it has been tested:

1. **Pose test** — pose every joint to its extremes and back. No mesh should
   collapse, invert, or spike.
2. **Animation test** — run a simple animation (walk cycle, wave) and watch
   for popping or sliding.
3. **Range test** — ensure the rig can reach the poses the animation needs
   without breaking.

## Definition of done

The skeleton is named, oriented, and hierarchically correct; the mesh is
skinned with clean weights that deform without artifacts at every joint
extreme; controls are intuitive with IK/FK switches where needed; corrective
shapes are set up where weights alone cannot solve the deformation; and the
rig has been tested with poses and a simple animation.
