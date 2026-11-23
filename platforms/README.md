# Platforms

`core/` holds everything that fetches, parses and decides. It imports no
platform API. Each directory here is a *shell*: it supplies a runtime (how to
make an HTTP request, how to read a file) and a way to draw.

| | Shell | Status |
| --- | --- | --- |
| **Linux / GNOME** | `platforms/gnome/` + `src/extension.js` | Shipping |
| **macOS** | `platforms/xbar/` | Working — needs Node |
| **Any OS, scripting** | `platforms/cli/` | Working — needs Node |
| **Windows** | — | Not built; see below |
| **Linux / KDE** | — | Not built |

## macOS — menu bar via xbar

A plugin is just an executable script: xbar runs it, reads stdout, and draws
it. No app bundle, no Swift, no code signing.

1. Install [xbar](https://xbarapp.com) (or [SwiftBar](https://swiftbar.app),
   same format) and Node 18+.
2. Clone this repository somewhere permanent.
3. Symlink the plugin into the plugin folder:

```bash
ln -s "$PWD/platforms/xbar/ai-usage.3m.js" \
  ~/Library/Application\ Support/xbar/plugins/ai-usage.3m.js
```

Node resolves symlinks to their real path before resolving imports, so the
plugin finds `core/` inside the clone. Keep the clone where it is.

The `3m` in the filename *is* the refresh interval — rename the file to
`ai-usage.5m.js` for five minutes. To show Claude's Fable cap, set
`SHOW_FABLE = true` at the top of the plugin.

Claude credentials are read from `~/.claude/.credentials.json`. Codex first
reads OMP's enabled `openai-codex` OAuth credential; when unavailable, it uses
`~/.codex/auth.json`. Meridian needs no local credentials; set `MERIDIAN_URL`
at the top of the plugin (or in the environment) if the proxy is not at the
default `http://127.0.0.1:3456/`.

Codex and Muse Code read `~/.omp/agent/agent.db` using `sqlite3` on `PATH`.
Set `OMP_AUTH_DB` to use a relocated OMP database. The database is never
modified, and OMP remains responsible for renewing its tokens. A rejected
OMP Codex credential reports an authentication failure without switching
accounts. Muse selects only subscription OAuth credentials, not Meta
pay-as-you-go keys; no Muse CLI installation is needed.

## Any OS — command line

```bash
node platforms/cli/usage.js          # human readable
node platforms/cli/usage.js --json   # the raw summary
node platforms/cli/usage.js --fable  # include the Fable cap (Claude and Meridian)
MERIDIAN_URL=http://host:3456/ node platforms/cli/usage.js  # point at another Meridian
OMP_AUTH_DB=/path/to/agent.db node platforms/cli/usage.js  # Codex and Muse Code through OMP
```

Exits non-zero when no provider returned usable data, so a caller can tell
"everything failed" from "here are the numbers" without parsing anything.

`--json` is the seam for any shell not written yet — a tray app, a prompt
segment, a Raycast script, a cron job.

Human-readable CLI and xbar output hide the session window when weekly
allowance is exhausted, keeping the weekly percentage and reset countdown
visible. The session window returns when weekly allowance does. Muse's
rolling label follows its reported duration. `--json` keeps both raw
normalized readings, without credentials or account identifiers.

An active Muse subscription can omit quota while its rolling window is idle.
CLI and xbar then report **quota unavailable**, with no percentages; JSON
uses provider code `QUOTA_UNAVAILABLE`, error kind `quota_unavailable`, and
`data: null`. Normal readings resume when the API includes usage again.
Missing quota is not an authentication failure or an unused full allowance.

## Windows — not built yet

The plan is a tray icon that opens a small panel on click. What exists already:
`core/` runs unchanged under Node, `platforms/node/runtime.js` supplies the
shims, and `platforms/cli/usage.js --json` gives a tray process its data
without it needing to know anything about OAuth or usage schemas.

What is missing is the tray shell itself. The options, roughly:

- **Node + a tray package** (`systray2` or similar) — one language for the whole
  project, but adds the repository's first runtime dependency, and shipping it
  means bundling Node with `bun build --compile` or Node's SEA so users are not
  asked to install a runtime.
- **PowerShell + `System.Windows.Forms.NotifyIcon`** — ships with Windows, so no
  bundling at all; it shells out to the CLI above for data. Least to install,
  most awkward to maintain.
- **Rust `tray-icon` + `tao`** — a single small static binary, but the usage
  logic would have to be reimplemented or driven as a subprocess.

Credential paths on Windows are `%USERPROFILE%\.claude\.credentials.json` and
`%USERPROFILE%\.codex\auth.json`; `platforms/node/runtime.js` already resolves
`~/` through `os.homedir()`, so no change is needed there.
