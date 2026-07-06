/**
 * barkdown — a Markdown ⇄ DOM round-trip codec, guaranteed to invert
 * marked. Sibling of @kevinpeckham/barkup.
 *
 * Public surface (populated in subsequent commits):
 *   toMarkdown(input)   — DOM subtree (or HTML string) → GFM markdown
 *   toDom(markdown)     — markdown → HTML string (marked + marked-footnote)
 *   roundTrip(markdown) — toMarkdown(toDom(markdown))
 */

export {};
