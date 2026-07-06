# CLAUDE.md

Guidance for agent sessions in this repository.

## What this is

barkdown — an open-source TypeScript package: a Markdown ⇄ DOM round-trip
codec, guaranteed to invert marked. Sibling of @kevinpeckham/barkup
(barkup guards the tree's identity; barkdown guards the prose's).
Author: Kevin Peckham (MIT).

## Hard constraints

- **The only runtime dependencies are the declared peers** (`marked`,
  `marked-footnote`). DOM access goes through the adapter seam
  (`src/adapter.ts`); happy-dom and linkedom are devDependencies for
  tests only. Enforced by `fallow-rules.json`.
- **The four guarantees are the product** (see README): canonical
  identity, fixed-point convergence, footnote identity, no silent loss.
  Any change must keep the round-trip corpus and property suites green:
  `bun test`.
- **Scope is frozen at the v1 surface** (`toMarkdown` / `toDom` /
  `roundTrip` + the adapter seam). Decline feature creep; bug fixes and
  guarantee hardening only.
- **The identity guarantee is with respect to the tested marked range.**
  marked upgrades land only with a green round-trip suite — this is the
  one ongoing maintenance commitment.
- Sanitization is out of scope by design; consumers sanitize (DOMPurify)
  before trusting parsed HTML. Never add a sanitizer.

## Commands

```bash
bun test           # unit + round-trip corpus + property tests
bun run check      # tsc --noEmit
bun run build      # emit dist/ (ESM + d.ts)
bun run lint       # biome (auto-fix)
bun run audit      # fallow house rules
```

## Conventions

- Conventional commits (`type: description`). Never mention AI assistance
  in commits.
- TypeScript strict; tab indentation (Biome).
- Env vars: none at runtime by design; repo tooling uses varlock
  (`.env.schema`). Publish credentials via `npm login` / 1Password only.
- Publishing is manual by the author — never run `npm publish` (dry-run is
  fine).
