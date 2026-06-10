# Releasing

How `@tskm/core`, `@tskm/compiler`, and `@tskm/vite` are published.

Publishing is **CI-only** and **tokenless**: GitHub Actions publishes via npm OIDC
Trusted Publishing (no long-lived `NPM_TOKEN` anywhere), and every published version
gets a Sigstore provenance attestation. `bun publish` is intentionally not used (it
supports neither OIDC nor provenance yet).

---

## Routine release flow

1. **Add a changeset** describing the change and the bump:
   ```sh
   bun run changeset
   ```
   Commit it with your change in a normal PR.

2. **Merge to `main`.** `release.yml`'s `version` job opens or updates a
   **"Version Packages"** PR that applies all pending changesets (versions + changelogs +
   `bun.lock`), bumping `@tskm/vite` alongside `@tskm/compiler` automatically.

3. **Merge the Version PR.** On that push:
   - the `version` job's gate detects an unpublished version (`should_publish=true`);
   - the `publish` job starts and **waits for `release` Environment approval**;
   - once approved, it builds, runs `publint` / `attw` / the clean-room install smoke
     test, then publishes `@tskm/compiler → @tskm/core → @tskm/vite` over OIDC with
     provenance.

4. **Tags and GitHub Releases happen automatically.** After `publish` succeeds, the
   `github_release` job runs `changeset tag`, pushes one tag per package
   (`@tskm/core@x.y.z` style), and creates a GitHub Release per tag with the matching
   `CHANGELOG.md` section as its body. Already-tagged versions are skipped, so re-running
   the job is harmless. If it fails after pushing tags, create the missing Releases by
   hand with `gh release create <tag>`.

5. **Verify** the green provenance badge on npmjs.com and:
   ```sh
   npm audit signatures
   ```

## Preview releases

Every push and pull request triggers `preview.yml`, which publishes ephemeral preview
packages to pkg.pr.new (no npm registry, no tokens). The bot comments install URLs like:

```sh
bun add https://pkg.pr.new/ushironoko/tskm/@tskm/vite@<sha>
```

These are throwaway test artifacts. Never commit a pkg.pr.new URL to `package.json` or a
lockfile.

---

## How the safety pieces fit together

| Concern | Mechanism |
| --- | --- |
| No stealable long-lived credential | OIDC Trusted Publishing; `id-token: write` only on the publish job |
| Tampered/typosquatted deps run in CI | `bun install --frozen-lockfile --ignore-scripts`; lockfile diff guard |
| Compromised action retags | every `uses:` pinned to a 40-char commit SHA; Dependabot bumps them |
| Broken-on-install package ships | clean-room `npm pack` + install + run smoke gate before publish |
| `workspace:*` leaks to the registry | `scripts/publish.ts` rewrites it, then asserts the packed tarball is clean |
| Accidental / unreviewed release | Version PR merge + `main` branch protection + `release` Environment approval |
| Silent partial/incorrect publish | fail-closed registry check (network/auth errors abort, never blind-publish) |
