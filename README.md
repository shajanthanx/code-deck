# Claude Code Speedometer

A tiny, playful **desktop instrument cluster** for your Claude Code usage — a frameless,
always-on-top widget that visualises session/weekly usage, burn rate, AI power, and today's
hourly activity, all read from your local Claude Code data.

![widget](docs/preview.png)

## What it shows

| Instrument | Meaning | Source |
|---|---|---|
| **SESSION** arc (5h) | True used-% + reset countdown | live rate-limit capture (see below) |
| **WEEKLY** arc (7d) | True used-% + reset countdown | live rate-limit capture |
| **BURN RATE** speedometer | Estimated tokens/min (trailing 5 min) | derived from transcripts |
| **AI POWER** bar | Recent activity intensity (last ~30s) | derived from transcripts |
| **TODAY** histogram | Tokens per hour today (trailing 12h) | derived from transcripts |
| footer | last-response tokens, live sessions, active/idle, plan tier | transcripts + sessions + credentials label |

Everything except the two **used-%/reset** values is derived locally from your session
transcripts (`~/.claude/projects/**/*.jsonl`, deduped by `requestId`). Nothing is fabricated:
if the live percentages aren't available yet, the two window gauges fall back to showing your
real rolling **token totals** (clearly labelled), and the reset countdowns hide.

## How the true 5h / 7d percentages are captured

Claude Code fetches your live rate limits from the server and pipes them (with the context
window) to your **statusline command** at render time — then discards them; they are **not**
stored in any file. On first launch this app augments your `~/.claude/settings.json`
`statusLine.command` so it also tees that `rate_limits` payload to
`~/.claude/cc-speedometer-live.json` (which the widget reads). **Your statusline output is
reproduced exactly**, so your status bar looks unchanged. The original command is backed up;
use the tray menu → *Restore original statusline* to revert.

The live values refresh whenever a Claude Code session renders its statusline. Reset
countdowns keep ticking from the absolute reset timestamp even when nothing is running.

## Install (Windows)

Download the latest **`ClaudeCodeUsage-Setup-x.y.z.exe`** from the
[releases page](https://github.com/shajanthanx/code-deck-releases/releases/latest) and run it.

- It installs per-user (no admin prompt), adds Start-menu + desktop shortcuts, and launches.
- Your settings live in `%APPDATA%\claude-code-speedometer\` — **separate from the app**, so
  updates and uninstalls never touch them.
- Unsigned build note: Windows SmartScreen may show *"unknown publisher"* on first run — choose
  *More info → Run anyway*. (Auto-updates still verify each download's SHA-512.)

## Automatic updates

The app updates itself — **install once, no reinstalling**.

1. On launch (and every few hours) it checks the public update feed
   ([`code-deck-releases`](https://github.com/shajanthanx/code-deck-releases)).
2. A new version downloads quietly in the background while you keep working.
3. When it's ready, a small **update indicator** appears in the widget header (and a tray entry).
   Click it → **Restart to update**. The new version installs and relaunches; your settings are kept.
4. If you don't click, the staged update installs automatically the next time you quit and reopen.

No credentials are embedded in the app — the update feed is a public repo, so downloads are
anonymous. If you're offline or the check fails, the widget keeps running normally.

You can force a check any time: **tray icon → Check for updates**.

## Run from source (development)

```bash
npm install
npm start
```

Auto-update is disabled in `npm start` (unpackaged dev build); the tray shows *"Updates disabled
(dev build)"*. To produce an installer locally without publishing: `npm run dist` (output in
`dist/`).

- **Move it:** drag anywhere on the panel.
- **Show / hide:** global shortcut (default **Ctrl+Shift+Space**; change it from the tray).
- **Details:** click the SESSION or WEEKLY gauge for a token breakdown.
- **Tray icon:** show/hide, change shortcut, start-with-Windows, restore statusline, quit.

The window remembers its last position. It stays running in the tray when hidden and keeps
monitoring with negligible CPU.

## Privacy / safety

- Reads only local Claude Code files. Sends nothing anywhere.
- Never reads or displays secrets — the plaintext API key in `config.json` and the OAuth
  tokens in `.credentials.json` are never touched, except the two **non-secret** plan labels
  (`subscriptionType`, `rateLimitTier`).

## Releasing (maintainers)

Cutting a release is one command — see **[RELEASING.md](RELEASING.md)** for the full setup
(including the one-time GitHub Actions token) and the flow:

```bash
npm run release          # patch: 1.0.0 -> 1.0.1  (bumps, commits, tags, pushes)
npm run release:minor    # 1.0.0 -> 1.1.0
npm run release:major    # 1.0.0 -> 2.0.0
```

Pushing the `v*` tag triggers GitHub Actions, which builds the NSIS installer and publishes it
(with `latest.yml` + blockmap) to `code-deck-releases`. Installed apps update themselves from there.

## Tech

Electron + vanilla HTML/Canvas/CSS, plus `electron-updater` for in-place updates. No UI
frameworks, no bundler. Data layer in `src/`, updater in `src/updater.js`, UI in `renderer/`.
Distribution: electron-builder → Windows NSIS installer, published to GitHub Releases.
