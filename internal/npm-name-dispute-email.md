# npm name dispute — unscoped `barkdown` (SEND AFTER v0.1.0 PUBLISHES)

Goal: acquire the abandoned unscoped `barkdown` (last publish 2019-07-31,
maintainer `bushmango`) as a maintained alias for `@kevinpeckham/barkdown`,
so the name can't impersonate the real package.

Process (npm dispute policy): email the author with support@npmjs.com
CC'd — the CC starts the ~4-week clock; no reply → npm support can
adjudicate. If the author address bounces, forward the bounce to the same
support thread (strengthens the abandonment case).

Send from kevin@lightningjar.com. Update the package URL sentence if the
scoped package's version has moved past 0.1.0 by then.

---

**To:** bushmango@gmail.com
**Cc:** support@npmjs.com
**Subject:** npm package name request: `barkdown`

Hi Steve,

I'm writing about the npm package **`barkdown`**
(https://www.npmjs.com/package/barkdown), which you published, with its
last release (v1.0.8) in July 2019. I'm following npm's package-name
dispute process, which asks me to contact you directly first with npm
support CC'd — that's the only reason for the CC, and there's nothing
adversarial intended here.

I maintain a pair of open-source packages, `@kevinpeckham/barkup`
(https://www.npmjs.com/package/@kevinpeckham/barkup) and
`@kevinpeckham/barkdown` — companion codecs for typed-tree ↔ HTML and
Markdown ⇄ DOM round-tripping. Since your `barkdown` appears to be
unmaintained (no releases in six-plus years, and no repository link on
the npm listing), I'd like to ask whether you'd be willing to **transfer
the unscoped `barkdown` name** to my npm account (**kevinpeckham**). I'd
use it as a maintained alias for the scoped package, primarily so the
name can't be used to impersonate it.

If you'd rather not transfer it, no hard feelings — deprecating it, or
simply replying to let me and npm support know you intend to keep it,
resolves this just as cleanly. And if the project is still active in some
form I've missed, apologies for the noise.

Thanks for your time — and for having contributed the package back when.

Best,
Kevin Peckham
npm: kevinpeckham · GitHub: github.com/kevinpeckham
kevin@lightningjar.com

---

Related follow-up once @kevinpeckham/barkdown is live: publish `bardown`
(unscoped, free as of 2026-07-06) as a functional re-export alias — it's
the most plausible confusion-spoof of barkdown. Functional alias, not an
empty placeholder (npm's dispute policy treats pure squats as removable).
