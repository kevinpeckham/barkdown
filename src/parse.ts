/**
 * Render markdown to an HTML string with marked (GFM) + marked-footnote.
 * This is the parse half of the codec that `toMarkdown` inverts.
 *
 * barkdown configures its own `Marked` instance — it never mutates the
 * `marked` singleton, so a consumer's own marked configuration is
 * untouched.
 *
 * Footnotes emit `<sup><a data-footnote-ref …>` refs + a trailing
 * `<section data-footnotes>` — which `toMarkdown` inverts back to `[^N]`
 * + `[^N]: text` GFM footnote syntax.
 *
 * NOTE: no sanitization is performed (marked does not sanitize).
 * Sanitize the output (e.g. DOMPurify) before trusting it in a live DOM.
 */

import { Marked } from "marked";
import markedFootnote from "marked-footnote";

// Lazy singleton: the footnote extension registers exactly once, and
// only when toDom is first used.
let instance: Marked | undefined;

function getMarked(): Marked {
	if (!instance) {
		instance = new Marked({ gfm: true }).use(markedFootnote());
	}
	return instance;
}

/** Markdown → HTML string. DOM construction is the consumer's side. */
export function toDom(markdown: string): string {
	if (!markdown) return "";
	return getMarked().parse(markdown, { async: false }) as string;
}
