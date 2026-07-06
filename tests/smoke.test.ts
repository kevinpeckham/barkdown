import { expect, test } from "bun:test";

import * as barkdown from "../src/index.js";

test("module loads", () => {
	expect(typeof barkdown).toBe("object");
});
