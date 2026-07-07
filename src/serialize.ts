/**
 * Serialize a DOM subtree back to markdown. Inverse of `toDom` — walks
 * the HTML shape that `marked` produces plus the tags contenteditable
 * editors inject, and emits GFM-flavored markdown.
 *
 * Design principles:
 * - Closed subset. We only serialize elements we know about. Anything
 *   else is preserved as raw `outerHTML` so leaks surface early rather
 *   than silently disappearing.
 * - Adapter-seamed. Element inputs are walked through the structural
 *   `HtmlElementLike` interface; string inputs are parsed via a
 *   `DomAdapter` (browser document by default).
 * - Cursor-agnostic. Selection state is the caller's responsibility;
 *   this function just reads DOM → returns a string.
 * - No side effects. Pure. Callers can invoke it debounced without
 *   worrying about mutation of the input.
 */

import type { DomAdapter, DomNodeLike, HtmlElementLike } from "./adapter.js";
import { defaultAdapter } from "./adapter.js";
import { tryWrapDelimited } from "./serialize-emphasis.js";
import { dropUnreferencedFootnoteDefs } from "./serialize-footnote-defs.js";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;

export interface ToMarkdownOptions {
	/**
	 * DOM adapter used to parse string inputs. Defaults to the platform
	 * document; required in runtimes without one (Node, Bun).
	 */
	adapter?: DomAdapter;
}

export function toMarkdown(
	input: HtmlElementLike | string,
	options: ToMarkdownOptions = {},
): string {
	let container: HtmlElementLike;
	if (typeof input === "string") {
		const adapter = options.adapter ?? defaultAdapter();
		container = adapter.containerFromHtml(input);
	} else {
		container = input;
	}

	const body = dropUnreferencedFootnoteDefs(
		serializeBlocks(container),
	).trimEnd();
	return body.length ? body + "\n" : "";
}

/** Serialize the direct-child sequence of an element as a list of blocks. */
function serializeBlocks(container: HtmlElementLike): string {
	const parts: string[] = [];
	let previousListTag: string | null = null;
	for (const node of arrayFrom(container.childNodes)) {
		const part = serializeBlockNode(node);
		if (part === "") continue;
		const listTag =
			node.nodeType === ELEMENT_NODE
				? listTagOf(node as HtmlElementLike)
				: null;
		// Markdown can't separate adjacent same-marker lists with a blank
		// line alone — they'd merge into one loose list on reparse. An HTML
		// comment (which round-trips) keeps them apart.
		if (listTag !== null && listTag === previousListTag) {
			parts.push("<!-- -->");
		}
		previousListTag = listTag;
		parts.push(part);
	}
	return parts.join("\n\n");
}

function listTagOf(el: HtmlElementLike): string | null {
	const tag = el.tagName.toLowerCase();
	return tag === "ul" || tag === "ol" ? tag : null;
}

function serializeBlockNode(node: DomNodeLike): string {
	if (node.nodeType === TEXT_NODE) {
		const raw = node.textContent ?? "";
		const trimmed = raw.trim();
		return trimmed ? normalizeBlockLines(escapeMarkdownText(trimmed)) : "";
	}
	// Comments round-trip (markdown passes HTML comments through); losing
	// them would also silently merge adjacent lists (see serializeBlocks).
	if (node.nodeType === COMMENT_NODE) {
		return `<!--${node.textContent ?? ""}-->`;
	}
	if (node.nodeType !== ELEMENT_NODE) return "";

	const el = node as HtmlElementLike;
	const tag = el.tagName.toLowerCase();

	switch (tag) {
		// Headings serialize with `stripEmphasis: true` — editors hide
		// bold/italic on headings, but keyboard shortcuts (Cmd+B / Cmd+I)
		// and pasted markup can still introduce <strong>/<em> inside one.
		// Stripping the markers here is the round-trip safety net so a
		// heading never emits `**`/`*`/`~~` into the markdown.
		case "h1":
			return serializeHeading(el, 1);
		case "h2":
			return serializeHeading(el, 2);
		case "h3":
			return serializeHeading(el, 3);
		case "h4":
			return serializeHeading(el, 4);
		case "h5":
			return serializeHeading(el, 5);
		case "h6":
			return serializeHeading(el, 6);
		case "p":
			return liftLineStartComments(
				normalizeBlockLines(serializeInline(el).trim()),
			);
		case "ul":
			return serializeList(el, false);
		case "ol":
			return serializeList(el, true);
		case "blockquote":
			return serializeBlockquote(el);
		case "pre":
			return serializeCodeBlock(el);
		case "hr":
			return "---";
		case "table":
			return serializeTable(el);
		case "img":
			// A bare block-level image (contenteditable artifact); marked
			// re-wraps it in a paragraph, which serializes back identically.
			return serializeImage(el);
		case "section":
			if (el.hasAttribute("data-footnotes")) return serializeFootnotes(el);
			return el.outerHTML;
		case "div":
			// Common contenteditable artifact — an empty <div> between
			// paragraphs from Chrome's Enter-key handling. Recurse into
			// children as if it were transparent.
			return serializeBlocks(el);
		default:
			// Tags on CommonMark's HTML-block list pass through raw and
			// unparsed, so outerHTML is byte-stable for them. Anything else
			// reparses in *paragraph* context (its text is markdown-parsed),
			// so serialize it as a paragraph of inline content — block
			// children inside it (invalid-HTML artifacts) split out.
			if (HTML_BLOCK_TAGS.has(tag)) return el.outerHTML;
			return serializeStrayBlockElement(el);
	}
}

/** Block-level tags that must split out of a stray inline wrapper. */
const SPLITTING_BLOCK_TAGS = new Set([
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"blockquote",
	"pre",
	"table",
	"hr",
	"ul",
	"ol",
]);

/**
 * A non-HTML-block element at block position (e.g. `<b>` from an HTML
 * block, custom elements). It reparses in paragraph context, so it
 * serializes as raw tags around escaped inline content — but block
 * children (a `<pre>` swallowed into a `<b>` by tree construction) must
 * become their own blocks, mirroring how the reparse splits them.
 */
