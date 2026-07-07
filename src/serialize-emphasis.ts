/**
 * Emphasis-delimiter machinery: decide whether inline content can be
 * wrapped in `**` / `*` / `~~` markers and still reparse (via marked) to
 * the same bytes. Encodes CommonMark flanking rules plus the empirical
 * quirks of marked's emStrong/del run accounting. Callers fall back to
 * raw inline tags when wrapping is unrepresentable (`tryWrapDelimited`
 * returns null).
 */

import type { DomNodeLike, HtmlElementLike } from "./adapter.js";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Wrap inline content in an emphasis delimiter, or return null when the
 * result would not reparse as written:
 * - CommonMark delimiters can't face whitespace, so leading/trailing
 *   whitespace is hoisted outside the markers; empty or whitespace-only
 *   content is unrepresentable (`****` reparses as literal asterisks).
 * - Content whose edges already carry *unescaped* marker characters
 *   (nested emphasis) merges into a longer delimiter run. Symmetric
 *   runs reparse to the same bytes; asymmetric ones (`**0*!*`) do not.
 *   Tilde runs beyond `~~` never delimit, so any edge tilde bails.
 * (`escapeMarkdownText` escapes `*`/`~` in text, so a backslash-preceded
 * edge char is literal text, not a delimiter — hence the lookbehind.)
 */
export function tryWrapDelimited(
	inner: string,
	marker: string,
	before: string,
	next: DomNodeLike | undefined,
): string | null {
	const match = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
	if (!match) return null;
	const lead = match[1] ?? "";
	const core = match[2] ?? "";
	const trail = match[3] ?? "";
	if (core === "") return null;
	const isTilde = marker[0] === "~";
	const delimiterChar = isTilde ? "~" : "*";
	if (hasUnsafeMarkerRuns(core, isTilde)) return null;
	// Adjacency: a neighboring same-kind character — escaped or not, in
	// either direction — merges into (or corrupts) the delimiter run.
	if (lead === "" && before.endsWith(delimiterChar)) return null;
	if (trail === "" && peekNextChar(next) === delimiterChar) return null;
	if (hasMarkedPairingHazard(core, marker.length, isTilde)) return null;
	if (flankingFails(core, lead, trail, before, next)) return null;
	return lead + marker + core + marker + trail;
}

/**
 * Interior shapes that empirically corrupt marked's delimiter pairing:
 * - Interior delimiter runs (nested markers): the wrapper's opener can
 *   pair early with the first interior run when that run is
 *   closer-capable and CommonMark's rule of three doesn't block the
 *   pairing ("**" + interior "**" mispairs; "**" + "*" is blocked —
 *   which is why plain bold-with-italic content stays wrappable).
 * - Interior runs directly adjacent to punctuation corrupt marked's
 *   pairing regardless of CommonMark's flanking math (`*!**0**0*` and
 *   `*a**b**!*` fail while `**a*b*c**` and `**a *b* c**` pair fine).
 * - Raw inline tags combined with interior marker characters corrupt
 *   marked's run scanning (`*<c>**x**</c>*` fails to pair while
 *   `*<c>x</c>*` is fine). Text `<` is always escaped, so an unescaped
 *   `<` here is one of our own raw-tag emissions.
 * - A trailing escape pair (e.g. `…\~`) corrupts marked's closing-run
 *   scan the same way escaped marker chars do.
 */
function hasMarkedPairingHazard(
	core: string,
	markerLength: number,
	isTilde: boolean,
): boolean {
	if (!isTilde && firstInteriorRunSteals(core, markerLength)) return true;
	if (!isTilde && interiorRunTouchesPunctuation(core)) return true;
	if (/(?<!\\)</.test(core) && (isTilde ? /~/ : /\*/).test(core)) return true;
	return /\\[\s\S]$/.test(core);
}

/**
 * Marker-run hazards inside the core content:
 * - Edge delimiter runs. marked's emStrong run accounting does not honor
 *   backslash escapes adjacent to a run, so an *escaped* edge star is
 *   just as hazardous as a real one. Symmetric unescaped asterisk runs
 *   reparse to the same bytes (`***x***`); anything else bails to the
 *   raw-tag fallback. Tilde runs beyond `~~` never delimit, so any edge
 *   tilde bails.
 * - marked's emStrong/del run arithmetic miscounts around
 *   backslash-escaped marker characters (anywhere in the content, not
 *   just at the edges), so any escaped marker char bails. Strikethrough
 *   pairs additionally match first-come — a `~~` anywhere inside the
 *   core would close the wrap early.
 */
