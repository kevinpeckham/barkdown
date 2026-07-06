/**
 * Base one-directional serializer suite, ported from the production
 * implementation barkdown was extracted from. Round-trip guarantees are
 * covered separately in roundtrip.test.ts / property.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import type { HtmlElementLike } from "../src/index.js";
import { toMarkdown } from "../src/index.js";

const window = new Window();
const document = window.document;

/** Helper: parse HTML fragment into a container element for the serializer. */
function frag(html: string): HtmlElementLike {
	const container = document.createElement("div");
	container.innerHTML = html;
	return container as unknown as HtmlElementLike;
}

describe("toMarkdown — headings", () => {
	test("h1", () => {
		expect(toMarkdown(frag("<h1>Hello</h1>"))).toBe("# Hello\n");
	});
	test("h2..h6", () => {
		expect(toMarkdown(frag("<h2>A</h2>"))).toBe("## A\n");
		expect(toMarkdown(frag("<h3>A</h3>"))).toBe("### A\n");
		expect(toMarkdown(frag("<h4>A</h4>"))).toBe("#### A\n");
		expect(toMarkdown(frag("<h5>A</h5>"))).toBe("##### A\n");
		expect(toMarkdown(frag("<h6>A</h6>"))).toBe("###### A\n");
	});
	test("headings strip bold/italic/strike (safety net for Cmd+B in a heading)", () => {
		expect(toMarkdown(frag("<h2>Plain <strong>bold</strong> word</h2>"))).toBe(
			"## Plain bold word\n",
		);
		expect(toMarkdown(frag("<h1>An <em>italic</em> title</h1>"))).toBe(
			"# An italic title\n",
		);
		expect(toMarkdown(frag("<h3>A <s>struck</s> heading</h3>"))).toBe(
			"### A struck heading\n",
		);
		// Bold inside a link inside a heading still flattens the bold.
		expect(
			toMarkdown(
				frag('<h2><a href="/x"><strong>Linked</strong></a> head</h2>'),
			),
		).toBe("## [Linked](/x) head\n");
	});
});

describe("toMarkdown — paragraphs + inline", () => {
	test("plain paragraph", () => {
		expect(toMarkdown(frag("<p>Hello world.</p>"))).toBe("Hello world.\n");
	});

	test("bold + italic", () => {
		expect(
			toMarkdown(
				frag("<p>Some <strong>bold</strong> and <em>italic</em>.</p>"),
			),
		).toBe("Some **bold** and *italic*.\n");
	});

	test("link", () => {
		expect(
			toMarkdown(frag('<p>See <a href="https://x.com">link</a>.</p>')),
		).toBe("See [link](https://x.com).\n");
	});

	test("link with title", () => {
		expect(toMarkdown(frag('<p><a href="/x" title="Hint">See</a></p>'))).toBe(
			'[See](/x "Hint")\n',
		);
	});

	test("inline code", () => {
		expect(toMarkdown(frag("<p>run <code>bun run dev</code></p>"))).toBe(
			"run `bun run dev`\n",
		);
	});

	test("br → two-space break", () => {
		expect(toMarkdown(frag("<p>line1<br>line2</p>"))).toBe("line1  \nline2\n");
	});

	test("strikethrough", () => {
		expect(toMarkdown(frag("<p><del>old</del></p>"))).toBe("~~old~~\n");
	});

	test("plain span is transparent", () => {
		expect(toMarkdown(frag("<p>a <span>b</span> c</p>"))).toBe("a b c\n");
	});

	test("css-styled span (font-weight) → bold", () => {
		expect(
			toMarkdown(frag('<p>a <span style="font-weight: bold">b</span> c</p>')),
		).toBe("a **b** c\n");
	});

	test("css-styled span (numeric weight ≥600) → bold", () => {
		expect(
			toMarkdown(frag('<p><span style="font-weight: 700">b</span></p>')),
		).toBe("**b**\n");
	});

	test("css-styled span (font-style italic) → italic", () => {
		expect(
			toMarkdown(frag('<p><span style="font-style: italic">b</span></p>')),
		).toBe("*b*\n");
	});

	test("css-styled span (line-through) → strikethrough", () => {
		expect(
			toMarkdown(
				frag('<p><span style="text-decoration: line-through">b</span></p>'),
			),
		).toBe("~~b~~\n");
	});
});

