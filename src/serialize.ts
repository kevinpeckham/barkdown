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

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

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

	const body = serializeBlocks(container).trimEnd();
	return body.length ? body + "\n" : "";
}

/** Serialize the direct-child sequence of an element as a list of blocks. */
function serializeBlocks(container: HtmlElementLike): string {
	const parts: string[] = [];
	for (const node of arrayFrom(container.childNodes)) {
		const part = serializeBlockNode(node);
		if (part !== "") parts.push(part);
	}
	return parts.join("\n\n");
}

function serializeBlockNode(node: DomNodeLike): string {
	if (node.nodeType === TEXT_NODE) {
		const raw = node.textContent ?? "";
		const trimmed = raw.trim();
		return trimmed ? escapeMarkdownText(trimmed) : "";
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
			return "# " + serializeInline(el, true).trim();
		case "h2":
			return "## " + serializeInline(el, true).trim();
		case "h3":
			return "### " + serializeInline(el, true).trim();
		case "h4":
			return "#### " + serializeInline(el, true).trim();
		case "h5":
			return "##### " + serializeInline(el, true).trim();
		case "h6":
			return "###### " + serializeInline(el, true).trim();
		case "p":
			return serializeInline(el).trim();
		case "ul":
			return serializeList(el, false, 0);
		case "ol":
			return serializeList(el, true, 0);
		case "blockquote":
			return serializeBlockquote(el);
		case "pre":
			return serializeCodeBlock(el);
		case "hr":
			return "---";
		case "section":
			if (el.hasAttribute("data-footnotes")) return serializeFootnotes(el);
			return el.outerHTML;
		case "div":
			// Common contenteditable artifact — an empty <div> between
			// paragraphs from Chrome's Enter-key handling. Recurse into
			// children as if it were transparent.
			return serializeBlocks(el);
		default:
			return el.outerHTML;
	}
}

/** Serialize inline content (children of a block) as markdown. */
function serializeInline(
	container: HtmlElementLike,
	stripEmphasis = false,
): string {
	let out = "";
	for (const node of arrayFrom(container.childNodes)) {
		if (node.nodeType === TEXT_NODE) {
			out += escapeMarkdownText(node.textContent ?? "");
			continue;
		}
		if (node.nodeType !== ELEMENT_NODE) continue;

		const el = node as HtmlElementLike;
		const tag = el.tagName.toLowerCase();

		switch (tag) {
			case "strong":
			case "b":
				// In `stripEmphasis` mode (headings) recurse without the
				// `**` markers so bold text inside a heading flattens.
				out += stripEmphasis
					? serializeInline(el, true)
					: "**" + serializeInline(el) + "**";
				break;
			case "em":
			case "i":
				out += stripEmphasis
					? serializeInline(el, true)
					: "*" + serializeInline(el) + "*";
				break;
			case "s":
			case "strike":
			case "del":
				out += stripEmphasis
					? serializeInline(el, true)
					: "~~" + serializeInline(el) + "~~";
				break;
			case "a": {
				const href = el.getAttribute("href") ?? "";
				const title = el.getAttribute("title");
				const inner = serializeInline(el, stripEmphasis);
				if (!href) {
					out += inner;
					break;
				}
				out += title ? `[${inner}](${href} "${title}")` : `[${inner}](${href})`;
				break;
			}
			case "code":
				// Inline code — no escaping inside backticks.
				out += "`" + (el.textContent ?? "") + "`";
				break;
			case "br":
				// Two-space hard break in markdown.
				out += "  \n";
				break;
			case "sup": {
				// Two shapes:
				//   - marked-footnote: <sup><a id="footnote-ref-N"
				//                              data-footnote-ref>N</a></sup>
				//   - legacy: <sup data-footnote-ref="N">N</sup>
				const legacyAttr = el.getAttribute("data-footnote-ref");
				if (legacyAttr && legacyAttr.length > 0) {
					out += `[^${legacyAttr}]`;
					break;
				}
				const anchor = el.querySelector("a[data-footnote-ref]");
				if (anchor) {
					const idMatch = anchor.id.match(/footnote-ref-(\d+)$/);
					const hrefMatch = (anchor.getAttribute("href") ?? "").match(
						/#footnote-(\d+)$/,
					);
					const num =
						idMatch?.[1] ?? hrefMatch?.[1] ?? anchor.textContent?.trim();
					if (num && /^\d+$/.test(num)) {
						out += `[^${num}]`;
						break;
					}
				}
				out += el.outerHTML;
				break;
			}
			case "span": {
				// Contenteditable + browsers frequently produce structural
				// <span>s with no semantic meaning; treat as transparent — but
				// detect inline emphasis styling (font-weight / font-style /
				// line-through) so CSS-styled spans (e.g. pasted from Word or
				// Google Docs) still round-trip to **/*/~~ instead of silently
				// losing the emphasis.
				let inner = serializeInline(el, stripEmphasis);
				if (!stripEmphasis) {
					const style = el.style;
					const fw = style?.fontWeight ?? "";
					const isBold =
						fw === "bold" ||
						fw === "bolder" ||
						(/^\d+$/.test(fw) && Number(fw) >= 600);
					const isItalic = (style?.fontStyle ?? "") === "italic";
					const deco = `${style?.textDecoration ?? ""} ${style?.textDecorationLine ?? ""}`;
					const isStrike = deco.includes("line-through");
					if (isStrike) inner = `~~${inner}~~`;
					if (isItalic) inner = `*${inner}*`;
					if (isBold) inner = `**${inner}**`;
				}
				out += inner;
				break;
			}
			default:
				out += el.outerHTML;
		}
	}
	return out;
}

