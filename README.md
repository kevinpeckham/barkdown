# barkdown

**A Markdown ⇄ DOM round-trip codec, guaranteed to invert marked.** Parse markdown to HTML with [marked](https://github.com/markedjs/marked); edit it as a live DOM (contenteditable, WYSIWYG, programmatic transforms); serialize the DOM back to markdown that is *provably* the same document.

barkdown is the sibling of [@kevinpeckham/barkup](https://github.com/kevinpeckham/barkup):
barkup guards the tree's identity; barkdown guards the prose's.

```ts
import { toDom, toMarkdown, roundTrip } from "@kevinpeckham/barkdown";

const html = toDom("# Hello\n\nSome **bold** prose.\n"); // marked + footnotes
element.innerHTML = html;                                 // …user edits the DOM…
const markdown = toMarkdown(element);                     // back to markdown
```

The serializer came out of a production blog CMS — a contenteditable
WYSIWYG whose every keystroke round-trips through this exact pair of
functions — and the round-trip guarantee is enforced by a corpus suite
plus fast-check property tests (~2,000 random documents per run).

## The four guarantees

1. **Canonical identity.** For markdown in barkdown's canonical dialect
   (ATX headings, `**bold**`/`*italic*`, `-` bullets, fenced code, GFM
   tables), `toMarkdown(toDom(md)) === md` — byte for byte.
2. **Fixed-point convergence.** For ANY input markdown, one round trip
   reaches the canonical form and a second round trip is byte-identical
   to the first — serialize∘parse is idempotent.
3. **Footnote identity.** marked-footnote's output shape (`footnote-N` /
   `footnote-ref-N`, the `data-footnotes` section, back-reference
   stripping) round-trips exactly, including the legacy
   `data-footnote-ref` shape and non-numeric labels (`[^note]`).
4. **No silent loss.** Unknown elements pass through as raw HTML (stable
   across cycles via markdown's HTML passthrough); every DOM text node
   reaches the output.

Guarantee 2 is the hard one, and it is exactly why this package exists:
most DOM-to-markdown serializers produce output that marked reads back
*differently* — emphasis that stops pairing, escapes that double every
cycle, footnotes that vanish a trip late. barkdown's serializer models
marked's actual parsing behavior (including its documented-by-test
deviations from CommonMark) and falls back to raw HTML — which is stable
— whenever a construct cannot be expressed reliably in markdown.

## Install

```bash
npm install @kevinpeckham/barkdown marked marked-footnote
```

`marked` and `marked-footnote` are peer dependencies — you own the
version, barkdown guarantees against it (see the version policy below).

## API

```ts
toMarkdown(input: HTMLElement | string, options?: { adapter?: DomAdapter }): string
```
Serialize a DOM subtree (or an HTML string) to GFM markdown. Element
input is walked directly through a structural interface — browser
elements, happy-dom, and linkedom all satisfy it. String input needs a
`document` to parse with: the browser's global one by default, or an
adapter on the server.

```ts
toDom(markdown: string): string
```
Markdown → HTML string via marked (`gfm: true`) + marked-footnote.
barkdown configures its own `Marked` instance and never mutates the
`marked` singleton. DOM construction is your side (`innerHTML`, or any
DOM library).

```ts
roundTrip(markdown: string, adapter?: DomAdapter): string
```
`toMarkdown(toDom(markdown))` — one application canonicalizes; a second
is a fixed point.

## Server-side usage (Node, Bun)

Runtimes without a global `document` pass one explicitly:

```ts
// happy-dom
import { Window } from "happy-dom";
import { documentAdapter, toMarkdown } from "@kevinpeckham/barkdown";
const adapter = documentAdapter(new Window().document);

// linkedom
import { parseHTML } from "linkedom";
const adapter = documentAdapter(parseHTML("<html><body></body></html>").document);

toMarkdown("<p>Some <strong>html</strong></p>", { adapter });
```

Both are covered by a conformance suite, including the CSS-styled-span
emphasis path (`style="font-weight: 700"` → `**bold**`).

## The canonical dialect

What `roundTrip` normalizes any markdown into:

- **Headings**: ATX (`## Title`), single-line; setext converts. Emphasis
  inside headings flattens away (editor-safety inherited from the
  serializer's WYSIWYG origins).
- **Emphasis**: `**bold**`, `*italic*`, `~~strikethrough~~`. Nesting the
  markers can't express reliably (empty content, delimiter runs adjacent
  to punctuation, marked's pairing quirks) serializes as raw inline tags
  (`<em>…</em>`) around markdown-escaped content — which reparses to the
  identical DOM.
- **Lists**: `-` bullets, tight; loose lists flatten (paragraphs inside
  an item become continuation lines). Ordered lists use `1.` and
  preserve their `start` number. Task lists keep `[x]` / `[ ]`.
  Adjacent same-marker lists are held apart by a round-tripping
  `<!-- -->` comment (a blank line alone would merge them).
- **Code**: backtick fences with the language info string; inline code
  picks a backtick run longer than any in the content.
- **Tables**: GFM pipe tables, alignment as `:---` / `:---:` / `---:`,
  pipes escaped in cells.
- **Breaks**: two-space hard breaks; `---` thematic breaks.
- **Links**: `[text](dest "title")`; destinations are pre-normalized
  with marked's own `cleanUrl` (encodeURI) transform so they're
  byte-stable. Self-links (`text === href`, incl. `mailto:`) emit as
  bare GFM autolinks when the surrounding context re-linkifies safely.
- **Images**: `![alt](src "title")`.
- **Footnotes**: `[^label]` + `[^label]: text`, multi-paragraph
  definitions via 4-space continuation. Definitions never referenced
  outside the footnote section are dropped (marked-footnote renders them
  to nothing, so they'd silently vanish a trip late otherwise).
- **Escaping**: `\` `` ` `` `*` `_` `[` `]` `~` `<` always; `&` when it
  reads as a character entity; `#` `>` `|` `-` `+` `N.` only at line
  starts. Bare URLs/emails in plain text are defused (`https\://…`,
  `user\@host`) because marked linkifies them at any position — real
  links serialize as links instead.
- **Passthrough**: `<div>`/plain `<span>` wrappers are transparent
  (contenteditable artifacts). HTML comments round-trip. Elements on
  CommonMark's HTML-block tag list pass through as raw `outerHTML`;
  other unknown elements are rebuilt attribute-for-attribute around
  their markdown-escaped children.

Whitespace inside paragraphs is canonicalized (continuation-line indent
and trailing whitespace stripped, hard breaks normalized to exactly two
spaces) — markdown cannot represent the alternatives, so keeping them
would defeat idempotence.

## Sanitization is out of scope

`toDom` returns whatever marked produces; `toMarkdown` preserves unknown
elements as raw HTML *by design*. If any input is untrusted, sanitize
before rendering or storing — e.g. [DOMPurify](https://github.com/cure53/DOMPurify)
between `toDom()` and `innerHTML`.

## Version policy

The identity guarantee is **with respect to the tested marked range**
(currently `marked@^18`, `marked-footnote@^1.4`). CI runs the full
round-trip suite against the pinned versions, and marked upgrades land
only with a green suite. This is barkdown's one ongoing maintenance
commitment; the API surface is otherwise frozen at v1, like barkup's.

## Maintenance posture

barkdown is **scoped and stable**: the v1 surface (`toMarkdown` /
`toDom` / `roundTrip` + the adapter seam) is the whole product, and it
is intentionally small. Bug reports and guarantee violations are always
welcome; feature scope is frozen by design.

## License & credit

MIT © Kevin Peckham. Built at [Lightning Jar](https://www.lightningjar.com).
Pairs with [@kevinpeckham/barkup](https://github.com/kevinpeckham/barkup) —
typed trees as HTML, with round-trip guarantees of its own.