function serializeStrayBlockElement(el: HtmlElementLike): string {
	const kids = nonVanishingChildren(el);
	const hasBlockChild = kids.some(
		(n) =>
			n.nodeType === ELEMENT_NODE &&
			SPLITTING_BLOCK_TAGS.has((n as HtmlElementLike).tagName.toLowerCase()),
	);
	if (!hasBlockChild) {
		return normalizeBlockLines(
			serializeInlineElement("", el, false, undefined).trim(),
		);
	}
	const parts: string[] = [];
	let inline = "";
	const flushInline = (): void => {
		const clamped = clampTagInner(inline).trim();
		if (clamped !== "") {
			parts.push(normalizeBlockLines(rawInlineTag(el, clamped).trim()));
		}
		inline = "";
	};
	for (let i = 0; i < kids.length; i++) {
		const kid = kids[i] as DomNodeLike;
		if (kid.nodeType === TEXT_NODE) {
			inline += escapeMarkdownText(kid.textContent ?? "");
			continue;
		}
		if (kid.nodeType === COMMENT_NODE) {
			flushInline();
			parts.push(`<!--${kid.textContent ?? ""}-->`);
			continue;
		}
		if (kid.nodeType !== ELEMENT_NODE) continue;
		const childEl = kid as HtmlElementLike;
		if (SPLITTING_BLOCK_TAGS.has(childEl.tagName.toLowerCase())) {
			flushInline();
			parts.push(serializeBlockNode(childEl));
		} else {
			inline = serializeInlineElement(inline, childEl, false, kids[i + 1]);
		}
	}
	flushInline();
	return parts.filter((p) => p !== "").join("\n\n");
}

/**
 * CommonMark HTML-block (type 1/6) tag names barkdown doesn't already
 * handle: for these, marked passes content through without markdown
 * parsing, so raw outerHTML round-trips byte-for-byte.
 */
const HTML_BLOCK_TAGS = new Set([
	"address",
	"article",
	"aside",
	"base",
	"basefont",
	"body",
	"caption",
	"center",
	"col",
	"colgroup",
	"dd",
	"details",
	"dialog",
	"dir",
	"dl",
	"dt",
	"fieldset",
	"figcaption",
	"figure",
	"footer",
	"form",
	"frame",
	"frameset",
	"head",
	"header",
	"html",
	"iframe",
	"legend",
	"li",
	"link",
	"main",
	"menu",
	"menuitem",
	"meta",
	"nav",
	"noframes",
	"optgroup",
	"option",
	"param",
	"script",
	"search",
	"style",
	"summary",
	"tbody",
	"td",
	"textarea",
	"tfoot",
	"th",
	"thead",
	"title",
	"tr",
	"track",
]);

/**
 * ATX headings are single-line: internal line breaks collapse to spaces,
 * and a trailing `#` run gets escaped so it can't read as a closing
 * sequence.
 */
function serializeHeading(el: HtmlElementLike, level: number): string {
	let content = serializeInline(el, true).trim();
	content = content.replace(/[ \t]*\n[ \t]*/g, " ");
	content = content.replace(/(^|[ \t])(#+)$/, "$1\\$2");
	return `${"#".repeat(level)} ${content}`;
}

/**
 * Canonicalize the lines of a paragraph-like block:
 * - leading whitespace is stripped (markdown can't represent it — the
 *   parser strips continuation-line indent, so keeping it would defeat
 *   idempotence);
 * - trailing whitespace is stripped, except a two-plus-space hard break
 *   before another line, which normalizes to exactly two spaces;
 * - characters that would start a different block construct at a line
 *   start are escaped.
 */
function normalizeBlockLines(text: string): string {
	const lines = text.split("\n");
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		let line = (lines[i] ?? "").replace(/^[ \t]+/, "");
		const isLast = i === lines.length - 1;
		const trailingSpaces = line.match(/ +$/)?.[0] ?? "";
		line = line.replace(/[ \t]+$/, "");
		line = escapeLineStart(line);
		// A hard break survives only before a non-blank line (a blank line
		// ends the paragraph, where trailing spaces are stripped).
		const nextIsContent = (lines[i + 1] ?? "").trim() !== "";
		if (!isLast && nextIsContent && trailingSpaces.length >= 2 && line !== "")
			line += "  ";
		out.push(line);
	}
	return out.join("\n");
}

/**
 * A paragraph line that *starts* with an HTML comment reparses as a raw
 * HTML block that swallows the rest of the line unparsed — escapes after
 * it would double every trip. Lift such comments into their own blocks
 * (which is exactly the shape reparsing produces).
 */
function liftLineStartComments(text: string): string {
	if (!text.includes("<!--")) return text;
	const blocks: string[] = [];
	let current: string[] = [];
	const flush = (): void => {
		if (current.length > 0) {
			// The block's final line can't keep a hard-break marker — the
			// parser strips trailing spaces at a paragraph end.
			const lastIndex = current.length - 1;
			current[lastIndex] = (current[lastIndex] ?? "").replace(/ +$/, "");
			blocks.push(current.join("\n"));
			current = [];
		}
	};
	for (const originalLine of text.split("\n")) {
		let line = originalLine;
		let m = line.match(/^(<!--[\s\S]*?-->)[ \t]*(.*)$/);
		while (m) {
			flush();
			blocks.push(m[1] ?? "");
			// The remainder now sits at a fresh line start — re-apply the
			// line-start escapes.
			line = escapeLineStart(m[2] ?? "");
			m = line.match(/^(<!--[\s\S]*?-->)[ \t]*(.*)$/);
		}
		// Keep pre-existing blank lines; drop a line that became empty
		// because it was only comments.
		if (line !== "" || line === originalLine) current.push(line);
	}
	flush();
	return blocks.join("\n\n");
}

/**
 * Escape text that would parse as a block construct at a line start.
 * Characters that are special *everywhere* (`*`, `_`, `` ` ``, `~`, `[`)
 * are already escaped by `escapeMarkdownText`; this handles the
 * line-start-only markers the escaper deliberately leaves alone.
 */
function escapeLineStart(line: string): string {
	if (line === "") return line;
	// ATX heading: 1–6 hashes then space or end.
	if (/^#{1,6}(\s|$)/.test(line)) return `\\${line}`;
	// Blockquote: any leading `>` (space optional).
	if (line.startsWith(">")) return `\\${line}`;
	// Table row / delimiter starting with a pipe.
	if (line.startsWith("|")) return `\\${line}`;
	// Bullet list marker (`*` is already escaped in text).
	if (/^[-+](\s|$)/.test(line)) return `\\${line}`;
	// Ordered list marker.
	const ordered = line.match(/^(\d{1,9})[.)](\s|$)/);
	if (ordered) {
		const digits = ordered[1] ?? "";
		return `${digits}\\${line.slice(digits.length)}`;
	}
	// Setext underline / thematic break / table delimiter row: a line of
	// nothing but -, =, :, | and spaces.
	if (/^[-=:|\s]+$/.test(line) && /[-=:|]/.test(line)) return `\\${line}`;
	return line;
}

/**
 * Serialize inline content (children of a block) as markdown.
 * `nextAfterContainer` is what follows the container itself — forwarded
 * to the last child so boundary decisions (bare autolinks, flanking) see
 * through transparent wrappers.
 */
function serializeInline(
	container: HtmlElementLike,
	stripEmphasis = false,
	allowLeadingCheckbox = false,
	nextAfterContainer?: DomNodeLike,
	precedingText = "",
): string {
	// Seeded with what precedes the container so first-child boundary
	// decisions (delimiter adjacency, flanking) see through transparent
	// wrappers; the seed is sliced back off before returning.
	let out = precedingText;
	let trimLeading = false;
	// Wrappers that emit nothing are dropped up front so they can't skew
	// next-sibling boundary decisions (they won't exist next trip).
	const nodes = nonVanishingChildren(container);
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i] as DomNodeLike;
		// GFM task-list checkbox (loose items: marked nests it in the
		// item's first <p>) is only recognized in leading position.
		const allowCheckbox = allowLeadingCheckbox && out === precedingText;
		const take = takeInlineToken(node, trimLeading, allowCheckbox);
		if (take) {
			trimLeading = take.trimLeading;
			out += take.text;
			continue;
		}
		if (node.nodeType === COMMENT_NODE) {
			out += `<!--${node.textContent ?? ""}-->`;
			continue;
		}
		if (node.nodeType !== ELEMENT_NODE) continue;
		trimLeading = false;
		out = serializeInlineElement(
			out,
			node as HtmlElementLike,
			stripEmphasis,
			nodes[i + 1] ?? nextAfterContainer,
		);
	}
	return out.slice(precedingText.length);
}

