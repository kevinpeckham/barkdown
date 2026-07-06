/**
 * barkdown — a Markdown ⇄ DOM round-trip codec, guaranteed to invert
 * marked. Sibling of @kevinpeckham/barkup (barkup guards the tree's
 * identity; barkdown guards the prose's).
 *
 *   toMarkdown(input, options?) — DOM subtree (or HTML string) → markdown
 *   toDom(markdown)             — markdown → HTML string (marked + footnotes)
 *   roundTrip(markdown, adapter?) — toMarkdown(toDom(markdown))
 *
 * Guarantees (see README):
 *   1. Canonical identity: toMarkdown(toDom(md)) === md for canonical md.
 *   2. Fixed-point convergence: one round trip canonicalizes; a second is
 *      byte-identical to the first.
 *   3. Footnote identity: marked-footnote's output shape round-trips
 *      exactly, including the legacy data-footnote-ref shape.
 *   4. No silent loss: unknown elements pass through as raw HTML; every
 *      DOM text node reaches the output.
 */

import type { DomAdapter } from "./adapter.js";
import { toDom } from "./parse.js";
import { toMarkdown } from "./serialize.js";

/**
 * Parse markdown with marked, serialize the resulting DOM back to
 * markdown. One application canonicalizes; a second is a fixed point.
 */
export function roundTrip(markdown: string, adapter?: DomAdapter): string {
	return toMarkdown(toDom(markdown), adapter ? { adapter } : {});
}

export type {
	DocumentLike,
	DomAdapter,
	DomNodeLike,
	HtmlElementLike,
	StyleLike,
} from "./adapter.js";
export {
	BarkdownError,
	defaultAdapter,
	documentAdapter,
} from "./adapter.js";
export { toDom } from "./parse.js";
export type { ToMarkdownOptions } from "./serialize.js";
export { toMarkdown } from "./serialize.js";
