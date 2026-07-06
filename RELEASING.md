# Releasing

Publishing is manual, by the author, from a personal npm account.

1. `bun test` — all green (unit + round-trip + property suites).
2. `bun run check` && `bun run lint` && `bun run audit` — clean.
3. Bump `version` in package.json (semver; v1.x surface is frozen —
   patch/minor only unless a guarantee changes, which it shouldn't).
4. Update README if behavior-visible.
5. `npm publish --dry-run` — inspect the tarball contents.
6. `git tag v<version> && git push --tags`.
7. `npm login` (credentials in 1Password) then `npm publish`.
8. Verify: `npm view @kevinpeckham/barkdown version` and install into a scratch project.

Once the npm trusted publisher is configured (GitHub Actions /
kevinpeckham / barkdown / release.yml), steps 6–7 collapse to pushing the
tag: CI publishes with provenance via OIDC.