/**
 * True for transparent wrapper elements that serialize to exactly ""
 * (recursively empty div/p/span). They vanish on the next trip, so
 * boundary decisions (e.g. bare autolinks) must not see them.
 */
function isVanishingNode(node: DomNodeLike): boolean {
	if (node.nodeType !== ELEMENT_NODE) return false;
	const el = node as HtmlElementLike;
	const tag = el.tagName.toLowerCase();
	if (tag !== "div" && tag !== "p" && tag !== "span") return false;
	if (tag === "span") {
		const style = el.getAttribute("style") ?? "";
		if (/font-weight|font-style|text-decoration/i.test(style)) return false;
	}
	for (const child of arrayFrom(el.childNodes)) {
		if (!isVanishingNode(child)) return false;
	}
	return true;
}

/**
 * Child nodes minus the vanishing wrappers (see `isVanishingNode`) —
 * the node sequence every walker iterates.
 */
function nonVanishingChildren(el: HtmlElementLike): DomNodeLike[] {
	return arrayFrom(el.childNodes).filter((n) => !isVanishingNode(n));
}

/**
 * Shared token handling for the two checkbox-aware inline walkers
 * (`serializeInline`, `serializeListItem`); null = walker-specific node.
 * - A text node escapes for markdown. While `trimLeading` is set (a
 *   task-list checkbox marker was just emitted, carrying its own
 *   trailing space so the space marked renders after the input isn't
 *   doubled), leading whitespace is swallowed; trimming stays armed
 *   across whitespace-only nodes.
 * - A checkbox input in leading position becomes the GFM task marker
 *   (`[x] ` / `[ ] `) and arms `trimLeading`.
 */
function takeInlineToken(
	node: DomNodeLike,
	trimLeading: boolean,
	allowCheckbox: boolean,
): { text: string; trimLeading: boolean } | null {
	if (node.nodeType === TEXT_NODE) {
		let text = node.textContent ?? "";
		if (trimLeading) {
			const stripped = text.replace(/^[ \t]+/, "");
			if (stripped !== "") trimLeading = false;
			text = stripped;
		}
		return { text: escapeMarkdownText(text), trimLeading };
	}
	const isElement = node.nodeType === ELEMENT_NODE;
	if (allowCheckbox && isElement && isCheckboxInput(node as HtmlElementLike)) {
		const checked = (node as HtmlElementLike).hasAttribute("checked");
		return { text: checked ? "[x] " : "[ ] ", trimLeading: true };
	}
	return null;
}

function isCheckboxInput(el: HtmlElementLike): boolean {
	return (
		el.tagName.toLowerCase() === "input" &&
		(el.getAttribute("type") ?? "").toLowerCase() === "checkbox"
	);
}

/**
 * Append one inline element to the accumulated markdown `out` and return
 * the new accumulation. (Takes `out` because some constructs must adjust
 * what precedes them, e.g. escaping a trailing `!` before a link.)
 */
