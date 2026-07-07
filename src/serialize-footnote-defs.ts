/**
 * Post-processing pass for footnote definitions in serialized markdown.
 *
 * marked-footnote renders nothing for a definition that is never
 * referenced outside the footnote section itself, so emitting such a
 * definition would vanish one trip late. This pass canonicalizes the
 * output by dropping unreferenced definitions up front. Pure
 * string → string; no DOM involvement.
 */

/** A footnote definition line: `[^label]: …` at column 0. */
const DEF_LINE = /^\[\^([A-Za-z0-9_-]+)\]:/;

/** A fenced-code fence line (up to 3 leading spaces, ``` or ~~~). */
const FENCE_LINE = /^ {0,3}(?:`{3,}|~{3,})/;

/**
 * Drop footnote definitions that nothing references. Dropping a
 * definition can orphan another (its content held the only ref) —
 * iterate to a fixpoint. Bounded by the number of definitions.
 */
export function dropUnreferencedFootnoteDefs(markdown: string): string {
	let current = markdown;
	for (let pass = 0; pass < 50; pass++) {
		if (!/^\[\^[A-Za-z0-9_-]+\]:/m.test(current)) return current;
		const { text, dropped } = dropDefsOnce(current);
		current = text;
		if (!dropped) return current;
	}
	return current;
}

/** One sweep: remove every currently-unreferenced definition. */
function dropDefsOnce(markdown: string): { text: string; dropped: boolean } {
	const lines = markdown.split("\n");
	const inCode = codeLineMask(lines);
	const kept: string[] = [];
	let dropped = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const match = inCode[i] ? null : line.match(DEF_LINE);
		if (match && !isReferenced(lines, inCode, match[1] ?? "")) {
			dropped = true;
			i = skipDroppedDefinition(lines, i);
			continue;
		}
		kept.push(line);
	}
	return { text: kept.join("\n"), dropped };
}

/**
 * Fenced-code regions are opaque: def-looking lines inside them are not
 * definitions and ref-looking text is not a reference. Returns a
 * per-line mask; the fence lines themselves count as code context.
 */
function codeLineMask(lines: string[]): boolean[] {
	const inCode: boolean[] = [];
	let codeOpen = false;
	for (const line of lines) {
		if (FENCE_LINE.test(line)) {
			inCode.push(true); // the fence line itself is code context
			codeOpen = !codeOpen;
		} else {
			inCode.push(codeOpen);
		}
	}
	return inCode;
}

/**
 * A "reference" is any unescaped [^label] occurrence (outside code) that
 * is not itself the prefix of a definition line — marked-footnote counts
 * refs inside definition content (including self-refs).
 */
function isReferenced(
	lines: string[],
	inCode: boolean[],
	label: string,
): boolean {
	const needle = new RegExp(`(?<!\\\\)\\[\\^${label}\\](:?)`, "g");
	for (let i = 0; i < lines.length; i++) {
		if (inCode[i]) continue;
		const line = lines[i] ?? "";
		for (const m of line.matchAll(needle)) {
			if (!(m[1] === ":" && m.index === 0 && DEF_LINE.test(line))) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Skip past a dropped definition's continuation lines (4-space-indented,
 * possibly separated by blank lines), plus one following blank line so
 * no double blank is left behind. Returns the last consumed index.
 */
function skipDroppedDefinition(lines: string[], index: number): number {
	let i = index;
	while (i + 1 < lines.length) {
		const next = lines[i + 1] ?? "";
		if (/^ {4}/.test(next)) i++;
		else if (next.trim() === "" && /^ {4}/.test(lines[i + 2] ?? "x")) i++;
		else break;
	}
	if ((lines[i + 1] ?? "x").trim() === "") i++;
	return i;
}
