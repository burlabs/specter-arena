# Specters of the Abyss — Kiro Crew Avatar Packs

This folder contains **11 portable Kiro Crew appearance-pack bundles**, one for each approved Specter.

- **Vell** — [`packs/specters-vell.pack.json`](packs/specters-vell.pack.json)
- **Stitch** — [`packs/specters-stitch.pack.json`](packs/specters-stitch.pack.json)
- **Reeve** — [`packs/specters-reeve.pack.json`](packs/specters-reeve.pack.json)
- **Rattle** — [`packs/specters-rattle.pack.json`](packs/specters-rattle.pack.json)
- **Ember** — [`packs/specters-ember.pack.json`](packs/specters-ember.pack.json)
- **Shard** — [`packs/specters-shard.pack.json`](packs/specters-shard.pack.json)
- **Poly** — [`packs/specters-poly.pack.json`](packs/specters-poly.pack.json)
- **Tide** — [`packs/specters-tide.pack.json`](packs/specters-tide.pack.json)
- **Lume** — [`packs/specters-lume.pack.json`](packs/specters-lume.pack.json)
- **Moss** — [`packs/specters-moss.pack.json`](packs/specters-moss.pack.json)
- **bur** — [`packs/specters-bur.pack.json`](packs/specters-bur.pack.json)

## Pack behavior

Each bundle uses Kiro Crew's portable appearance-pack envelope (`kind: "crew-companion-pack"`, version 1).

Every pack includes:

- **idle** — the exact approved Specter artwork, static
- **working** — character-tailored animation
- **done** — a restrained success bounce/sparkle
- **error** — a brief shake/droop reaction
- **loading** and **thinking** — mapped to the working animation for compatibility

The pack's `moods` map is intentionally empty. No sounds are included.

## Source preservation

The avatars are **not redrawn**. Each SVG embeds the exact approved 256×256 PNG from:

`backend/specter_arena/specters/art/<specter>.png`

Only SVG transforms and lightweight vector effects are added around that image. `index.json` records the source Git blob SHA for each pack.

Working-motion themes:

- **Vell:** spectral veil / calm hover
- **Stitch:** heavy patchwork bob + electrical accents
- **Reeve:** scythe hover + spectral slash
- **Rattle:** bone rattle/jitter
- **Ember:** living-flame pulse
- **Shard:** crystalline glints
- **Poly:** single-eye psychic pulse
- **Tide:** flowing sway, waves, bubbles
- **Lume:** lantern sway + beacon halo
- **Moss:** cap bounce + spores
- **bur:** heavy snowy bob + frost motes

## Import into Kiro Crew

1. Open the crew/Bot avatar editor.
2. Choose **Avatar → Customize → Library**.
3. Use the Library **Import** control.
4. Select one `.pack.json` file from `avatar-packs/packs/`.
5. Select the newly installed pack card.
6. Apply/save the avatar change.

Import all eleven if you want the complete Specters library, then assign different packs to different crew members.

## Notes

- These are portable JSON bundles, not app-runtime assets.
- Each bundle is self-contained; it does not fetch artwork from GitHub at runtime.
- Animated states use SVG/CSS only; there are no scripts or external URLs.
- The avatar's working animation is presentation only and has no connection to Specter Arena XP or workflow semantics.
