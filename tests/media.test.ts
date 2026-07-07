/** Image + GFM table serialization (v1 additions over the ported walker). */
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import type { HtmlElementLike } from "../src/index.js";
import { toMarkdown } from "../src/index.js";

const window = new Window();
const document = window.document;

function frag(html: string): HtmlElementLike {
	const container = document.createElement("div");
	container.innerHTML = html;
	return container as unknown as HtmlElementLike;
}

describe("toMarkdown — images", () => {
	test("image with alt", () => {
		expect(toMarkdown(frag('<p><img src="/i.png" alt="alt"></p>'))).toBe(
			"![alt](/i.png)\n",
		);
	});

	test("image with title", () => {
		expect(
			toMarkdown(
				frag('<p><img src="/img.png" alt="alt text" title="A title"></p>'),
			),
		).toBe('![alt text](/img.png "A title")\n');
	});

	test("image inline in a sentence", () => {
		expect(
			toMarkdown(frag('<p>Before <img src="/i.png" alt="mid"> after.</p>')),
		).toBe("Before ![mid](/i.png) after.\n");
	});

	test("empty alt", () => {
		expect(toMarkdown(frag('<p><img src="/i.png" alt=""></p>'))).toBe(
			"![](/i.png)\n",
		);
	});

	test("alt with brackets is escaped", () => {
		expect(toMarkdown(frag('<p><img src="/i.png" alt="a [b] c"></p>'))).toBe(
			"![a \\[b\\] c](/i.png)\n",
		);
	});

	test("src with spaces percent-encodes like marked's cleanUrl", () => {
		expect(toMarkdown(frag('<p><img src="/a b.png" alt="x"></p>'))).toBe(
			"![x](/a%20b.png)\n",
		);
	});

	test("src with parens uses angle-bracket destination", () => {
		expect(toMarkdown(frag('<p><img src="/a(b).png" alt="x"></p>'))).toBe(
			"![x](</a(b).png>)\n",
		);
	});

	test("title with quotes is escaped", () => {
		expect(
			toMarkdown(frag('<p><img src="/i.png" alt="x" title=\'say "hi"\'></p>')),
		).toBe('![x](/i.png "say \\"hi\\"")\n');
	});

	test("linked image", () => {
		expect(
			toMarkdown(frag('<p><a href="/x"><img src="/i.png" alt="a"></a></p>')),
		).toBe("[![a](/i.png)](/x)\n");
	});

	test("block-level bare image", () => {
		expect(toMarkdown(frag('<img src="/i.png" alt="a">'))).toBe(
			"![a](/i.png)\n",
		);
	});
});

describe("toMarkdown — tables", () => {
	test("simple table (marked shape)", () => {
		const html =
			"<table><thead><tr><th>a</th><th>b</th></tr></thead>" +
			"<tbody><tr><td>1</td><td>2</td></tr></tbody></table>";
		expect(toMarkdown(frag(html))).toBe(
			"| a | b |\n| --- | --- |\n| 1 | 2 |\n",
		);
	});

	test("alignment from align attributes", () => {
		const html =
			'<table><thead><tr><th align="left">l</th><th align="center">c</th><th align="right">r</th></tr></thead>' +
			'<tbody><tr><td align="left">1</td><td align="center">2</td><td align="right">3</td></tr></tbody></table>';
		expect(toMarkdown(frag(html))).toBe(
			"| l | c | r |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n",
		);
	});

	test("alignment from text-align styles (contenteditable shape)", () => {
		const html =
			'<table><thead><tr><th style="text-align: center">c</th></tr></thead>' +
			"<tbody><tr><td>1</td></tr></tbody></table>";
		expect(toMarkdown(frag(html))).toBe("| c |\n| :---: |\n| 1 |\n");
	});

	test("inline markdown inside cells", () => {
		const html =
			"<table><thead><tr><th>x</th></tr></thead>" +
			'<tbody><tr><td><strong>b</strong> and <a href="/y">l</a></td></tr></tbody></table>';
		expect(toMarkdown(frag(html))).toBe(
			"| x |\n| --- |\n| **b** and [l](/y) |\n",
		);
	});

	test("pipes in cell content are escaped", () => {
		const html =
			"<table><thead><tr><th>a|b</th></tr></thead>" +
			"<tbody><tr><td>c|d</td></tr></tbody></table>";
		expect(toMarkdown(frag(html))).toBe("| a\\|b |\n| --- |\n| c\\|d |\n");
	});

	test("empty cells", () => {
		const html =
			"<table><thead><tr><th>a</th><th>b</th></tr></thead>" +
			"<tbody><tr><td></td><td>2</td></tr></tbody></table>";
		expect(toMarkdown(frag(html))).toBe("| a | b |\n| --- | --- |\n|  | 2 |\n");
	});

	test("rowless table falls through as raw HTML", () => {
		expect(toMarkdown(frag("<table></table>"))).toBe("<table></table>\n");
	});
});
