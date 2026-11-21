# FP-21 Battle animations: design

- `exchangePlanner.ts` is pure: pairs from the scene model, a seeded cadence, turn taking, the layer cap, and the snapshot of what is drawn at one instant.
- `useArenaExchanges.ts` holds one `setTimeout` to the next change and publishes a snapshot only when the drawn state changes.
- `useArenaScene.ts` reports milestone rises with the same gating as defeats (`celebrations.ts#nextMilestoneRises`).
- `BattlefieldScene.tsx` turns the snapshot into hero animation, effect angle (toward the enemy, clamped to 35 degrees, mirrored when the enemy is to the left) and enemy recoil direction (away from the hero).
- `StrikeLayer.tsx` draws one bright bolt per playing exchange along the line from the hero to the target, tinted per hero (`heroCombat.ts#STRIKE_RGB`), landing at that hero's impact time; a cast uses a larger bolt. Heroes stand in a row at the bottom of the map and enemies far up the field, so the hero-side layer alone cannot read as an attack on a minion. The strike exists only while its exchange plays, so it never appears under reduced motion and is bounded by the 8-layer cap.
- The enemy's reaction is a bright ring, four sparks, a brightness pulse and a recoil away from the hero (larger for a milestone cast).
- Effect layers live in `HeroEffects.tsx` and `arena.css`, ported from the Figma Make export with the changes listed in `docs/provenance.md`.
- The UI bundle cap was raised from 305,000 to 419,000 characters (decision OD-1 of the FP-21 plan, decided and kept): the ported effect CSS is about 36,000 characters after minification and the new code about 20,000; the bundle measures 341,258.
