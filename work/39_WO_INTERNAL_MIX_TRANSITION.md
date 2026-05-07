# WO-39: Internal MIX Transition Support

## Problem
Scene transitions currently use a dual-bank cross-fade (e.g., reveal layer 10 by fading out layer 110). In PGM/PRV workflows, this results in a "dirty" look where the PRV channel fades correctly, but the PGM channel cuts instantly to the new state, leading to a visual jump.

## Proposed Solution
Implement a single-layer transition mode using CasparCG's internal `LOADBG ... MIX` logic.
- Stay on the **same layer** (no bank swap).
- Use `LOADBG channel-layer CLIP MIX duration`.
- Execute with `PLAY channel-layer`.

## Tasks
- [ ] Implement `runSceneTakeInternalMix` in a new engine file or as an option in `scene-take-lbg.js`.
- [ ] Add a mechanism to trigger this mode (e.g., a special transition type "INTERNAL_MIX").
- [ ] Create a test Look/Button to verify the behavior.
