/**
 * The round-trip corpus. Two assertions back the README guarantees:
 *
 * 1. Canonical identity — for markdown in barkdown's canonical dialect,
 *    `toMarkdown(toDom(md)) === md` byte-for-byte.
 * 2. Fixed-point convergence — for ANY input markdown, one round trip
 *    reaches canonical form and a second is byte-identical to the first.
 */
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { documentAdapter, roundTrip } from "../src/index.js";

const adapter = documentAdapter(new Window().document);

function rt(markdown: string): string {
	return roundTrip(markdown, adapter);
}

/** Canonical fixtures: one trip is the identity. */
const CANONICAL: Record<string, string> = {
	"heading levels":
		"# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n",
	paragraph: "Hello world.\n",
	"multiple paragraphs": "First paragraph.\n\nSecond paragraph.\n",
	"soft line break": "line one\nline two\n",
	"hard line break": "line one  \nline two\n",
	emphasis: "Some **bold** and *italic* and ~~struck~~ text.\n",
	"nested emphasis": "***both*** and **outer *inner* outer**\n",
	link: "See [the docs](https://example.com/docs) here.\n",
	"link with title": '[home](/x "Hint text")\n',
	"bare autolink": "visit https://example.com/path now\n",
	"email autolink": "mail kevin@example.com today\n",
	image: "![alt text](/img.png)\n",
	"image with title": '![alt](/img.png "A title")\n',
	"linked image": "[![badge](/b.svg)](https://example.com)\n",
	"inline code": "run `bun test` locally\n",
	"code span with backtick": "a ``b`c`` d\n",
	"unordered list": "- one\n- two\n- three\n",
	"ordered list": "1. one\n2. two\n",
	"ordered list custom start": "3. three\n4. four\n",
	"nested lists": "- outer\n  - inner\n    - innermost\n- second\n",
	"ordered in unordered": "- outer\n  1. first\n  2. second\n",
	"task list": "- [x] done\n- [ ] todo\n",
	"list item with continuation": "- first line\n  second line\n",
	"list item with code block": "- item\n  ```ts\n  let x = 1;\n  ```\n",
	"list item with blockquote": "- > quoted\n",
	blockquote: "> quoted text\n",
	"nested blockquote": "> outer\n>\n> > inner\n",
	"blockquote with list": "> - a\n> - b\n",
	"blockquote multiple paragraphs": "> first\n>\n> second\n",
	"fenced code": "```ts\nlet x = 1;\nconst y = 2;\n```\n",
	"fenced code no lang": "```\nplain text\n```\n",
	"fenced code with inner fence": "````\n```\nnested\n```\n````\n",
	"empty fenced code": "```\n```\n",
	hr: "above\n\n---\n\nbelow\n",
	table: "| a | b |\n| --- | --- |\n| 1 | 2 |\n",
	"table with alignment":
		"| l | c | r |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n",
	"table with inline content":
		"| col |\n| --- |\n| **bold** and [link](/x) |\n",
	"table with escaped pipe": "| a |\n| --- |\n| b \\| c |\n",
	"table with empty cell": "| a | b |\n| --- | --- |\n|  | 2 |\n",
	footnote: "Text[^1] here.\n\n[^1]: The note.\n",
	"footnote with label": "Text[^note] here.\n\n[^note]: Labeled note.\n",
	"multiple footnotes": "One[^1] two[^2].\n\n[^1]: First.\n[^2]: Second.\n",
	"footnote with emphasis": "X[^1]\n\n[^1]: Has *emphasis* inside.\n",
	"multi-paragraph footnote":
		"X[^1]\n\n[^1]: First para.\n\n    Second para.\n",
	"raw html block": '<iframe src="/x"></iframe>\n',
	"raw inline html": "text with <mark>marked</mark> inside\n",
	"escaped specials": "a\\*b\\_c\\[d\\]e\\`f g\\~h\n",
	"escaped line-start markers":
		"\\# not a heading\n\n\\> not a quote\n\n\\- not a list\n\n1\\. not ordered\n",
	"escaped angle bracket": "5 \\< 6 and AT&T are fine\n",
	"escaped angle before letter": "left \\<b right\n",
	"escaped entity": "literally \\&copy; here\n",
	"comment separates adjacent lists": "- a\n\n<!-- -->\n\n- b\n",
	"html comment block": "<!-- hidden -->\n\ntext after\n",
	"repeated footnote ref": "x[^a][^a]\n\n[^a]: dup\n",
	"mid-text specials stay bare": "voip-server #42 | a-b c+d 5.6\n",
	"heading then content": "# Title\n\nIntro paragraph.\n\n- point\n",
	"full document":
		"# Post\n\nIntro with **bold**, a [link](/x), and `code`.\n\n" +
		"## Section\n\n- item one\n- item two with [^1]\n\n" +
		"```js\nconsole.log(1);\n```\n\n" +
		"> A quote.\n\n" +
		"| k | v |\n| --- | --- |\n| a | 1 |\n\n" +
		"![fig](/f.png)\n\n---\n\nOutro.\n\n[^1]: Note text.\n",
};