function serializeInlineElement(
	out: string,
	el: HtmlElementLike,
	stripEmphasis: boolean,
	next: DomNodeLike | undefined,
): string {
	const tag = el.tagName.toLowerCase();
	switch (tag) {
		case "strong":
		case "b":
			return out + emphasisMarkup(el, "**", stripEmphasis, out, next);
		case "em":
		case "i":
			return out + emphasisMarkup(el, "*", stripEmphasis, out, next);
		case "s":
		case "strike":
		case "del":
			return out + emphasisMarkup(el, "~~", stripEmphasis, out, next);
		case "div":
		case "p":
			// Wrappers in an inline position (contenteditable artifacts,
			// paragraphs inside odd containers): transparent, unwrapping
			// every level in a single pass. The wrapper's own next sibling
			// and preceding output are forwarded for boundary decisions.
			return out + serializeInline(el, stripEmphasis, false, next, out);
		case "a":
			return appendAnchor(out, el, stripEmphasis, next);
		case "code":
			// Inline code — no escaping inside backticks.
			return out + serializeCodeSpan(el.textContent ?? "");
		case "img":
			return out + serializeImage(el);
		case "br":
			// Two-space hard break in markdown.
			return `${out}  \n`;
		case "sup":
			return appendFootnoteRef(out, el);
		case "span":
			return appendSpan(out, el, stripEmphasis, next);
		default:
			return out + unknownInlineMarkup(el);
	}
}

/**
 * Emphasis element (`strong`/`em`/`del` and aliases). In `stripEmphasis`
 * mode (headings) recurse without the markers so emphasized text inside
 * a heading flattens; otherwise wrap in the delimiter with the raw-tag
 * fallback.
 */
function emphasisMarkup(
	el: HtmlElementLike,
	marker: string,
	stripEmphasis: boolean,
	before: string,
	next: DomNodeLike | undefined,
): string {
	return stripEmphasis
		? serializeInline(el, true)
		: wrapOrRawTag(el, serializeInline(el), marker, before, next);
}

/** `<a>` → bare autolink, `[text](dest "title")`, or raw-anchor fallback. */
function appendAnchor(
	out: string,
	el: HtmlElementLike,
	stripEmphasis: boolean,
	next: DomNodeLike | undefined,
): string {
	const href = el.getAttribute("href") ?? "";
	const title = el.getAttribute("title");
	const inner = serializeInline(el, stripEmphasis);
	if (!href) return out + inner;
	// Canonical form for self-links is the bare GFM autolink —
	// marked linkifies bare URLs/emails, so emitting the full
	// [text](url) form here would never re-read as written.
	// Only safe when both source boundaries stay delimiters.
	if (
		title === null &&
		isBareAutolinkable(href, el.textContent ?? "", out) &&
		autolinkBoundaryAfter(next)
	) {
		return out + (el.textContent ?? "");
	}
	// marked quirk: inside link text an escaped `\[…\]` pair followed
	// by `(` re-parses as a nested link/image despite the escapes.
	// A raw anchor round-trips stably.
	if (LINK_TEXT_QUIRK.test(inner)) {
		return out + rawAnchorTag(el, inner);
	}
	const dest = encodeLinkDestination(href);
	return (
		escapeTrailingBang(out) +
		(title === null
			? `[${inner}](${dest})`
			: `[${inner}](${dest} "${escapeLinkTitle(title)}")`)
	);
}

/** `<sup>` footnote reference → `[^label]`, else unknown-markup fallback. */
function appendFootnoteRef(out: string, el: HtmlElementLike): string {
	const label = footnoteRefLabel(el);
	if (label === null) return out + unknownInlineMarkup(el);
	return `${escapeTrailingBang(out)}[^${label}]`;
}

/**
 * Resolve a `<sup>` element's footnote label, or null when it isn't a
 * recognizable footnote reference. Two shapes:
 *   - marked-footnote: <sup><a id="footnote-ref-N"
 *                              data-footnote-ref>N</a></sup>
 *   - legacy: <sup data-footnote-ref="N">N</sup>
 * Labels aren't only numeric: `[^note]` yields id="footnote-ref-note"
 * while the *displayed* text is the footnote's index.
 */
function footnoteRefLabel(el: HtmlElementLike): string | null {
	const legacyAttr = el.getAttribute("data-footnote-ref");
	if (legacyAttr && legacyAttr.length > 0) return legacyAttr;
	const anchor = el.querySelector("a[data-footnote-ref]");
	if (!anchor) return null;
	// The href points at the definition and is the authoritative
	// label; the anchor id gets a `-2` suffix on repeated refs to
	// the same footnote, so it's only a fallback.
	const hrefMatch = (anchor.getAttribute("href") ?? "").match(
		/#footnote-([A-Za-z0-9_-]+)$/,
	);
	const idMatch = anchor.id.match(/footnote-ref-([A-Za-z0-9_-]+)$/);
	const label = hrefMatch?.[1] ?? idMatch?.[1] ?? anchor.textContent?.trim();
	if (label && /^[A-Za-z0-9_-]+$/.test(label)) return label;
	return null;
}

/**
 * Contenteditable + browsers frequently produce structural <span>s with
 * no semantic meaning; treat as transparent — but detect inline emphasis
 * styling (font-weight / font-style / line-through) so CSS-styled spans
 * (e.g. pasted from Word or Google Docs) still round-trip to **\/*\/~~
 * instead of silently losing the emphasis.
 */
function appendSpan(
	out: string,
	el: HtmlElementLike,
	stripEmphasis: boolean,
	next: DomNodeLike | undefined,
): string {
	const markers = stripEmphasis ? [] : spanEmphasisMarkers(el);
	if (markers.length === 0) {
		// Transparent spans forward the surrounding context (next sibling
		// and preceding output) for boundary decisions.
		return out + serializeInline(el, stripEmphasis, false, next, out);
	}
	return out + styledSpanMarkup(el, markers, out, next);
}

/**
 * Emphasis markers implied by a span's inline styling, innermost first
 * (the order they wrap the content in).
 */
function spanEmphasisMarkers(el: HtmlElementLike): string[] {
	const style = el.style;
	const fw = style?.fontWeight ?? "";
	const isBold =
		fw === "bold" || fw === "bolder" || (/^\d+$/.test(fw) && Number(fw) >= 600);
	const isItalic = (style?.fontStyle ?? "") === "italic";
	const deco = `${style?.textDecoration ?? ""} ${style?.textDecorationLine ?? ""}`;
	const markers: string[] = [];
	if (deco.includes("line-through")) markers.push("~~");
	if (isItalic) markers.push("*");
	if (isBold) markers.push("**");
	return markers;
}

