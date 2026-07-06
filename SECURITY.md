# Security Policy

## Supported versions

The latest published minor of barkdown receives security fixes.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting on this repository
("Security" tab → "Report a vulnerability"). Reports are typically
acknowledged within a few days.

barkdown's only runtime dependencies are the declared `marked` +
`marked-footnote` peer pair; it performs no network, filesystem, or shell
access. **Sanitization is explicitly out of scope**: `toDom()` returns
whatever HTML marked produces, and `toMarkdown()` preserves unknown
elements as raw HTML by design. Consumers must sanitize untrusted content
(e.g. with DOMPurify) before rendering or trusting parsed HTML. Guarantee
violations (silent content loss, non-idempotent round trips, footnote
corruption) are treated as security-relevant bugs.
