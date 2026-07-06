/**
 * Inversion of marked's real output shapes — cases the ported base suite
 * missed because contenteditable never produced them, but marked does on
 * every parse (so round trips break without them).
 */
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

describe("toMarkdown — marked's code-block shape", () => {
	test("trailing newline inside <code> is stripped (marked emits one)", () => {
		expect(
			toMarkdown(
				frag('<pre><code class="language-ts">let x = 1;\n</code></pre>'),
			),
		).toBe("```ts\nlet x = 1;\n```\n");
	});

	test("backtick fence inside content forces a longer fence", () => {
		expect(toMarkdown(frag("<pre><code>```\nx\n```</code></pre>"))).toBe(
			"````\n```\nx\n```\n````\n",
		);
	});

	test("empty code block", () => {
		expect(toMarkdown(frag("<pre><code></code></pre>"))).toBe("```\n```\n");
	});
});

describe("toMarkdown — ordered list start", () => {
	test("start attribute is preserved", () => {
		expect(toMarkdown(frag('<ol start="3"><li>a</li><li>b</li></ol>'))).toBe(
			"3. a\n4. b\n",
		);
	});
});

describe("toMarkdown — task lists", () => {
	test("tight task items (input direct in li)", () => {
		const html =
			'<ul><li><input checked="" disabled="" type="checkbox"> done</li>' +
			'<li><input disabled="" type="checkbox"> todo</li></ul>';
		expect(toMarkdown(frag(html))).toBe("- [x] done\n- [ ] todo\n");
	});

	test("loose task items (input inside p) flatten to tight", () => {
		const html =
			'<ul><li><p><input checked="" disabled="" type="checkbox"> done</p></li>' +
			'<li><p><input disabled="" type="checkbox"> todo</p></li></ul>';
		expect(toMarkdown(frag(html))).toBe("- [x] done\n- [ ] todo\n");
	});
});

describe("toMarkdown — blocks inside list items", () => {
	test("blockquote in li", () => {
		expect(
			toMarkdown(frag("<ul><li><blockquote><p>q</p></blockquote></li></ul>")),
		).toBe("- > q\n");
	});

	test("code block in li", () => {
		expect(
			toMarkdown(frag("<ul><li>x<pre><code>c\n</code></pre></li></ul>")),
		).toBe("- x\n  ```\n  c\n  ```\n");
	});

	test("loose multi-paragraph item flattens to continuation lines", () => {
		expect(toMarkdown(frag("<ul><li><p>one</p><p>two</p></li></ul>"))).toBe(
			"- one\n  two\n",
		);
	});
});

describe("toMarkdown — footnote labels", () => {
	test("non-numeric label round-trips from ref anchor id", () => {
		expect(
			toMarkdown(
				frag(
					'<p>Text<sup><a id="footnote-ref-note" href="#footnote-note" data-footnote-ref>2</a></sup></p>',
				),
			),
		).toBe("Text[^note]\n");
	});

	test("non-numeric label round-trips in the section", () => {
		const html =
			'<section class="footnotes" data-footnotes><ol>' +
			'<li id="footnote-note"><p>Labeled <em>note</em> <a href="#footnote-ref-note" data-footnote-backref>↩</a></p></li>' +
			"</ol></section>";
		expect(toMarkdown(frag(html))).toBe("[^note]: Labeled *note*\n");
	});

	test("multi-paragraph definition uses indented continuation", () => {
		const html =
			'<section class="footnotes" data-footnotes><ol>' +
			'<li id="footnote-1"><p>First para.</p><p>Second para. <a href="#footnote-ref-1" data-footnote-backref>↩</a></p></li>' +
			"</ol></section>";
		expect(toMarkdown(frag(html))).toBe(
			"[^1]: First para.\n\n    Second para.\n",
		);
	});
});

describe("toMarkdown — bare autolinks", () => {
	test("self-link mid-sentence emits bare URL", () => {
		expect(
			toMarkdown(
				frag('<p>visit <a href="https://x.com">https://x.com</a> now</p>'),
			),
		).toBe("visit https://x.com now\n");
	});

	test("email self-link emits bare address", () => {
		expect(
			toMarkdown(frag('<p>mail <a href="mailto:a@b.com">a@b.com</a> now</p>')),
		).toBe("mail a@b.com now\n");
	});

	test("self-link with unsafe following text uses full form", () => {
		expect(
			toMarkdown(
				frag('<p>see <a href="https://x.com">https://x.com</a>, ok</p>'),
			),
		).toBe("see [https://x.com](https://x.com), ok\n");
	});

	test("self-link ending in trim-set punctuation uses full form", () => {
		expect(
			toMarkdown(
				frag('<p>see <a href="https://x.com/a.">https://x.com/a.</a> ok</p>'),
			),
		).toBe("see [https://x.com/a.](https://x.com/a.) ok\n");
	});

	test("underscore domain uses full form (GFM would not linkify)", () => {
		expect(
			toMarkdown(
				frag('<p>see <a href="https://a_b.com/x">https://a_b.com/x</a> ok</p>'),
			),
		).toBe("see [https://a\\_b.com/x](https://a_b.com/x) ok\n");
	});
});

describe("toMarkdown — image ambiguity guard", () => {
	test("text ending in ! before a link escapes the bang", () => {
		expect(toMarkdown(frag('<p>wow!<a href="/x">click</a></p>'))).toBe(
			"wow\\![click](/x)\n",
		);
	});
});