/**
 * Wrap a styled span's content in its emphasis markers. Styled spans
 * start fresh (their content sits inside the markers) rather than
 * forwarding the surrounding context.
 */
function styledSpanMarkup(
	el: HtmlElementLike,
	markers: string[],
	before: string,
	next: DomNodeLike | undefined,
): string {
	let inner = serializeInline(el);
	for (const marker of markers) {
		const wrapped = tryWrapDelimited(inner, marker, before, next);
		if (wrapped === null) {
			// Unrepresentable (empty or ambiguous delimiter run):
			// a raw styled span with the escaped inner content
			// round-trips stably and keeps the styling.
			return rawInlineTag(el, serializeInline(el));
		}
		inner = wrapped;
	}
	return inner;
}

/** Void elements: no closing tag when rebuilding unknown markup. */
const VOID_TAGS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

/**
 * Rebuild an unknown inline element as raw tags around its markdown-
 * escaped serialized children. `outerHTML` would be unstable here:
 * marked parses the text between raw inline tags as markdown, so
 * unescaped `*`/`\` text characters would change structure next trip.
 * The rebuilt form reparses to the identical DOM.
 */
function unknownInlineMarkup(el: HtmlElementLike): string {
	const names = el.getAttributeNames?.();
	if (names === undefined) return el.outerHTML; // adapter can't enumerate
	const tag = el.tagName.toLowerCase();
	const attrs = names
		.map((name) => ` ${name}="${escapeHtmlAttr(el.getAttribute(name) ?? "")}"`)
		.join("");
	if (VOID_TAGS.has(tag)) return `<${tag}${attrs}>`;
	return `<${tag}${attrs}>${clampTagInner(serializeInline(el))}</${tag}>`;
}

/**
 * Inner content of a rebuilt raw tag must not leave the open tag (or the
 * closing tag) alone on its own line — that shape is a CommonMark type-7
 * HTML block, which would swallow the following lines unparsed. Leading/
 * trailing newline-bearing whitespace is normalized away.
 */
function clampTagInner(inner: string): string {
	return inner.replace(/^[ \t]*\n\s*/, "").replace(/\s*\n[ \t]*$/, "");
}

/** Serialize a `<ul>` or `<ol>` (recursive for nested lists). */
function serializeList(el: HtmlElementLike, ordered: boolean): string {
	const lines: string[] = [];
	// marked emits start="N" when an ordered list doesn't begin at 1;
	// renumbering from 1 would silently rewrite the document.
	let index = 1;
	if (ordered) {
		const startAttr = (el.getAttribute("start") ?? "").trim();
		if (/^\d{1,9}$/.test(startAttr)) index = Number(startAttr);
	}
	for (const child of arrayFrom(el.children)) {
		if (child.tagName.toLowerCase() !== "li") continue;
		const marker = ordered ? `${index}.` : "-";
		const childIndent = marker.length + 1;
		const itemBody = serializeListItem(child, childIndent);
		// No trailing whitespace on the final line (empty items, trailing
		// hard breaks): the parser strips it, so it can't round-trip.
		let composed = `${marker} ${itemBody}`.replace(/ +$/, "");
		// Chained empty nested lists or a leading hr can compose a line of
		// only dashes and spaces ("- - -", "- ---"), which reparses as a
		// thematic break — drop the item body to its own (indented) line.
		const firstLine = (composed.split("\n", 1)[0] ?? "").trimEnd();
		if (
			/^[- ]+$/.test(firstLine) &&
			(firstLine.match(/-/g) ?? []).length >= 3
		) {
			composed = `${marker}\n${itemBody
				.split("\n")
				.map((l) => " ".repeat(childIndent) + l)
				.join("\n")}`;
		}
		lines.push(composed);
		index++;
	}
	return lines.join("\n");
}

/** Block-level tags a list item can legally contain in marked's output. */
const LIST_ITEM_BLOCK_TAGS = new Set([
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"blockquote",
	"pre",
	"table",
	"hr",
]);

/**
 * Serialize an `<li>`. The item body is a sequence of parts — inline
 * runs, nested lists, and block children — joined by single newlines
 * (canonical lists are tight) with continuation lines indented to the
 * item's content column. A leading checkbox input becomes a GFM task
 * marker (`[x] ` / `[ ] `).
 */
function serializeListItem(li: HtmlElementLike, childIndent: number): string {
	const acc: ListItemAccumulator = { parts: [], inline: "" };
	let trimLeading = false;
	const nodes = nonVanishingChildren(li);
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i] as DomNodeLike;
		// GFM task-list checkbox (tight items: direct child of the li) is
		// only recognized before any other content.
		const isFirst = acc.parts.length === 0 && acc.inline === "";
		const take = takeInlineToken(node, trimLeading, isFirst);
		if (take) {
			trimLeading = take.trimLeading;
			acc.inline += take.text;
			continue;
		}
		if (node.nodeType === COMMENT_NODE) {
			appendListItemComment(acc, node);
			continue;
		}
		if (node.nodeType !== ELEMENT_NODE) continue;
		trimLeading = false;
		appendListItemElement(acc, node as HtmlElementLike, nodes[i + 1]);
	}
	flushListItemInline(acc);
	return indentContinuationLines(acc.parts.join("\n"), childIndent);
}

/** In-flight `<li>` body: finished parts + the accumulating inline run. */
interface ListItemAccumulator {
	parts: string[];
	inline: string;
}

/**
 * Close the accumulating inline run into finished parts. Line-start
 * comments must become their own parts (see `appendListItemComment`);
 * blank lines are dropped — a blank line inside an item would split it
 * into a loose item, which reparses differently.
 */