/** Non-canonical inputs: must converge after exactly one trip. */
const CONVERGENT: Record<string, string> = {
	"setext headings": "Title\n=====\n\nSub\n-----\n",
	"star bullets": "* one\n* two\n",
	"plus bullets": "+ one\n+ two\n",
	"paren ordered list": "1) one\n2) two\n",
	"loose list": "- one\n\n- two\n",
	"loose multi-paragraph item": "- one\n\n  two\n\n- three\n",
	"loose task list": "- [x] done\n\n- [ ] todo\n",
	"underscore emphasis": "_em_ and __strong__\n",
	"single-tilde strike": "~struck~\n",
	"asterisk hr": "***\n",
	"underscore hr": "___\n",
	"indented code block": "    indented code\n    line two\n",
	"tilde fence": "~~~\ncode\n~~~\n",
	"angle autolink": "<https://example.com>\n",
	"html entities": "&copy; 2026 &mdash; fine\n",
	"numeric entity": "&#169; now\n",
	"setext-ambiguous paragraph": "para text\n---\n",
	"lazy blockquote continuation": "> line one\nline two\n",
	"reference link": "[text][ref]\n\n[ref]: /url\n",
	"trailing single space": "line one \nline two\n",
	"three-space hard break": "line one   \nline two\n",
	"tab indented paragraph": "\tindented\n",
	"crlf-ish extra blank lines": "a\n\n\n\nb\n",
	"heading with emphasis": "## Plain **bold** word\n",
	"heading with trailing hashes": "# Title ##\n",
	"unclosed raw html": "<div>content\n",
	"raw html with markdown inside": "<section>*not em*</section>\n",
	"list with mixed markers": "- a\n* b\n+ c\n",
	"deeply mixed document":
		"Para\n# Heading\n> quote\n- list\n\n    code?\n\n***\n",
	"emphasis at word edges": "a*b* c *d*e\n",
	"double footnote ref": "x[^a][^a]\n\n[^a]: dup\n",
	"empty emphasis": "**** and ** **\n",
	"literal pipes in text": "a | b | c\n",
	"pipe-heavy lines": "| looks | like | a | row |\n",
	"comment block": "<!-- hidden -->\n\ntext\n",
	"backslash at end of line": "line\\\nnext\n",
	"bare angle bracket": "5 < 6 fine\n",
	"unreferenced footnote def": "[^1]: orphan note\n",
	"self-referential footnote": "[^a]: note[^a]\n",
};

describe("round-trip — canonical identity (guarantee 1)", () => {
	for (const [name, md] of Object.entries(CANONICAL)) {
		test(name, () => {
			expect(rt(md)).toBe(md);
		});
	}
});

describe("round-trip — canonical fixtures are fixed points too", () => {
	for (const [name, md] of Object.entries(CANONICAL)) {
		test(name, () => {
			expect(rt(rt(md))).toBe(rt(md));
		});
	}
});

describe("round-trip — fixed-point convergence (guarantee 2)", () => {
	for (const [name, md] of Object.entries(CONVERGENT)) {
		test(name, () => {
			const once = rt(md);
			const twice = rt(once);
			expect(twice).toBe(once);
		});
	}
});

describe("round-trip — no silent text loss (guarantee 4)", () => {
	const inputs = [
		"plain words survive\n",
		"- listed words survive\n",
		"> quoted words survive\n",
		"| tabled | words |\n| --- | --- |\n| survive | here |\n",
		"<article>unknown block words survive</article>\n",
		"words inside <kbd>unknown inline</kbd> survive\n",
	];
	for (const md of inputs) {
		test(JSON.stringify(md.slice(0, 30)), () => {
			const once = rt(md);
			for (const word of md.match(/[a-z]{4,}/g) ?? []) {
				expect(once).toContain(word);
			}
		});
	}
});
