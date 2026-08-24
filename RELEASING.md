# Releasing & auto-update

How this app ships and updates itself, and how to publish a new version.

## Architecture

```
 code-deck (PRIVATE)                         code-deck-releases (PUBLIC)
 ┌───────────────────────────┐   publish     ┌──────────────────────────────┐
 │ source + GitHub Actions   │ ───────────►  │ ClaudeCodeUsage-Setup-x.y.z.exe│
 │ (Release workflow)        │  (CI, PAT)    │ latest.yml  +  *.blockmap      │
 └───────────────────────────┘               └──────────────────────────────┘
                                                        ▲
                                                        │ anonymous HTTPS
                                                        │ (electron-updater)
                                              ┌──────────────────────┐
                                              │ users' installed apps │
                                              └──────────────────────┘
```

- **Source** lives in the private `code-deck` repo.
- **Release artifacts** are published to the public `code-deck-releases` repo, which is the app's
  update feed (`build.publish` in `package.json`).
- The shipped app downloads updates **anonymously** from the public feed — **no token is embedded
  in the app**, ever.
- Cross-repo publishing (private → public) is done by CI using a token stored **only** as a GitHub
  Actions secret.

## One-time setup

### 1. Create a publishing token

The built-in `GITHUB_TOKEN` can only write to the repo it runs in, so cross-repo publishing needs
your own token with write access to `code-deck-releases`.

**Fine-grained token (recommended):**
1. https://github.com/settings/tokens?type=beta → **Generate new token**
2. **Resource owner:** `shajanthanx`
3. **Repository access:** *Only select repositories* → **`code-deck-releases`**
4. **Permissions → Repository → Contents: Read and write**
5. Generate, copy the token (starts with `github_pat_…`).

(A classic token with the `repo` scope also works, but grants far more than needed.)

### 2. Store it as a secret in the *code-deck* repo

- GitHub UI: `code-deck` → **Settings → Secrets and variables → Actions → New repository secret**
  - **Name:** `GH_RELEASES_TOKEN`
  - **Value:** the token from step 1
- Or with the GitHub CLI:
  ```bash
  gh secret set GH_RELEASES_TOKEN --repo shajanthanx/code-deck
  ```

That's it — the `.github/workflows/release.yml` workflow reads `secrets.GH_RELEASES_TOKEN`.

> **Security:** never paste this token into code, chat, or a committed file. If it leaks, revoke it
> at https://github.com/settings/tokens and set a fresh one. Rotating the secret does not require
> any app change.

## Cutting a release

On a **clean** working tree, from the project root:

```bash
npm run release          # patch  1.0.0 -> 1.0.1
npm run release:minor    # minor  1.0.0 -> 1.1.0
npm run release:major    # major  1.0.0 -> 2.0.0
npm run release -- 1.4.2 # an exact version
```

This will:
1. Bump the version in `package.json` **and** `package-lock.json` (`npm version`).
2. Create a commit `chore(release): vX.Y.Z`.
3. Create the annotated tag `vX.Y.Z`.
4. Push the branch and the tag.

Pushing the tag triggers **Actions → Release** in `code-deck`, which:
1. `npm ci`
2. Verifies the tag matches `package.json` version.
3. `npm run publish` → `electron-builder --win nsis --publish always`
4. Uploads `ClaudeCodeUsage-Setup-X.Y.Z.exe`, `latest.yml`, and the blockmap to a **public
   release** in `code-deck-releases`.

Watch it: https://github.com/shajanthanx/code-deck/actions
Result: https://github.com/shajanthanx/code-deck-releases/releases

Add `--no-push` to stage the commit + tag locally and inspect before pushing.

## How updates reach users

- The installed app checks the feed ~10 s after launch and every 6 hours.
- `electron-updater` compares the running `app.getVersion()` against `latest.yml`'s version (semver).
- If newer, it downloads in the background (delta via the blockmap when possible), verifies the
  SHA-512, and surfaces the in-app **Restart to update** control. Unclicked, it installs on next quit.
- User data in `%APPDATA%\claude-code-speedometer\` is untouched by updates.

## Versioning

Semantic versioning: `MAJOR.MINOR.PATCH`.

- **PATCH** — fixes, no behaviour change for users.
- **MINOR** — backwards-compatible features.
- **MAJOR** — breaking changes.

The tag (`vX.Y.Z`) must equal `package.json` version — `npm run release` guarantees this, and CI
fails fast if they ever diverge.

## Code signing (recommended, not yet configured)

The build is currently **unsigned**. Auto-update still works (downloads are SHA-512-verified), but
users see a SmartScreen "unknown publisher" prompt on first install/update. To sign:

1. Obtain a Windows code-signing certificate (OV, or EV / Azure Trusted Signing to avoid SmartScreen
   reputation warm-up).
2. Add to CI as secrets and reference them in `build.win` (electron-builder), e.g. `CSC_LINK`
   (base64 .pfx) + `CSC_KEY_PASSWORD`, or the Azure Trusted Signing config.
3. Never commit the certificate or its password.

## Manual publish (fallback)

If you must publish from a dev machine instead of CI (e.g. CI is down):

```bash
# PowerShell — token is used only for this process, not stored
$env:GH_TOKEN = "<token-with-contents:write-on-code-deck-releases>"
npm run publish
```

Prefer CI so releases never depend on a developer's machine.

## Troubleshooting

- **CI fails at publish with 403 / not found** — `GH_RELEASES_TOKEN` missing, expired, or lacks
  Contents:write on `code-deck-releases`.
- **App never sees an update** — the release must be a real (non-draft) release with `latest.yml`
  attached; `code-deck-releases` must be public; the new version must be > the installed one.
- **"Tag does not match package version"** — you tagged manually; use `npm run release` instead.
- **Inspect updater behaviour on a user machine** — read `%APPDATA%\claude-code-speedometer\updater.log`.