function flushListItemInline(acc: ListItemAccumulator): void {
	if (acc.inline === "") return;
	const lifted = liftLineStartComments(normalizeBlockLines(acc.inline));
	for (const block of lifted.split("\n\n")) {
		const kept = block
			.split("\n")
			.filter((line) => line.trim() !== "")
			.join("\n")
			// A hard break can't end a part — the parser strips trailing
			// spaces at the end of a paragraph.
			.replace(/ +$/, "");
		if (kept.trim() !== "") acc.parts.push(kept);
	}
	acc.inline = "";
}

/**
 * A comment that would *start* a line must own that line: a line
 * starting with `<!--` is one raw HTML block to the end of the line, so
 * any escaped text after it would go through raw and re-escape every
 * trip. Mid-line comments are plain inline HTML.
 */
function appendListItemComment(
	acc: ListItemAccumulator,
	node: DomNodeLike,
): void {
	const comment = `<!--${node.textContent ?? ""}-->`;
	if (acc.inline === "" || acc.inline.endsWith("\n")) {
		flushListItemInline(acc);
		acc.parts.push(comment);
	} else {
		acc.inline += comment;
	}
}

/** An element child of an `<li>`: nested list, paragraph, block, or inline. */
function appendListItemElement(
	acc: ListItemAccumulator,
	child: HtmlElementLike,
	next: DomNodeLike | undefined,
): void {
	const tag = child.tagName.toLowerCase();
	if (tag === "ul" || tag === "ol") {
		flushListItemInline(acc);
		acc.parts.push(serializeList(child, tag === "ol"));
	} else if (tag === "p") {
		// Paragraphs flatten to continuation lines: canonical lists are
		// tight, so loose input converges to tight output.
		const isFirstContent = acc.parts.length === 0 && acc.inline === "";
		if (acc.inline) acc.inline += "\n";
		acc.inline += serializeInline(child, false, isFirstContent);
	} else if (LIST_ITEM_BLOCK_TAGS.has(tag)) {
		flushListItemInline(acc);
		acc.parts.push(serializeBlockNode(child));
	} else {
		// Inline element: same handling as inside any other block
		// (divs are transparent there too).
		acc.inline = serializeInlineElement(acc.inline, child, false, next);
	}
}

/**
 * Indent every line after the first (blank lines excepted) to a list
 * item's content column.
 */
function indentContinuationLines(body: string, indent: number): string {
	return body
		.split("\n")
		.map((line, idx) =>
			idx === 0 || line === "" ? line : " ".repeat(indent) + line,
		)
		.join("\n");
}

/**
 * marked quirk detector: inside link text (and image alt), an escaped
 * `\[…\]` pair followed by `(` re-parses as a nested construct even
 * though the brackets are escaped. Callers fall back to raw tags.
 */
