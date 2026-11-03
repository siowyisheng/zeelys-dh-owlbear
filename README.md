# Daggerheart Table Companion

An accessible, backend-free [Owlbear Rodeo](https://www.owlbear.rodeo/) extension for Daggerheart tables.

## Features

- Per-scene character tracking with customizable resources, traits, thresholds, counters, assignments, and token bars
- Official Duality Dice outcomes with action/reaction modes, advantage/disadvantage, expressions, optional Difficulty, public history, and ephemeral private GM rolls
- Shared Fear and one active Fear Takes Form group
- Persistent named countdowns and cooperative spotlight controls
- Compact movable scene overlay, token context actions, keyboard controls, and reduced motion
- Cooperative single-GM write authority with no external backend

Rolls report outcomes only. They never apply Hope, Fear, Stress, damage, countdown, or spotlight changes.

## Development

Requirements: Node.js 20 or newer.

```sh
npm install
npm run dev
```

Load `http://localhost:5173/manifest.json` as a custom extension in Owlbear Rodeo. The development server must be reachable by the browser running Owlbear.

## Verification

```sh
npm run typecheck
npm run lint
npm run build
```

The production files are emitted to `dist/`. Host that directory over HTTPS and install its `manifest.json` URL.

## Trust and persistence

Canonical game state is stored in Owlbear scene metadata. Personal display preferences use player metadata. Public rolls are limited to the latest 20 per scene; private GM rolls are memory-only. The extension is intended for cooperative tables and does not provide tamper-proof rolls or server-enforced authorization.

## License

GPL-3.0-only. Daggerheart is owned by its respective rights holders. This project uses original visuals and is not an official Daggerheart or Owlbear Rodeo product.
