/**
 * DOM adapter seam. barkdown's serializer walks a DOM subtree through a
 * small structural interface (`HtmlElementLike`), so any standards-shaped
 * DOM works: the browser's, happy-dom's, linkedom's.
 *
 * The adapter is only needed for the string-input branch of
 * `toMarkdown()` (and therefore `roundTrip()`): turning an HTML string
 * into a container element requires a `document`. In browsers the global
 * document is used automatically; on servers pass one explicitly:
 *
 *   // happy-dom
 *   import { Window } from "happy-dom";
 *   const adapter = documentAdapter(new Window().document);
 *
 *   // linkedom
 *   import { parseHTML } from "linkedom";
 *   const adapter = documentAdapter(
 *     parseHTML("<html><body></body></html>").document,
 *   );
 */

/** Error type for barkdown misuse (e.g. no DOM available). */
export class BarkdownError extends Error {
	override name = "BarkdownError";
}

/** Structural subset of CSSStyleDeclaration the serializer reads. */
export interface StyleLike {
	fontWeight?: string;
	fontStyle?: string;
	textDecoration?: string;
	textDecorationLine?: string;
	textAlign?: string;
}

/** Structural subset of Node the serializer reads. */
export interface DomNodeLike {
	readonly nodeType: number;
	readonly textContent: string | null;
}

/**
 * Structural subset of HTMLElement the serializer reads. Browser
 * `HTMLElement`, happy-dom and linkedom elements all satisfy it.
 */
export interface HtmlElementLike extends DomNodeLike {
	readonly tagName: string;
	readonly id: string;
	readonly childNodes: ArrayLike<DomNodeLike>;
	readonly children: ArrayLike<HtmlElementLike>;
	readonly outerHTML: string;
	getAttribute(name: string): string | null;
	/** Optional: used to rebuild unknown elements attribute-for-attribute;
	 * without it the serializer falls back to `outerHTML`. */
	getAttributeNames?(): string[];
	hasAttribute(name: string): boolean;
	querySelector(selectors: string): HtmlElementLike | null;
	querySelectorAll(selectors: string): ArrayLike<HtmlElementLike>;
	cloneNode(deep?: boolean): DomNodeLike;
	remove(): void;
	readonly style?: StyleLike;
}

/** Structural subset of Document the adapter needs. */
export interface DocumentLike {
	createElement(tagName: string): HtmlElementLike & { innerHTML: string };
}

export interface DomAdapter {
	/**
	 * Parse an HTML fragment and return a container element whose
	 * children are the fragment's top-level nodes.
	 */
	containerFromHtml(html: string): HtmlElementLike;
}

/** Wrap any standards-shaped document (browser, happy-dom, linkedom, …). */
export function documentAdapter(document: DocumentLike): DomAdapter {
	return {
		containerFromHtml(html: string): HtmlElementLike {
			const container = document.createElement("div");
			container.innerHTML = html;
			return container;
		},
	};
}

/**
 * Resolve the platform document (browsers). Throws a helpful error in
 * runtimes without one — pass an adapter explicitly there.
 */
export function defaultAdapter(): DomAdapter {
	const doc = (globalThis as { document?: DocumentLike }).document;
	if (!doc || typeof doc.createElement !== "function") {
		throw new BarkdownError(
			"No global document in this runtime. Pass an adapter explicitly, " +
				"e.g. `documentAdapter(new Window().document)` with happy-dom, or " +
				'`documentAdapter(parseHTML("<html><body></body></html>").document)` ' +
				"with linkedom.",
		);
	}
	return documentAdapter(doc);
}
