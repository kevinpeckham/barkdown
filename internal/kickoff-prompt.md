# barkdown — kickoff prompt

We're building **@kevinpeckham/barkdown** — an open-source TypeScript
package: a Markdown ⇄ DOM round-trip codec, guaranteed to invert marked.
It is the sibling of @kevinpeckham/barkup (barkup guards the tree's
identity; barkdown guards the prose's). Author: Kevin Peckham. MIT.
Repo: github.com/kevinpeckham/barkdown (created; origin configured).

Note: an unrelated, abandoned unscoped "barkdown" (last publish 2019)
exists on npm — we are scoped, so it's irrelevant; never reference it.

## Source material (authorized port)
The production implementation lives in ~/newdev/slx-replicator and Kevin
owns it. Port and adapt:
- src/lib/utils/serializeBlogHtmlToMarkdown.ts (336 lines, ZERO imports —
  the DOM→markdown walker; module-private helpers + one export)
- src/lib/utils/parseBlogMarkdownPreview.ts (the marked + marked-footnote
  config; module-guarded plugin registration)
- tests/lib/utils/serializeBlogHtmlToMarkdown.test.ts (34 one-directional
  tests — port as the base suite, then extend per below)
Scaffold by mirroring ~/newdev/barkup exactly: tsconfig strict,
Biome, fallow-rules.json (platform-neutral src/), varlock .env.schema
(no runtime env vars), .gitignore INCLUDING the *.env.local hardening,
SECURITY.md, SHA-pinned CI workflow, release.yml for npm trusted
publishing (OIDC, id-token: write, npm ≥ 11.5.1, --provenance).

## v1 public API (frozen scope)
- `toMarkdown(input: HTMLElement | string, options?): string` — the walker
- `toDom(markdown: string): string` — marked (gfm: true) + marked-footnote,
  returns an HTML string; DOM construction is the consumer's side
- `roundTrip(markdown: string, adapter?): string` — convenience compose
- A small DOM-adapter seam like barkup's for the string-input branch and
  server-side use (browser document by default; happy-dom/linkedom pass
  structurally — the walker already uses instance node-type constants)
Sanitization is OUT of scope: document that consumers sanitize
(DOMPurify) before trusting parsed HTML. Dependencies: `marked` and
`marked-footnote` as peerDependencies with a tested range (start at the
proven pair: marked 18.x, marked-footnote ^1.4). Nothing else at runtime.

## The guarantees (these are the product — word them exactly)
1. **Canonical identity**: for markdown in barkdown's canonical dialect
   (define it: ATX headings, `**bold**`/`*italic*`, `-` bullets, fenced
   code, GFM tables), `toMarkdown(toDom(md)) === md`.
2. **Fixed-point convergence**: for ANY input markdown,
   one round trip reaches the canonical form and a second round trip is
   byte-identical to the first — serialize∘parse is idempotent.
3. **Footnote identity**: marked-footnote's output shape (footnote-N /
   footnote-ref-N, data-footnotes section, backref stripping) round-trips
   exactly, including the legacy data-footnote-ref shape.
4. **No silent loss**: unknown elements pass through as raw HTML (stable
   across cycles via markdown's HTML passthrough); every DOM text node
   reaches the output.

## Work the guarantee actually requires (the real lift)
The ported suite is one-directional only — the round-trip promise is
currently UNTESTED. Build:
- A corpus round-trip suite: curated markdown fixtures covering every
  supported construct + nesting combinations, asserting guarantees 1–2.
- fast-check property tests for inline constructs (emphasis nesting,
  escaping, links with titles) asserting idempotence on arbitrary text.
- **Add image serialization** (`![alt](src)` with optional title) — it
  currently falls through to raw HTML; that's a hole in the guarantee.
- **Add GFM table serialization** — marked parses tables (gfm: true), so
  raw-HTML passthrough breaks canonical identity; implement th/td/align.
- Adapter conformance tests: the CSS-styled-span emphasis path
  (style.fontWeight etc.) under happy-dom AND linkedom.
- Fix whatever the suite finds; it will find things — that's its job.

## Version policy (README section, verbatim intent)
The identity guarantee is with respect to the tested marked range. CI
runs the full round-trip suite against the pinned versions; marked
upgrades land only with a green suite. This is barkdown's one ongoing
maintenance commitment; scope is otherwise frozen at v1 like barkup.

## Order of work
1. Scaffold from the barkup template; commit.
2. Port serializer + parse config + base tests; commit.
3. Images + tables + the round-trip/property/conformance suites; fix
   findings; commit per logical unit.
4. README: guarantees, canonical dialect spec, version policy, sibling
   note ("pairs with @kevinpeckham/barkup"), maintenance posture
   ("scoped and stable"), MIT © Kevin Peckham, Built at Lightning Jar.
5. `npm publish --dry-run` and inspect the tarball. STOP — Kevin
   publishes v0.1.0 interactively himself, then configures the npm
   trusted publisher (GitHub Actions / kevinpeckham / barkdown /
   release.yml), then v0.1.1 tags ship the provenance-signed release
   via CI.
Run check + tests before every commit. Conventional commits; never
mention AI assistance in commits. Push to origin as you complete steps.

After publish, the consuming swap happens back in slx-replicator
(separate session): BlogWysiwyg.svelte's two imports move to the package.