const LINK_TEXT_QUIRK = /\\\[[\s\S]*?\\\]\(|\\\[\^/;

/** Raw-HTML anchor fallback for link text markdown can't carry. */
function rawAnchorTag(el: HtmlElementLike, inner: string): string {
	const href = el.getAttribute("href") ?? "";
	const title = el.getAttribute("title");
	const titleAttr = title === null ? "" : ` title="${escapeHtmlAttr(title)}"`;
	return `<a href="${escapeHtmlAttr(href)}"${titleAttr}>${inner}</a>`;
}

function escapeHtmlAttr(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** `<img>` → `![alt](src "title")` (title optional). */
function serializeImage(el: HtmlElementLike): string {
	const src = el.getAttribute("src") ?? "";
	const rawAlt = el.getAttribute("alt") ?? "";
	const alt = rawAlt.replace(/([\\[\]])/g, "\\$1").replace(/\n/g, " ");
	const title = el.getAttribute("title");
	if (LINK_TEXT_QUIRK.test(alt)) {
		const titleAttr = title === null ? "" : ` title="${escapeHtmlAttr(title)}"`;
		return `<img src="${escapeHtmlAttr(src)}" alt="${escapeHtmlAttr(rawAlt)}"${titleAttr}>`;
	}
	const dest = encodeLinkDestination(src);
	return title === null
		? `![${alt}](${dest})`
		: `![${alt}](${dest} "${escapeLinkTitle(title)}")`;
}

/**
 * `<table>` → GFM pipe table. marked emits `<thead>`/`<tbody>` with an
 * `align` attribute per cell; contenteditable tables may use
 * `style="text-align: …"` instead — both are read. Pipes inside cell
 * content are escaped (GFM cell boundaries split on unescaped `|`
 * everywhere, even inside code spans).
 */
function serializeTable(el: HtmlElementLike): string {
	const rows: HtmlElementLike[] = [];
	const collectRows = (parent: HtmlElementLike): void => {
		for (const child of arrayFrom(parent.children)) {
			const tag = child.tagName.toLowerCase();
			if (tag === "tr") rows.push(child);
			else if (tag === "thead" || tag === "tbody" || tag === "tfoot") {
				collectRows(child);
			}
		}
	};
	collectRows(el);
	const headerRow = rows[0];
	if (!headerRow) return el.outerHTML;
	const headerCells = tableCells(headerRow);
	if (headerCells.length === 0) return el.outerHTML;

	const delimiter = headerCells
		.map((cell) => {
			const align = (
				cell.getAttribute("align") ??
				cell.style?.textAlign ??
				""
			).toLowerCase();
			if (align === "center") return ":---:";
			if (align === "right") return "---:";
			if (align === "left") return ":---";
			return "---";
		})
		.join(" | ");

	const lines: string[] = [];
	lines.push(tableRowLine(headerCells));
	lines.push(`| ${delimiter} |`);
	for (const row of rows.slice(1)) {
		lines.push(tableRowLine(tableCells(row)));
	}
	return lines.join("\n");
}

function tableCells(row: HtmlElementLike): HtmlElementLike[] {
	return arrayFrom(row.children).filter((cell) => {
		const tag = cell.tagName.toLowerCase();
		return tag === "th" || tag === "td";
	});
}

function tableRowLine(cells: HtmlElementLike[]): string {
	const rendered = cells.map((cell) =>
		serializeInline(cell)
			.trim()
			.replace(/[ \t]*\n[ \t]*/g, " ")
			.replace(/\|/g, "\\|"),
	);
	return `| ${rendered.join(" | ")} |`;
}

/**
 * Fallback for emphasis that markdown delimiters can't express: emit the
 * element as raw inline tags (all attributes preserved) around the
 * markdown-escaped inner content. (Not `outerHTML` — marked reparses the
 * text between raw inline tags as markdown, so unescaped `*`/`\` text
 * characters would change structure on the next trip. The escaped
 * serialization reparses to the identical DOM.)
 */
function rawInlineTag(el: HtmlElementLike, inner: string): string {
	const tag = el.tagName.toLowerCase();
	const attrs = (el.getAttributeNames?.() ?? [])
		.map((name) => ` ${name}="${escapeHtmlAttr(el.getAttribute(name) ?? "")}"`)
		.join("");
	return `<${tag}${attrs}>${clampTagInner(inner)}</${tag}>`;
}

/** Emphasis wrap with the raw-tag fallback (see tryWrapDelimited). */
function wrapOrRawTag(
	el: HtmlElementLike,
	inner: string,
	marker: string,
	before: string,
	next: DomNodeLike | undefined,
): string {
	return (
		tryWrapDelimited(inner, marker, before, next) ?? rawInlineTag(el, inner)
	);
}

/**
 * Render a code span. The delimiter must be a longer backtick run than
 * any inside the content; content that starts/ends with a backtick (or
 * with spaces on both ends) is padded per CommonMark's stripping rule.
 * Newlines become spaces — the parser does that anyway.
 */
function serializeCodeSpan(text: string): string {
	const content = text.replace(/\n/g, " ");
	if (content === "") return "";
	let maxRun = 0;
	for (const match of content.matchAll(/`+/g)) {
		if (match[0].length > maxRun) maxRun = match[0].length;
	}
	const fence = "`".repeat(maxRun + 1);
	const needsPad =
		content.startsWith("`") ||
		content.endsWith("`") ||
		(content.startsWith(" ") && content.endsWith(" ") && content.trim() !== "");
	const pad = needsPad ? " " : "";
	return fence + pad + content + pad + fence;
}

/**
 * A link can serialize as bare autolink text only when marked would
 * re-linkify it identically: text === href (or mailto:text), a
 * conservative URL/email shape, a plain domain, and an end character
 * outside the trailing-punctuation trim set. marked's GFM text rule
 * stops before `https?://` at ANY position, so URLs need no preceding
 * boundary check.
 */
function isBareAutolinkable(
	href: string,
	text: string,
	before: string,
): boolean {
	if (href === `mailto:${text}`) {
		// marked only tokenizes an email after a non-local-part character.
		if (/[A-Za-z0-9._+-]$/.test(before)) return false;
		return /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(text);
	}
	if (href !== text) return false;
	if (!/^https?:\/\/[^\s<>()]+$/.test(text)) return false;
	if (!/[A-Za-z0-9/]$/.test(text)) return false;
	const domain = text.match(/^https?:\/\/([^/?#:]+)/)?.[1] ?? "";
	return /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(domain);
}

/**
 * …and only end cleanly when followed by whitespace. A next sibling that
 * starts with anything else would be absorbed into the linkified URL.
 */
/** Inline tags whose emission may start with markdown-active characters. */
const ACTIVE_INLINE_TAGS = new Set(["a", "code", "img", "sup", "input"]);

const EMPHASIS_TAGS = new Set(["strong", "b", "em", "i", "s", "strike", "del"]);

function autolinkBoundaryAfter(next: DomNodeLike | undefined): boolean {
	if (!next) return true; // end of the inline run — a block boundary follows
	if (next.nodeType === TEXT_NODE) return /^\s/.test(next.textContent ?? "");
	// Comments emit `<`, which terminates marked's URL scan cleanly.
	if (next.nodeType === COMMENT_NODE) return true;
	if (next.nodeType !== ELEMENT_NODE) return false;
	const el = next as HtmlElementLike;
	const tag = el.tagName.toLowerCase();
	if (tag === "br") return true;
	if (ACTIVE_INLINE_TAGS.has(tag)) return false;
	// Transparent wrappers contribute whatever their first child emits;
	// emphasis wrappers hoist leading whitespace *outside* their markers —
	// peek through both (vanishing wrappers are pre-filtered).
	if (
		tag === "div" ||
		tag === "p" ||
		tag === "span" ||
		EMPHASIS_TAGS.has(tag)
	) {
		if (tag === "span") {
			const style = el.getAttribute("style") ?? "";
			if (/font-weight|font-style|text-decoration/i.test(style)) {
				return false; // would emit emphasis markers first
			}
		}
		const kids = nonVanishingChildren(el);
		if (kids.length === 0) return true; // emits raw tags: `<` ends the scan
		return autolinkBoundaryAfter(kids[0]);
	}
	// Unknown elements rebuild as raw tags — `<` terminates the URL scan.
	return true;
}

/**
 * `text!` + `[link](…)` would reparse as an image. Escape a trailing
 * unescaped `!` before emitting a bracket construct.
 */
function escapeTrailingBang(out: string): string {
	const match = out.match(/(\\*)!$/);
	if (match && (match[1] ?? "").length % 2 === 0) {
		return `${out.slice(0, -1)}\\!`;
	}
	return out;
}

/**
 * Render a link/image destination. marked normalizes every destination
 * through `cleanUrl` (encodeURI), so we pre-apply the identical
 * transform — otherwise a non-ASCII destination comes back
 * percent-encoded and the second trip differs from the first. What
 * still contains parens/whitespace after encoding uses the `<…>` form.
 */
function encodeLinkDestination(href: string): string {
	let encoded = href;
	try {
		encoded = encodeURI(href).replace(/%25/g, "%");
	} catch {
		// lone surrogates etc — marked would drop the link; keep raw.
	}
	if (encoded === "") return "<>";
	if (/[\s<>()\\]/.test(encoded)) {
		return `<${encoded.replace(/\n/g, " ").replace(/([<>\\])/g, "\\$1")}>`;
	}
	return encoded;
}

function escapeLinkTitle(title: string): string {
	return title.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}

function serializeBlockquote(el: HtmlElementLike): string {
	const inner = serializeBlocks(el);
	return inner
		.split("\n")
		.map((line) => (line.length > 0 ? `> ${line}` : ">"))
		.join("\n");
}

function serializeCodeBlock(el: HtmlElementLike): string {
	const code = el.querySelector("code");
	let lang = "";
	let text: string;
	if (!code) {
		text = el.textContent ?? "";
	} else {
		for (const cls of (code.getAttribute("class") ?? "").split(/\s+/)) {
			if (cls.startsWith("language-")) {
				// Info strings resolve backslash escapes (so escape ours) and
				// can't contain backticks or whitespace.
				lang = cls
					.slice("language-".length)
					.replace(/\\/g, "\\\\")
					.replace(/[`\s]/g, "");
				break;
			}
		}
		text = code.textContent ?? "";
	}
	// marked emits a trailing newline inside <code>; strip exactly one so
	// the fence doesn't grow a blank line every round trip. Whitespace-only
	// content doesn't survive marked's fence trimming consistently —
	// canonicalize it to an empty block.
	text = text.replace(/\n$/, "");
	if (text.trim() === "") text = "";
	// A backtick run at a line start could close the fence early — use a
	// longer fence than any run the content opens a line with.
	let fenceLength = 3;
	for (const match of text.matchAll(/^ {0,3}(`{3,})/gm)) {
		const runLength = (match[1] ?? "").length;
		if (runLength >= fenceLength) fenceLength = runLength + 1;
	}
	const fence = "`".repeat(fenceLength);
	if (text === "") return fence + lang + "\n" + fence;
	return fence + lang + "\n" + text + "\n" + fence;
}

/**
 * Emit `[^n]: text` lines for the trailing `<section data-footnotes>`
 * that marked-footnote produces. Strips the "back to reference" links
 * that the extension appends.
 */
function serializeFootnotes(el: HtmlElementLike): string {
	const items: string[] = [];
	const ol = el.querySelector("ol");
	if (!ol) return el.outerHTML;
	for (const li of arrayFrom(ol.children)) {
		if (li.tagName.toLowerCase() !== "li") continue;
		const id = li.id || "";
		// Match `footnote-<label>` (marked-footnote — labels aren't only
		// numeric) or `fn-N`/`fnN` (legacy).
		const idMatch =
			id.match(/^footnote-([A-Za-z0-9_-]+)$/) ?? id.match(/^fn[-:]?(\d+)$/);
		const label = idMatch?.[1] ?? String(items.length + 1);
		const clone = li.cloneNode(true) as HtmlElementLike;
		for (const back of arrayFrom(
			clone.querySelectorAll(
				"[data-footnote-backref], [data-footnote-back-ref], .footnote-back, .footnote-backref",
			),
		)) {
			back.remove();
		}
		// marked-footnote wraps definition paragraphs in `<p>`s. Unwrap
		// them so `serializeInline` doesn't emit raw `<p>` tags; multiple
		// paragraphs become 4-space-indented continuation paragraphs.
		let text: string;
		const children = arrayFrom(clone.children).filter(
			(c) => c.tagName.toLowerCase() !== "br",
		);
		if (
			children.length >= 1 &&
			children.every((c) => c.tagName.toLowerCase() === "p")
		) {
			const paragraphs = children
				.map((p) => serializeInline(p).trim())
				.filter((s) => s !== "");
			text = indentContinuationLines(paragraphs.join("\n\n"), 4);
		} else {
			text = serializeInline(clone).trim();
		}
		items.push(`[^${label}]: ${text}`);
	}
	return items.join("\n");
}

/**
 * Escape the minimum set of markdown special characters. We
 * intentionally under-escape rather than over-escape:
 *  - `\` — in the class, and handled first, so it doesn't double-escape
 *    our own escapes.
 *  - `*` and `_` — emphasis markers.
 *  - `~` — GFM strikethrough (a single tilde pair delimits too).
 *  - `[` and `]` — link markers.
 *  - `` ` `` — code marker.
 *  - `<` — only when it could open a tag, autolink, or comment
 *    (followed by a letter, `/`, `!`, or `?`).
 *  - `&` — only when it reads as a character entity (`&copy;`, `&#38;`),
 *    which the DOM would decode on the next trip.
 *
 * We do NOT escape `#`, `-`, `+`, `>`, `|`, digits because those only
 * matter at a line start — `escapeLineStart` handles that positionally.
 * Escaping them everywhere would produce ugly output like `\-` in the
 * middle of hyphenated words.
 */
function escapeMarkdownText(text: string): string {
	return (
		text
			// `<` is escaped unconditionally: a `<` at a text-node edge can
			// combine with whatever the *next* node emits (or break marked's
			// emphasis scanning), and `\<` is stable in every context.
			.replace(/([\\`*_[\]~<])/g, "\\$1")
			.replace(
				/&(?=[a-zA-Z][a-zA-Z0-9]{1,31};|#\d{1,7};|#[xX][0-9a-fA-F]{1,6};)/g,
				"\\&",
			)
			// Defuse GFM extended autolinks: a bare URL/email in *text* (e.g.
			// from raw HTML-block content) would come back as a link element.
			// An escaped scheme colon / www dot / at-sign resolves to the same
			// text but never linkifies. No word-boundary guard: GFM links
			// after `_`/`*`/`~`/`(` too, which our escapes can put adjacent.
			// (Anchor elements don't take this path — real self-links
			// serialize as bare autolinks upstream.)
			.replace(/(https?)(?=:\/\/)/gi, "$1\\")
			.replace(/(www)(?=\.[A-Za-z0-9])/gi, "$1\\")
			.replace(
				/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~\\-]+(@)(?=[A-Za-z0-9-]+\.[A-Za-z0-9])/g,
				(match) => match.replace(/@$/, "\\@"),
			)
	);
}

/** Array.from over the minimal ArrayLike the adapter types expose. */
function arrayFrom<T>(list: ArrayLike<T>): T[] {
	return Array.from(list);
}
