/**
 * Property suites. The load-bearing property is guarantee 2 stated over
 * arbitrary inputs: serialize∘parse is idempotent — for ANY markdown,
 * `rt(rt(s)) === rt(s)`. A companion fidelity property backs guarantee 4
 * for arbitrary text content.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { Window } from "happy-dom";

import { documentAdapter, roundTrip, toDom, toMarkdown } from "../src/index.js";

const window = new Window();
const document = window.document;
const adapter = documentAdapter(document);

function rt(markdown: string): string {
	return roundTrip(markdown, adapter);
}

function expectIdempotent(markdown: string): void {
	const once = rt(markdown);
	const twice = rt(once);
	expect(twice).toBe(once);
}

/** Markdown-syntax soup: random interleavings of active tokens. */
const TOKEN_POOL = [
	"**",
	"*",
	"_",
	"~~",
	"~",
	"`",
	"``",
	"```",
	"[",
	"]",
	"(",
	")",
	"!",
	"#",
	"## ",
	"> ",
	"- ",
	"+ ",
	"1. ",
	"2) ",
	"|",
	" | ",
	":---",
	"---",
	"===",
	"\n",
	"\n\n",
	"  \n",
	"    ",
	"<b>",
	"</b>",
	"<div>",
	"</div>",
	"<mark>",
	"</mark>",
	"<!-- c -->",
	"&amp;",
	"&copy;",
	"&#169;",
	"\\",
	"\\*",
	"[^1]",
	"[^1]: note",
	"![a](/i.png)",
	"[t](/u)",
	"https://example.com",
	"https://example.com/café",
	"kevin@example.com",
	"©",
	"café",
	"word",
	"text and more",
	"x",
	" ",
	".",
	",",
] as const;

const markdownSoup = fc
	.array(fc.constantFrom(...TOKEN_POOL), { maxLength: 24 })
	.map((tokens) => tokens.join(""));

/** Text without control characters (HTML parsers rewrite those). */
const plainText = fc
	.string({ minLength: 1, maxLength: 60 })
	// biome-ignore lint/suspicious/noControlCharactersInRegex: the filter's whole point
	.filter((s) => !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(s));

describe("property — serialize∘parse is idempotent (guarantee 2)", () => {
	test("arbitrary strings", () => {
		fc.assert(
			fc.property(fc.string({ maxLength: 80 }), (s) => {
				expectIdempotent(s);
			}),
			{ numRuns: 300 },
		);
	});

	test("markdown-syntax soup", () => {
		fc.assert(
			fc.property(markdownSoup, (s) => {
				expectIdempotent(s);
			}),
			{ numRuns: 500 },
		);
	});

	test("unicode strings", () => {
		fc.assert(
			fc.property(fc.unicodeString({ maxLength: 60 }), (s) => {
				expectIdempotent(s);
			}),
			{ numRuns: 200 },
		);
	});
});

describe("property — inline constructs idempotent on arbitrary text", () => {
	test("emphasis nesting", () => {
		const marker = fc.constantFrom("*", "**", "~~");
		const nested = fc
			.tuple(marker, marker, plainText, plainText, plainText)
			.map(([m1, m2, a, b, c]) => `${a}${m1}${b}${m2}${c}${m2}${m1} tail\n`);
		fc.assert(
			fc.property(nested, (s) => {
				expectIdempotent(s);
			}),
			{ numRuns: 300 },
		);
	});

	test("links with titles", () => {
		const link = fc
			.tuple(plainText, plainText, plainText)
			.map(
				([text, path, title]) =>
					`before [${text}](/base/${encodeURIComponent(path)} "${title.replace(/["\\]/g, "")}") after\n`,
			);
		fc.assert(
			fc.property(link, (s) => {
				expectIdempotent(s);
			}),
			{ numRuns: 300 },
		);
	});

	test("escaping arbitrary paragraph text", () => {
		fc.assert(
			fc.property(plainText, (s) => {
				expectIdempotent(`${s}\n`);
			}),
			{ numRuns: 300 },
		);
	});
});

describe("property — arbitrary text content survives the trip (guarantee 4)", () => {
	/** Whitespace-insensitive view: canonicalization may move whitespace,
	 * but every non-whitespace character of a DOM text node must reach
	 * the markdown and come back. */
	function squash(s: string): string {
		return s.replace(/\s+/g, " ").trim();
	}

	test("paragraph text fidelity", () => {
		fc.assert(
			fc.property(plainText, (s) => {
				const p = document.createElement("p");
				p.textContent = s;
				const container = document.createElement("div");
				container.appendChild(p);
				const markdown = toMarkdown(
					container as unknown as Parameters<typeof toMarkdown>[0],
				);
				const html = toDom(markdown);
				const probe = document.createElement("div");
				probe.innerHTML = html;
				expect(squash(probe.textContent ?? "")).toBe(squash(s));
			}),
			{ numRuns: 300 },
		);
	});
});