describe("toMarkdown — lists", () => {
	test("unordered", () => {
		expect(toMarkdown(frag("<ul><li>one</li><li>two</li></ul>"))).toBe(
			"- one\n- two\n",
		);
	});

	test("ordered", () => {
		expect(toMarkdown(frag("<ol><li>one</li><li>two</li></ol>"))).toBe(
			"1. one\n2. two\n",
		);
	});

	test("nested unordered inside unordered", () => {
		expect(
			toMarkdown(frag("<ul><li>outer<ul><li>inner</li></ul></li></ul>")),
		).toBe("- outer\n  - inner\n");
	});
});

describe("toMarkdown — blockquote + code block + hr", () => {
	test("blockquote", () => {
		expect(toMarkdown(frag("<blockquote><p>quoted</p></blockquote>"))).toBe(
			"> quoted\n",
		);
	});

	test("code fence with language", () => {
		expect(
			toMarkdown(
				frag('<pre><code class="language-ts">let x = 1;</code></pre>'),
			),
		).toBe("```ts\nlet x = 1;\n```\n");
	});

	test("code fence without language", () => {
		expect(toMarkdown(frag("<pre><code>hi</code></pre>"))).toBe(
			"```\nhi\n```\n",
		);
	});

	test("hr", () => {
		expect(toMarkdown(frag("<hr>"))).toBe("---\n");
	});
});

describe("toMarkdown — footnotes", () => {
	test("inline footnote ref (legacy sup-with-attr shape)", () => {
		expect(
			toMarkdown(frag('<p>Text<sup data-footnote-ref="1">1</sup></p>')),
		).toBe("Text[^1]\n");
	});

	test("inline footnote ref (marked-footnote anchor shape)", () => {
		expect(
			toMarkdown(
				frag(
					'<p>Text<sup><a id="footnote-ref-1" href="#footnote-1" data-footnote-ref>1</a></sup></p>',
				),
			),
		).toBe("Text[^1]\n");
	});

	test("footnote section (legacy fn-N ids)", () => {
		const html = `<p>See[^1]</p><section data-footnotes><ol><li id="fn-1">Source note</li></ol></section>`;
		const result = toMarkdown(frag(html));
		expect(result).toContain("[^1]: Source note");
	});

	test("footnote section (marked-footnote footnote-N ids)", () => {
		const html = `<p>See[^1]</p><section class="footnotes" data-footnotes><h2 id="footnote-label" class="sr-only">Footnotes</h2><ol><li id="footnote-1"><p>Source note <a href="#footnote-ref-1" data-footnote-backref>↩</a></p></li></ol></section>`;
		const result = toMarkdown(frag(html));
		expect(result).toContain("[^1]: Source note");
		// The back-ref arrow must be stripped.
		expect(result).not.toContain("↩");
	});
});

describe("toMarkdown — escaping", () => {
	test("escapes emphasis + code + brackets", () => {
		expect(toMarkdown(frag("<p>a*b_c[d]e`f</p>"))).toBe(
			"a\\*b\\_c\\[d\\]e\\`f\n",
		);
	});

	test("escapes backslash", () => {
		expect(toMarkdown(frag("<p>a\\b</p>"))).toBe("a\\\\b\n");
	});

	test("does NOT escape hyphens or # in mid-text", () => {
		expect(toMarkdown(frag("<p>voip-server #42</p>"))).toBe(
			"voip-server #42\n",
		);
	});
});

describe("toMarkdown — full block sequences", () => {
	test("h1 + p + p", () => {
		expect(toMarkdown(frag("<h1>Title</h1><p>First.</p><p>Second.</p>"))).toBe(
			"# Title\n\nFirst.\n\nSecond.\n",
		);
	});

	test("transparent divs are unwrapped", () => {
		expect(toMarkdown(frag("<div><p>Hello</p></div>"))).toBe("Hello\n");
	});
});

describe("toMarkdown — unknown elements preserved", () => {
	test("iframe (unknown block) round-trips as raw HTML", () => {
		const html = '<p>text</p><iframe src="/x"></iframe><p>more</p>';
		const result = toMarkdown(frag(html));
		expect(result).toContain('<iframe src="/x"></iframe>');
		expect(result).toContain("text");
		expect(result).toContain("more");
	});
});

describe("toMarkdown — empty inputs", () => {
	test("empty container → empty string", () => {
		expect(toMarkdown(frag(""))).toBe("");
	});
	test("whitespace-only paragraph → empty", () => {
		expect(toMarkdown(frag("<p>   </p>"))).toBe("");
	});
});
