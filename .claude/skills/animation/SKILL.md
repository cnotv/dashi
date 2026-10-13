---
name: animation
description: >-
  Use when creating keyframe animation, editing animation curves, adjusting
  timing and spacing, setting up a walk cycle, or working with animation
  blending — "animate this", "make it walk", "fix the timing", "smooth the
  curve", "add a bounce", "set up the blend tree". Covers keyframe animation,
  the 12 principles of animation, animation curves (F-curves), timing,
  anticipation, follow-through, and animation state machines.
---

# Animation

Animation brings a rigged model to life. The difference between a mechanical
and a believable performance is in the timing, spacing, and adherence to the
core principles.

## 1. The 12 principles

These are the foundation of believable animation. Not every principle applies
to every shot, but most apply most of the time:

1. **Squash and stretch** — convey weight and flexibility by deforming the
   character at impact and during fast motion. Preserve volume.
2. **Anticipation** — a small wind-up before the main action tells the viewer
   what is about to happen. Without it, the action reads as sudden.
3. **Staging** — pose the character so the action is readable. Silhouette is
   king.
4. **Straight ahead and pose to pose** — pose to pose (blocking key poses
   first) is the standard for planned animation; straight ahead is for
   spontaneous or flowing motion.
5. **Follow-through and overlapping action** — not everything stops at once.
   Hair, clothing, and secondary parts continue after the body stops.
6. **Slow in and slow out** — ease into and out of poses. Nothing in nature
   moves at constant speed.
7. **Arcs** — most natural motion follows an arc, not a straight line.
8. **Secondary action** — smaller actions that support the main action (a
   character shifting weight while talking).
9. **Timing** — the number of frames between poses. More frames = slower,
   fewer = faster. Timing sells weight.
10. **Exaggeration** — push poses and timing beyond reality for readability.
11. **Solid drawing** — maintain volume and weight in every pose. No
    "boiling" or shifting silhouettes.
12. **Appeal** — the character should be interesting to watch. This is
    subjective but essential.

## 2. Blocking

Before refining, block the animation:

1. **Key poses** — the storytelling poses: contact, down, passing, up for a
   walk; wind-up, action, follow-through for a gesture.
2. **Breakdowns** — the in-between poses that define the arc and timing.
3. **In-betweens** — fill the remaining frames.

Block in stepped mode (no interpolation) so poses read as pure shapes. Review
the silhouette at each key pose before adding any curves.

## 3. Animation curves (F-curves)

After blocking, switch to spline (bezier) interpolation and refine the curves:

- **Slow in/out** — use ease-in and ease-out tangents on every keyframe.
- **Flat tangents** at the apex of an arc or the extreme of a bounce.
- **Linear tangents** for mechanical or constant-speed motion.
- Avoid overshoot (keys going past the target) unless it is intentional.
- Keep curves clean — delete unnecessary keys, smooth noise.

### Curve tips

- One key per property per frame during blocking; add keys only where the
  motion changes.
- Use the graph editor to fine-tune timing: move keys horizontally to change
  timing, vertically to change value.
- Watch for "floating" — keys that are too far from the neighbouring keys in
  time create a sense of weightlessness.

## 4. Timing and spacing

- **Timing** is how long an action takes; **spacing** is how the object moves
  between frames.
- Heavy objects move slowly with wide spacing at the start and end of a move;
  light objects move quickly with even spacing.
- Use a stopwatch for reference actions: a human walk cycle is roughly 0.5
  seconds per step (24 frames at 24fps for a quick walk, 32 for a slow walk).

## 5. Walk cycles

A walk cycle is the foundation of character animation:

1. **Contact pose** — front foot strikes the ground, back foot pushes off.
2. **Down pose** — the body is at its lowest, weight on the front foot.
3. **Passing pose** — the back leg swings through, body at its highest.
4. **Up pose** — the body is at its highest, pushing off the back foot.
5. Repeat mirrored for the other side.

Walk cycle checklist:
- Arms swing opposite to legs.
- The body rises on the passing pose and lowers on the contact.
- The hips rotate slightly with each step.
- The shoulders counter-rotate against the hips.

## 6. Secondary motion

After the primary animation reads well, add secondary motion:

- **Cloth and hair** — simulate or hand-animate with a delay of 2-4 frames
   behind the body.
- **Fingers** — animate after the hand is in place.
- **Eye darts** — quick 2-3 frame movements, then a hold.
- **Breathing** — a subtle loop even when the character is idle.

## 7. Animation state machines

For interactive animation (games, interactive apps):

1. Define states: idle, walk, run, jump, attack, etc.
2. Define transitions between each pair of states.
3. Use blend trees to smoothly interpolate between animations based on
   parameters (speed, direction).
4. Set transition durations: fast for combat (0.1-0.2s), slower for locomotion
   (0.2-0.4s).
5. Use animation layers for upper/lower body separation (aiming while
   running).

## Definition of done

The animation is blocked with clear storytelling poses, refined with clean
F-curves that have proper slow in/out, the timing and spacing convey the
character's weight and energy, secondary motion supports without distracting,
the walk cycle (if applicable) has the correct contact, down, passing, and up
poses, and the result has been reviewed in motion — not just as still frames.
