# Releasing

How `tskm`, `@tskm/compiler`, and `@tskm/vite` are published, and the one-time setup
required before the automated pipeline can run.

Publishing is **CI-only** and **tokenless**: GitHub Actions publishes via npm OIDC
Trusted Publishing (no long-lived `NPM_TOKEN` anywhere), and every published version
gets a Sigstore provenance attestation. `bun publish` is intentionally not used (it
supports neither OIDC nor provenance yet).

---

## One-time setup (human — cannot be done from CI)

Do these once, in order, before the first automated release.

### 1. Harden the npm account
- Register a **passkey / hardware security key** (WebAuthn) on the npm account, plus a
  backup key. New TOTP enrollment is disabled by npm, and TOTP is phishable — do not
  rely on it.
- Make sure no legacy `npm_`-prefixed classic tokens exist (they were all revoked
  2025-12-09); audit `~/.npmrc` and any Actions secrets.

### 2. Own the `@tskm` scope
- Create / confirm ownership of the `@tskm` scope (org or user scope) on npmjs.com.
  `@tskm/compiler` and `@tskm/vite` cannot be published otherwise.

### 3. Bootstrap publish (first version only)
The npm Trusted Publisher UI requires a package to already exist before you can attach a
trusted publisher to it. So publish `0.0.1` of each package **once**, manually, from your
machine. This first version has **no provenance** (provenance needs the CI OIDC context)
— that is expected and unavoidable.

```sh
npm login                  # issues a short-lived (~2h) session, prompts for your passkey
bun install --frozen-lockfile --ignore-scripts
bun run build
# Reuses scripts/publish.ts: ordered (compiler → tskm → vite), rewrites @tskm/vite's
# workspace:* dependency, and is idempotent. NPM_CONFIG_PROVENANCE=false is REQUIRED —
# publishConfig.provenance is true, which would otherwise fail outside CI.
NPM_CONFIG_PROVENANCE=false bun run release
```

### 4. Install the pkg.pr.new GitHub App (for preview releases)
- Install <https://github.com/apps/pkg-pr-new> and scope it to **only** `ushironoko/tskm`.
  Without it, `preview.yml` cannot publish preview packages.

### 5. Configure the Trusted Publisher on npmjs.com (per package)
For **each** of `tskm`, `@tskm/compiler`, `@tskm/vite`:
- Package → Settings → **Trusted Publisher** → GitHub Actions
- Organization/owner: `ushironoko`
- Repository: `tskm`
- Workflow filename: **`release.yml`** (exact, case-sensitive)
- Environment: `release`

### 6. GitHub repository settings
- **Branch protection on `main`** requiring a pull request review. This is the security
  boundary for releases — a publish can only happen after a human-merged Version PR.
- Settings → Actions → **default `GITHUB_TOKEN` permissions = read-only**.
- Create an Environment named **`release`** with **required reviewers** (so the publish
  job pauses for a human to approve each release; reviewers cannot self-approve).

### 7. After the first successful OIDC release
- For each package, enable **"Require two-factor authentication and disallow tokens"**
  (trusted publishing keeps working under this setting).
- Revoke any granular token used for the bootstrap publish.

---

## Routine release flow (automated)

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
     test, then publishes `compiler → tskm → vite` over OIDC with provenance.

4. **Verify** the green provenance badge on npmjs.com and:
   ```sh
   npm audit signatures
   ```
   Expected provenance: **`0.0.1` = none** (bootstrap), **`0.0.2`+ = present**.

## Preview releases

Every push and pull request triggers `preview.yml`, which publishes ephemeral preview
packages to pkg.pr.new (no npm registry, no tokens). The bot comments install URLs like:

```sh
bun add https://pkg.pr.new/ushironoko/tskm/@tskm/vite@<sha>
```

These are throwaway test artifacts — never commit a pkg.pr.new URL to `package.json` or a
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