function hasUnsafeMarkerRuns(core: string, isTilde: boolean): boolean {
	const leadRun = core.match(isTilde ? /^~+/ : /^\*+/)?.[0].length ?? 0;
	const trailRun = core.match(isTilde ? /~+$/ : /\*+$/)?.[0].length ?? 0;
	const escapedMarkerChar = isTilde ? /\\~/.test(core) : /\\\*/.test(core);
	const tildeInterior = isTilde && /~~/.test(core);
	return (
		escapedMarkerChar ||
		tildeInterior ||
		(isTilde ? leadRun > 0 || trailRun > 0 : leadRun !== trailRun)
	);
}

/**
 * CommonMark flanking (and marked applies the same rules to `~~`): a
 * delimiter followed by punctuation only *opens* if preceded by
 * whitespace/punctuation, and one preceded by punctuation only *closes*
 * if followed by whitespace/punctuation.
 */
function flankingFails(
	core: string,
	lead: string,
	trail: string,
	before: string,
	next: DomNodeLike | undefined,
): boolean {
	const beforeChar = lead !== "" ? " " : before.slice(-1);
	const afterChar = trail !== "" ? " " : peekNextChar(next);
	const coreFirst = core.slice(0, 1);
	const coreLast = core.slice(-1);
	const openFails =
		isPunctuation(coreFirst) &&
		!(isFlankWhitespace(beforeChar) || isPunctuation(beforeChar));
	const closeFails =
		isPunctuation(coreLast) &&
		!(isFlankWhitespace(afterChar) || isPunctuation(afterChar));
	return openFails || closeFails;
}

/** An interior (non-edge) `*`-run and its immediate neighbors. */
interface InteriorRun {
	run: string;
	prev: string;
	next: string;
}

/** Iterate the interior `*`-runs of `core` (edge runs merge — skipped). */
function* interiorStarRuns(core: string): Generator<InteriorRun> {
	for (const m of core.matchAll(/\*+/g)) {
		const start = m.index ?? 0;
		const end = start + m[0].length;
		if (start === 0 || end === core.length) continue; // edge runs merge
		yield { run: m[0], prev: core[start - 1] ?? "", next: core[end] ?? "" };
	}
}

/**
 * Would the first interior `*`-run of `core` close against a wrapper
 * opener of `markerLength` stars? Closer-capable = not preceded by
 * whitespace and (not preceded by punctuation, or followed by
 * whitespace/punctuation). The rule of three blocks the pairing when the
 * combined lengths are a multiple of 3 (and the run lengths aren't).
 */
function firstInteriorRunSteals(core: string, markerLength: number): boolean {
	for (const { run, prev, next } of interiorStarRuns(core)) {
		if (prev === "\\") return false; // escaped → already bailed upstream
		const precededByWhitespace = /\s/.test(prev);
		const precededByPunct = isPunctuation(prev);
		const canClose =
			!precededByWhitespace &&
			(!precededByPunct || /\s/.test(next) || isPunctuation(next));
		if (!canClose) return false; // first run opens; later runs pair inward
		return (markerLength + run.length) % 3 !== 0;
	}
	return false;
}

/**
 * True when any interior (non-edge) `*`-run has punctuation immediately
 * on either side — the empirically unsafe shape in marked's emphasis
 * pairing. (Whitespace- and alphanumeric-adjacent runs pair reliably.)
 */
function interiorRunTouchesPunctuation(core: string): boolean {
	for (const { prev, next } of interiorStarRuns(core)) {
		if (isPunctuation(prev) || isPunctuation(next)) return true;
	}
	return false;
}

/** Start/end of block counts as whitespace for flanking purposes. */
function isFlankWhitespace(char: string): boolean {
	return char === "" || /\s/.test(char);
}

function isPunctuation(char: string): boolean {
	return /[\p{P}\p{S}]/u.test(char);
}

/**
 * First character that will follow the current construct in the emitted
 * markdown — used for flanking checks. Unknown elements return a
 * conservative non-space, non-punctuation placeholder.
 */
function peekNextChar(next: DomNodeLike | undefined): string {
	if (!next) return ""; // end of the inline run — block boundary
	if (next.nodeType === TEXT_NODE) {
		return (next.textContent ?? "").slice(0, 1);
	}
	if (next.nodeType === ELEMENT_NODE) {
		const tag = (next as HtmlElementLike).tagName.toLowerCase();
		if (tag === "br") return "\n";
		// Unknown until serialized: treat as a letter so the flanking
		// check stays conservative (more raw-tag fallbacks, never a broken
		// delimiter).
		return "a";
	}
	return "";
}
