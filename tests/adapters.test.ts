/**
 * Adapter conformance: the same serializer battery must pass with a
 * happy-dom document and a linkedom document — including the CSS-styled
 * span emphasis path (style.fontWeight etc.), which exercises each
 * library's CSSStyleDeclaration, and the string-input branch of
 * toMarkdown/roundTrip.
 */
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { parseHTML } from "linkedom";

import type { DocumentLike, DomAdapter } from "../src/index.js";
import {
	BarkdownError,
	defaultAdapter,
	documentAdapter,
	roundTrip,
	toMarkdown,
} from "../src/index.js";

const happyDocument = new Window().document as unknown as DocumentLike;
const linkedomDocument = parseHTML("<html><body></body></html>")
	.document as unknown as DocumentLike;

const ADAPTERS: Array<[name: string, adapter: DomAdapter]> = [
	["happy-dom", documentAdapter(happyDocument)],
	["linkedom", documentAdapter(linkedomDocument)],
];

for (const [name, adapter] of ADAPTERS) {
	describe(`adapter conformance — ${name}`, () => {
		const md = (html: string): string => toMarkdown(html, { adapter });

		test("blocks and inline constructs", () => {
			expect(md("<h2>Title</h2><p>Body <strong>bold</strong>.</p>")).toBe(
				"## Title\n\nBody **bold**.\n",
			);
			expect(md("<ul><li>one</li><li>two<ul><li>sub</li></ul></li></ul>")).toBe(
				"- one\n- two\n  - sub\n",
			);
			expect(md("<blockquote><p>q</p></blockquote>")).toBe("> q\n");
			expect(
				md('<pre><code class="language-ts">let x = 1;\n</code></pre>'),
			).toBe("```ts\nlet x = 1;\n```\n");
		});

		test("links, images, code spans", () => {
			expect(md('<p><a href="/x" title="T">t</a></p>')).toBe('[t](/x "T")\n');
			expect(md('<p><img src="/i.png" alt="a"></p>')).toBe("![a](/i.png)\n");
			expect(md("<p><code>x`y</code></p>")).toBe("``x`y``\n");
		});

		test("tables with alignment", () => {
			const html =
				'<table><thead><tr><th align="center">c</th></tr></thead>' +
				"<tbody><tr><td>1</td></tr></tbody></table>";
			expect(md(html)).toBe("| c |\n| :---: |\n| 1 |\n");
		});

		test("css-styled span: font-weight keyword and numeric", () => {
			expect(md('<p><span style="font-weight: bold">b</span></p>')).toBe(
				"**b**\n",
			);
			expect(md('<p><span style="font-weight: 700">b</span></p>')).toBe(
				"**b**\n",
			);
		});

		test("css-styled span: font-style italic", () => {
			expect(md('<p><span style="font-style: italic">i</span></p>')).toBe(
				"*i*\n",
			);
		});

		test("css-styled span: line-through via text-decoration", () => {
			expect(
				md('<p><span style="text-decoration: line-through">s</span></p>'),
			).toBe("~~s~~\n");
		});

		test("css-styled span: combined styles nest markers", () => {
			expect(
				md(
					'<p><span style="font-weight: bold; font-style: italic">x</span></p>',
				),
			).toBe("***x***\n");
		});

		test("plain span stays transparent", () => {
			expect(md('<p>a <span class="x">b</span> c</p>')).toBe("a b c\n");
		});

		test("footnote shapes", () => {
			expect(md('<p>T<sup data-footnote-ref="1">1</sup></p>')).toBe("T[^1]\n");
			expect(
				md(
					'<p>T<sup><a id="footnote-ref-n" href="#footnote-n" data-footnote-ref>1</a></sup></p>',
				),
			).toBe("T[^n]\n");
		});

		test("unknown elements rebuild with attributes", () => {
			expect(md('<p>a <kbd data-k="v">K</kbd> b</p>')).toBe(
				'a <kbd data-k="v">K</kbd> b\n',
			);
		});

		test("roundTrip canonical identity sample", () => {
			const fixtures = [
				"# Title\n\nBody with **bold** and [link](/x).\n",
				"- [x] done\n- [ ] todo\n",
				"| a | b |\n| --- | --- |\n| 1 | 2 |\n",
				"Text[^1]\n\n[^1]: Note.\n",
				"```js\nconsole.log(1);\n```\n",
			];
			for (const fixture of fixtures) {
				expect(roundTrip(fixture, adapter)).toBe(fixture);
			}
		});

		test("roundTrip idempotence sample (non-canonical input)", () => {
			for (const input of [
				"Setext\n===\n",
				"* star bullets\n",
				"_underscore em_\n",
			]) {
				const once = roundTrip(input, adapter);
				expect(roundTrip(once, adapter)).toBe(once);
			}
		});
	});
}

describe("adapter conformance — cross-adapter agreement", () => {
	test("both adapters produce identical markdown for the same HTML", () => {
		const html =
			'<h1>Doc</h1><p>Para <em>em</em> <span style="font-weight: bold">b</span></p>' +
			'<ul><li><input checked="" disabled="" type="checkbox"> t</li></ul>' +
			"<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>";
		const [happy, linke] = ADAPTERS.map(([, adapter]) =>
			toMarkdown(html, { adapter }),
		);
		expect(happy).toBe(linke as string);
	});
});

describe("defaultAdapter", () => {
	test("throws BarkdownError without a global document", () => {
		expect(() => toMarkdown("<p>x</p>")).toThrow(BarkdownError);
	});
});
