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
			return el.outerHTML;
	}
}

/** Serialize inline content (children of a block) as markdown. */
function serializeInline(
	container: HtmlElementLike,
	stripEmphasis = false,
	allowLeadingCheckbox = false,
): string {
	let out = "";
	// Set after a task-list checkbox is emitted: the marker carries its own
	// trailing space, so the single space marked renders after the input is
	// swallowed rather than doubled.
	let trimLeading = false;
	const nodes = arrayFrom(container.childNodes);
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i] as DomNodeLike;
		if (node.nodeType === TEXT_NODE) {
			let text = node.textContent ?? "";
			if (trimLeading) {
				const stripped = text.replace(/^[ \t]+/, "");
				if (stripped !== "") trimLeading = false;
				text = stripped;
			}
			out += escapeMarkdownText(text);
			continue;
		}
		if (node.nodeType !== ELEMENT_NODE) continue;

		const el = node as HtmlElementLike;

		// GFM task-list checkbox (loose items: marked nests it in the
		// item's first <p>).
		if (allowLeadingCheckbox && out === "" && isCheckboxInput(el)) {
			out += el.hasAttribute("checked") ? "[x] " : "[ ] ";
			trimLeading = true;
			continue;
		}
		trimLeading = false;
		out = serializeInlineElement(out, el, stripEmphasis, nodes[i + 1]);
	}
	return out;
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
			// Canonical form for self-links is the bare GFM autolink —
			// marked linkifies bare URLs/emails, so emitting the full
			// [text](url) form here would never re-read as written.
			// Only safe when both source boundaries stay delimiters.
			if (
				title === null &&
				isBareAutolinkable(href, el.textContent ?? "") &&
				autolinkBoundaryBefore(out) &&
				autolinkBoundaryAfter(next)
			) {
				out += el.textContent ?? "";
				break;
			}
			out = escapeTrailingBang(out);
			const dest = encodeLinkDestination(href);
			out +=
				title === null
					? `[${inner}](${dest})`
					: `[${inner}](${dest} "${escapeLinkTitle(title)}")`;
			break;
		}
		case "code":
			// Inline code — no escaping inside backticks.
			out += "`" + (el.textContent ?? "") + "`";
			break;
		case "img":
			out += serializeImage(el);
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
			// Labels aren't only numeric: `[^note]` yields
			// id="footnote-ref-note" while the *displayed* text is the
			// footnote's index.
			const legacyAttr = el.getAttribute("data-footnote-ref");
			if (legacyAttr && legacyAttr.length > 0) {
				out = escapeTrailingBang(out);
				out += `[^${legacyAttr}]`;
				break;
			}
			const anchor = el.querySelector("a[data-footnote-ref]");
			if (anchor) {
				const idMatch = anchor.id.match(/footnote-ref-([A-Za-z0-9_-]+)$/);
				const hrefMatch = (anchor.getAttribute("href") ?? "").match(
					/#footnote-([A-Za-z0-9_-]+)$/,
				);
				const label =
					idMatch?.[1] ?? hrefMatch?.[1] ?? anchor.textContent?.trim();
				if (label && /^[A-Za-z0-9_-]+$/.test(label)) {
					out = escapeTrailingBang(out);
					out += `[^${label}]`;
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
	return out;
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
		lines.push(`${marker} ${itemBody}`);
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
	const parts: string[] = [];
	let inline = "";
	let trimLeading = false;

	const flushInline = (): void => {
		if (inline === "") return;
		const kept = inline
			.split("\n")
			.filter((line, idx) => idx === 0 || line.trim() !== "");
		const joined = kept.join("\n");
		if (joined.trim() !== "") parts.push(joined);
		inline = "";
	};

	for (const node of arrayFrom(li.childNodes)) {
		if (node.nodeType === TEXT_NODE) {
			let text = node.textContent ?? "";
			if (trimLeading) {
				const stripped = text.replace(/^[ \t]+/, "");
				if (stripped !== "") trimLeading = false;
				text = stripped;
			}
			inline += escapeMarkdownText(text);
			continue;
		}
		if (node.nodeType !== ELEMENT_NODE) continue;
		const child = node as HtmlElementLike;
		const tag = child.tagName.toLowerCase();

		// GFM task-list checkbox (tight items: direct child of the li).
		if (
			parts.length === 0 &&
			inline === "" &&
			tag === "input" &&
			isCheckboxInput(child)
		) {
			inline += child.hasAttribute("checked") ? "[x] " : "[ ] ";
			trimLeading = true;
			continue;
		}
		trimLeading = false;

		if (tag === "ul") {
			flushInline();
			parts.push(serializeList(child, false));
		} else if (tag === "ol") {
			flushInline();
			parts.push(serializeList(child, true));
		} else if (tag === "p") {
			// Paragraphs flatten to continuation lines: canonical lists are
			// tight, so loose input converges to tight output.
			const isFirstContent = parts.length === 0 && inline === "";
			if (inline) inline += "\n";
			inline += serializeInline(child, false, isFirstContent);
		} else if (LIST_ITEM_BLOCK_TAGS.has(tag)) {
			flushInline();
			parts.push(serializeBlockNode(child));
		} else if (tag === "div") {
			// Contenteditable wrapper: transparent, like at block level.
			inline += serializeInline(child);
		} else {
			// Inline element: same handling as inside any other block.
			inline = serializeInlineElement(inline, child, false, undefined);
		}
	}
	flushInline();

	const body = parts.join("\n");
	return body
		.split("\n")
		.map((line, idx) =>
			idx === 0 || line === "" ? line : " ".repeat(childIndent) + line,
		)
		.join("\n");
}

/** `<img>` → `![alt](src "title")` (title optional). */
function serializeImage(el: HtmlElementLike): string {
	const src = el.getAttribute("src") ?? "";
	const alt = (el.getAttribute("alt") ?? "")
		.replace(/([\\[\]])/g, "\\$1")
		.replace(/\n/g, " ");
	const title = el.getAttribute("title");
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
 * A link can serialize as bare autolink text only when GFM would
 * re-linkify it identically: text === href (or mailto:text), a
 * conservative URL/email shape, a plain domain, and an end character
 * outside GFM's trailing-punctuation trim set.
 */
function isBareAutolinkable(href: string, text: string): boolean {
	if (href === `mailto:${text}`) {
		return /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(text);
	}
	if (href !== text) return false;
	if (!/^https?:\/\/[^\s<>()]+$/.test(text)) return false;
	if (!/[A-Za-z0-9/]$/.test(text)) return false;
	const domain = text.match(/^https?:\/\/([^/?#:]+)/)?.[1] ?? "";
	return /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(domain);
}

/** GFM autolinks only start after whitespace, `(`, or a delimiter run. */
function autolinkBoundaryBefore(out: string): boolean {
	return out === "" || /[\s(*_~]$/.test(out);
}

/**
 * …and only end cleanly when followed by whitespace. A next sibling that
 * starts with anything else would be absorbed into the linkified URL.
 */
function autolinkBoundaryAfter(next: DomNodeLike | undefined): boolean {
	if (!next) return true; // end of the inline run — a block boundary follows
	if (next.nodeType === TEXT_NODE) return /^\s/.test(next.textContent ?? "");
	if (next.nodeType === ELEMENT_NODE) {
		return (next as HtmlElementLike).tagName.toLowerCase() === "br";
	}
	return false;
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
 * Render a link/image destination. Destinations containing whitespace,
 * angle brackets, parens, or backslashes use the `<…>` form (with the
 * delimiters escaped) so they survive the trip through marked.
 */
function encodeLinkDestination(href: string): string {
	if (href === "") return "<>";
	if (/[\s<>()\\]/.test(href)) {
		return `<${href.replace(/\n/g, " ").replace(/([<>\\])/g, "\\$1")}>`;
	}
	return href;
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
				// Info strings can't contain backticks or whitespace.
				lang = cls.slice("language-".length).replace(/[`\s]/g, "");
				break;
			}
		}
		text = code.textContent ?? "";
	}
	// marked emits a trailing newline inside <code>; strip exactly one so
	// the fence doesn't grow a blank line every round trip.
	text = text.replace(/\n$/, "");
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
			text = paragraphs
				.join("\n\n")
				.split("\n")
				.map((line, idx) => (idx === 0 || line === "" ? line : `    ${line}`))
				.join("\n");
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
