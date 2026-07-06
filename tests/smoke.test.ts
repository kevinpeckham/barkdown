import { expect, test } from "bun:test";

import * as barkdown from "../src/index.js";

test("public surface exports", () => {
	expect(typeof barkdown.toMarkdown).toBe("function");
	expect(typeof barkdown.toDom).toBe("function");
	expect(typeof barkdown.roundTrip).toBe("function");
	expect(typeof barkdown.documentAdapter).toBe("function");
	expect(typeof barkdown.defaultAdapter).toBe("function");
	expect(typeof barkdown.BarkdownError).toBe("function");
});

test("defaultAdapter throws a helpful error without a global document", () => {
	expect(() => barkdown.defaultAdapter()).toThrow(barkdown.BarkdownError);
	expect(() => barkdown.defaultAdapter()).toThrow(/happy-dom|linkedom/);
});

test("toDom renders GFM markdown", () => {
	expect(barkdown.toDom("# Hi")).toContain("<h1>Hi</h1>");
	expect(barkdown.toDom("")).toBe("");
});
