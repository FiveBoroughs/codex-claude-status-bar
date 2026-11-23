# Codex Claude Status Bar

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![GNOME Shell 45–50](https://img.shields.io/badge/GNOME%20Shell-45–50-4A86CF?logo=gnome&logoColor=white)](https://gjs.guide/extensions/)
[![Latest release](https://img.shields.io/github/v/release/ondrejbecva/codex-claude-status-bar?label=release)](https://github.com/ondrejbecva/codex-claude-status-bar/releases/latest)

**Keep an eye on your Claude, Codex, Meridian, and Muse Code quota — right from
the GNOME top bar.** Remaining percentages, reset countdowns, and low-quota
notifications use each provider's reported windows. Claude and Codex reuse
their CLI credentials; Meridian reads your configured proxy; Muse Code
reuses your OMP subscription sign-in. No Muse CLI installation is required.

<p align="center">
  <img src="docs/screenshot-panel.png" alt="The top bar: Claude 5h 90% / 7d 95%, Codex 7d 100%" width="560">
</p>

<p align="center">
  <img src="docs/screenshot-popup.png" alt="The popup: per-window remaining %, reset countdowns, and the settings section" width="380">
</p>

*Above: Codex shows only `7d` because OpenAI reports no 5-hour window on that
plan — the extension drops the window instead of printing `5h --`.*

---

## Features

- **Both providers, both windows** — Claude and Codex, session (5h) + weekly (7d).
- **Meridian** — a third, separate provider for a self-hosted
  [Meridian](https://github.com/rynfar/opencode-claude-max-proxy) proxy: reads the proxied
  Claude account's usage from its `/v1/usage/quota` endpoint, no credentials
  needed on this machine.
- **Muse Code via OMP** — reads the existing OMP Muse subscription credential
  from its SQLite database and queries Meta's quota API without inference,
  onboarding, or credential changes. Shows rolling and weekly allowances.
- **At-a-glance colour** — green ≥ 70 %, yellow ≥ 30 %, red below.
- **Detail popup** — per-window remaining %, reset countdown, manual refresh.
- **Compact panel** — each configured provider as icon + quota percentages.
- **Weekly exhaustion** — at 0% weekly remaining, hide the unusable session
  window from the panel and popup; keep weekly remaining and its reset countdown.
- **Claude Fable** — optional row + top-bar segment for Claude's model-scoped
  Fable weekly cap.
- **Low-quota alerts** — desktop notification when a window drops below 20 %,
  and again when it resets.
- **Zero setup** — no keys to paste; credentials come from the CLIs.

## Supported platforms

| Platform | How it runs | Status |
| --- | --- | --- |
| **Linux / GNOME** | Shell extension, GNOME **45 – 50**, Wayland **and** X11 | Shipping |
| **macOS** | Menu-bar plugin for [xbar](https://xbarapp.com) / [SwiftBar](https://swiftbar.app), needs Node 18+ | Working |
| **Any OS** | `platforms/cli/usage.js`, text or `--json`, needs Node 18+ | Working |
| **Windows** | Tray icon — the data path works, the tray shell is not built | Planned |
| **Linux / KDE** | — | Not built |

The fetch-and-parse core in `core/` imports no platform API; each entry in
`platforms/` supplies a runtime and a way to draw. See
[platforms/README.md](platforms/README.md) for macOS install steps and what
Windows still needs.

Distros for the GNOME extension: anything with GNOME 45+ — Ubuntu 24.04 / 25.04,
Fedora 40+, Debian 13, Arch. No native code anywhere, so architecture is
irrelevant.

> **Wayland note:** GNOME Shell can't hot-reload extension code on Wayland, so a
> newly installed or updated version loads after you **log out and back in**
> (on X11 you can instead run `Alt`+`F2` → `r`).

## Requirements

- GNOME Shell 45–50
- `glib-compile-schemas` (ships with GLib — `glib2` on Fedora/Arch,
  `libglib2.0-bin` on Debian/Ubuntu; usually already present)
- At least one configured provider: Claude Code/Codex CLI sign-in, Codex or
  Muse Code signed in through OMP, or a Meridian proxy. Unconfigured
  providers stay hidden in the top bar.
- Reading Codex or Muse Code credentials from OMP requires `sqlite3` on
  `PATH`; neither the Muse CLI nor a running OMP process is required.

## Install

### Quick install (prebuilt zip)

No clone, no build:

```bash
curl -LO https://github.com/ondrejbecva/codex-claude-status-bar/releases/latest/download/codex-claude-status-bar@ondrejbecva.cz.shell-extension.zip
gnome-extensions install --force codex-claude-status-bar@ondrejbecva.cz.shell-extension.zip
gnome-extensions enable codex-claude-status-bar@ondrejbecva.cz
```

Then **log out and back in**.

### From source

```bash
git clone https://github.com/ondrejbecva/codex-claude-status-bar.git
cd codex-claude-status-bar
./install.sh          # copies to ~/.local/share/…, compiles the schema, enables
```

Log out and back in. Uninstall with `./uninstall.sh`.

### Build a zip yourself

```bash
./pack.sh             # -> dist/codex-claude-status-bar@ondrejbecva.cz.shell-extension.zip
```

## Configuration

Click the panel indicator to open the popup; the settings live at the bottom of
that menu.

The top bar always shows each provider as *icon + percentages*; everything else
is per provider, under the **Claude**, **Codex**, **Meridian**, and **Muse Code** submenus:

| Option | What it does |
| --- | --- |
| **Show in top bar** | Per provider. Off hides that provider's icon and percentages from the bar; its popup section stays. A provider also hides itself while it has no data. |
| **5h + 7d / 5h only / 7d only** | Per provider — which windows that provider contributes to the bar. Default `5h + 7d`. A window the provider does not report is dropped rather than shown as `--`. An exhausted weekly allowance overrides `5h only`: show `7d 0%` instead, until weekly allowance returns. |
| **Show Fable usage** (Claude, Meridian) | Adds a `F Z%` segment to that provider's top-bar group and a **Fable** row in the popup. Reads the model-scoped weekly cap. Off by default; the segment appears only when the account reports a Fable limit. |
| **Icon** (Claude) | Starburst (Claude) vs. bracketed dots (Claude Code) mark. |

Meridian's address has no menu entry; it defaults to
`http://127.0.0.1:3456/` and is changed with GSettings (picked up on the
next poll):

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/codex-claude-status-bar@ondrejbecva.cz/schemas \
  set org.gnome.shell.extensions.codex-claude-status-bar meridian-url 'http://host:3456/'
```

Codex and Muse Code read `~/.omp/agent/agent.db` read-only. For a relocated
OMP database, set `omp-auth-db` using the same schema:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/codex-claude-status-bar@ondrejbecva.cz/schemas \
  set org.gnome.shell.extensions.codex-claude-status-bar omp-auth-db '/path/to/agent.db'
```

Muse uses the reported rolling duration (usually `5h`) rather than assuming
every session window is five hours. A missing duration is labeled `Rolling`.

Global toggles sit directly in the menu:

| Option | What it does |
| --- | --- |
| **Colorize percentages** | Colour the panel numbers by remaining %. |
| **Colored icons** | Brand-coloured provider icons vs. a mono grey that blends with the bar. |
| **Notify on limit reset** | Desktop notification when a 5h or 7d window hands its quota back. On by default. |

## How it works

Every **3 minutes** the extension asks each provider how much quota is left
and turns the answer into a remaining percentage and reset time per window.
Claude reuses its CLI sign-in.

Codex quota is fetched from ChatGPT's usage endpoint. The extension first
reads OMP's enabled `openai-codex` OAuth credential, including its account ID,
on each poll. OMP owns token renewal; the extension never refreshes or writes
OMP credentials. If no OMP credential can be read, Codex falls back to
`~/.codex/auth.json` and its CLI token-renewal flow. A rejected OMP token is
reported as an authentication failure without switching to the CLI account.
Sign in again through OMP if its credential expires. For CLI-file token
renewal, GNOME sends a form-encoded string without browser globals such as
`URLSearchParams`, which GJS does not provide.

Muse Code uses OMP's enabled `muse-code` OAuth credential, not its separate
Meta pay-as-you-go key. It follows [OMP's quota request](https://github.com/can1357/oh-my-pi/blob/6785d70d53e2bc10aad259a532f6b5255275991e/packages/ai/src/usage/muse-code.ts):
`POST https://api.meta.ai/muse-code/key` with an empty JSON object and the
Meta account token. No model request or onboarding is performed; returned
API keys and account identifiers are discarded. OMP remains responsible
for sign-in; the extension never writes its credential database.

Meta can omit `subs_usage` (or return `null`) for an active subscription
while its rolling window is idle, including after a long suspend. This also
withholds weekly usage even when some weekly allowance has been consumed
([upstream report](https://github.com/steipete/CodexBar/issues/4002)).
The extension reports **quota unavailable**, leaves both readings unknown,
and continues polling. Readings return when Meta includes quota again,
commonly after Muse is used. This is not an expired sign-in or a schema
change. Missing usage is never treated as 100% remaining, and previous
percentages are not presented as current. No model request is made to
activate a window, and no browser credentials are read.

**Privacy:** credential-bearing quota requests go only to Claude's, OpenAI's,
and Meta's own APIs. Meridian usage requests go to your configured proxy
without local credentials. No analytics or telemetry; credential values
and raw Muse quota responses are never included in output or error messages.

**Windows differ by plan.** Some Codex plans report only a 7-day window and no
5-hour one; Codex CLI's own `/status` leaves its 5-hour line out in exactly
that case. The extension shows the windows your account actually reports, so a
5-hour window appears by itself once your plan includes one.

Providers also move their reporting formats around — a window can change which
field it arrives in, or stop being sent at all. Rather than trusting position,
each window is identified by the duration it declares about itself, so a
reshuffled or single-window response is read correctly instead of being
mislabelled or rejected (`core/normalize.js`).

## Project layout

```
core/                   # platform-free: no gi://, no Node, no DOM
  poller.js             # drives providers on an interval, publishes a summary
  provider-slot.js      # one provider's latest state
  retry.js              # backs a provider off after repeated failures
  summary.js            # folds slots into one object
  providers/            # claude.js, codex.js + the shared OAuth harness
  normalize.js          # usage payload -> remaining % + reset time
  view-model.js         # summary -> exactly what a UI draws
  format.js             # every user-facing string
  notifications.js      # low-quota and rollover detection

platforms/
  gnome/runtime.js      # libsoup + Gio shims
  node/runtime.js       # global fetch + fs shims
  xbar/                 # macOS menu-bar plugin
  cli/usage.js          # text / --json, the seam for other shells

src/                    # the GNOME extension (uuid: codex-claude-status-bar@ondrejbecva.cz)
  extension.js          # panel indicator + popup UI
  lib/                  # still in use by the extension; being retired in favour of core/
  schemas/  icons/  stylesheet.css

test/                   # 122 cases, node:test, no dependencies — `npm test`
install.sh  uninstall.sh  pack.sh
```

`pack.sh` ships `src/` only, so `core/`, `platforms/` and `test/` are not part
of the GNOME extension zip.

## Credits & license

MIT — see [LICENSE](LICENSE), which carries the copyright notices for both this
project and the codebase it started from,
[brainusage](https://github.com/AltairInglorious/brainusage) by
AltairInglorious.