/** Serialize a `<ul>` or `<ol>` (recursive for nested lists). */
function serializeList(
	el: HtmlElementLike,
	ordered: boolean,
	indent: number,
): string {
	const lines: string[] = [];
	let index = 1;
	for (const child of arrayFrom(el.children)) {
		if (child.tagName.toLowerCase() !== "li") continue;
		const marker = ordered ? `${index}.` : "-";
		const childIndent = indent + marker.length + 1;
		const itemBody = serializeListItem(child, childIndent);
		lines.push(" ".repeat(indent) + `${marker} ${itemBody}`);
		index++;
	}
	return lines.join("\n");
}

function serializeListItem(li: HtmlElementLike, childIndent: number): string {
	let inline = "";
	const nested: string[] = [];
	for (const node of arrayFrom(li.childNodes)) {
		if (node.nodeType === TEXT_NODE) {
			inline += escapeMarkdownText(node.textContent ?? "");
			continue;
		}
		if (node.nodeType !== ELEMENT_NODE) continue;
		const child = node as HtmlElementLike;
		const tag = child.tagName.toLowerCase();
		if (tag === "ul") {
			nested.push(serializeList(child, false, childIndent));
		} else if (tag === "ol") {
			nested.push(serializeList(child, true, childIndent));
		} else if (tag === "p") {
			if (inline) inline += "\n" + " ".repeat(childIndent);
			inline += serializeInline(child);
		} else {
			// Inline element or block-inside-li: render as inline.
			inline += serializeInline(child);
		}
	}
	if (nested.length === 0) return inline;
	return `${inline}\n${nested.join("\n")}`;
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
	if (!code) {
		return "```\n" + (el.textContent ?? "") + "\n```";
	}
	let lang = "";
	for (const cls of (code.getAttribute("class") ?? "").split(/\s+/)) {
		if (cls.startsWith("language-")) {
			lang = cls.slice("language-".length);
			break;
		}
	}
	return "```" + lang + "\n" + (code.textContent ?? "") + "\n```";
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
		// Match `footnote-N` (marked-footnote) or `fn-N`/`fnN` (legacy).
		const idMatch = id.match(/^(?:footnote-|fn[-:]?)(\d+)$/);
		const num = idMatch?.[1] ?? String(items.length + 1);
		const clone = li.cloneNode(true) as HtmlElementLike;
		for (const back of arrayFrom(
			clone.querySelectorAll(
				"[data-footnote-backref], [data-footnote-back-ref], .footnote-back, .footnote-backref",
			),
		)) {
			back.remove();
		}
		// marked-footnote wraps definitions in a `<p>`. Unwrap the sole
		// direct-child paragraph so `serializeInline` doesn't emit a
		// raw `<p>` tag around the text.
		let text: string;
		const onlyP = arrayFrom(clone.children).filter(
			(c) => c.tagName.toLowerCase() !== "br",
		);
		if (onlyP.length === 1 && onlyP[0]?.tagName.toLowerCase() === "p") {
			text = serializeInline(onlyP[0]).trim();
		} else {
			text = serializeInline(clone).trim();
		}
		items.push(`[^${num}]: ${text}`);
	}
	return items.join("\n");
}

/**
 * Escape the minimum set of markdown special characters. We
 * intentionally under-escape rather than over-escape:
 *  - `\` — must be first so it doesn't double-escape our own escapes.
 *  - `*` and `_` — emphasis markers.
 *  - `[` and `]` — link markers.
 *  - `` ` `` — code marker.
 *
 * We do NOT escape `#`, `-`, `+`, `>` because those are line-start
 * markers and paragraph text rarely starts with them raw. Escaping them
 * everywhere would produce ugly output like `\-` in the middle of
 * hyphenated words.
 */
function escapeMarkdownText(text: string): string {
	return text.replace(/([\\`*_[\]])/g, "\\$1");
}

/** Array.from over the minimal ArrayLike the adapter types expose. */
function arrayFrom<T>(list: ArrayLike<T>): T[] {
	return Array.from(list);
}
