# HerdRabbit

English | [한국어](README.ko.md)

HerdRabbit is a small personal web app for controlling [Herdr](https://herdr.dev/) workspaces running on your own machine. It reconnects to existing Herdr sessions, shows terminal output and agent state, sends text and special keys, and installs as a PWA on desktop and mobile devices.

> [!IMPORTANT]
> HerdRabbit is a **personal-use tool for one person to access their own Herdr sessions**. It is not a multi-user account system, an authorization boundary between untrusted users, or a public hosting service. Do not expose it directly to the public internet. Use it over a private network such as Tailscale.

HerdRabbit runs once per OS user and may be protected with one instance password. It does not use usernames. The app, repository, and systemd service are all named `HerdRabbit`. Installations that still use the former `herdrabbit.service` name are migrated automatically the next time the installer runs.

## Reusable HTML UI

[`public/ui`](public/ui/README.md) contains the shared styles used by the app and a standalone catalog. Open `/ui/index.html` while the app is running, or copy the folder and open its `index.html` directly. Load `ui/ui.css` to reuse themes, buttons, inputs, navigation/status, menus, sidebars, and dialogs without a framework or build step.

Run `npm run check:ui` with Playwright installed, or set `PLAYWRIGHT_MODULE` to its module path.

## Recommended access: Tailscale first

HerdRabbit is designed to listen on `127.0.0.1` and be reached remotely through [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve):

```text
phone, tablet, or PC PWA
        │ HTTPS inside your tailnet
        ▼
Tailscale Serve
        │ HTTP to 127.0.0.1:3xxxx
        ▼
HerdRabbit on the Herdr machine
```

Both the Herdr machine and the device opening HerdRabbit must be signed in to the same tailnet. The resulting HTTPS URL is tailnet-only, not a public website. The optional HerdRabbit password adds another layer but does not replace Tailscale. Do not enable Tailscale Funnel for this app.

When Tailscale is installed and running, the [one-line installer](#quick-install) automatically detects the machine's Tailscale DNS name, allows that host, and registers an HTTPS Serve rule on HerdRabbit's selected port. See [Tailscale Serve HTTPS](#tailscale-serve-https) for manual setup and troubleshooting.

## Features

- Browse the current OS user's Herdr persistent sessions, workspaces, tabs, panes, and agent states
- Aggregate multiple Herdr persistent sessions without local ID collisions
- Render ANSI terminal output, restore past conversation for alternate-screen agents such as Claude from their session log, and load 200 older lines when scrolling to the top
- Send text and shell commands, or use a two-row extra-key bar with Ctrl/Alt/Shift, Esc, Tab, Home/End, PgUp/PgDn, arrows, slash, minus, and Enter. Select modifiers, then tap a key or type it on your keyboard (for example Ctrl → End or Ctrl → C). Modifiers clear after one send or when switching panes. Ordinary composer shortcuts remain local unless a screen modifier is selected.
- Create shell workspaces and tabs, rename workspaces, and close tabs or workspaces after confirmation
- Move files between the browsing device and the Herdr machine through a shared uploads folder: upload from the composer's attach button, paste the stored path into the composer, and download or delete stored files
- Remember the selected pane and collapsed workspaces in the browser
- Switch sidebar entries with `Ctrl+Tab`, `Ctrl+Shift+Tab`, or `Ctrl+1`–`Ctrl+9` when the browser forwards those shortcuts to the app
- Restore terminal font size and the last 100 sent prompts per pane across app launches; use Up/Down in the composer to recall prompts
- Show Herdr-native state symbols such as `×`, `◐`, `✓`, `○`, and `·`
- Emphasize unviewed completed sessions and their collapsed projects in the sidebar
- Send status-only PWA notifications with the project and tab names when agent state changes
- Install as a responsive PWA with light and dark themes
- Resize terminal text with `Ctrl`/`Cmd` + wheel, trackpad zoom, or a two-finger mobile gesture
- Protect an instance with an optional password, Passkey login, a seven-day hard session limit, and login on each new PWA window
- Install a per-user systemd service on a collision-free port in `30000–39999`
- Register Tailscale Serve HTTPS during setup when Tailscale is available

Pane splitting, Herdr persistent-session renaming, and multi-user accounts are not currently provided.

## Technology

- **Server:** Node.js 22+, ESM, and Node's standard-library HTTP, crypto, filesystem, and process APIs
- **Web UI:** semantic HTML, CSS, and vanilla JavaScript with no frontend framework
- **PWA:** Web App Manifest, Service Worker app-shell caching, responsive standalone UI
- **Notifications:** standards-based Web Push, Push API, VAPID, and the `web-push` package
- **Herdr integration:** local `herdr` CLI calls through `execFile` argument arrays without a shell
- **Process management:** per-user `systemd --user` service on Linux
- **Private HTTPS:** Tailscale Serve proxying to a loopback HTTP listener
- **Authentication:** WebAuthn Passkeys through SimpleWebAuthn, `scrypt` password hashes, HMAC-signed sessions, `HttpOnly` cookies, per-window signed launch tokens, CSRF tokens, and same-origin checks
- **Testing:** Node's built-in `node:test`, integration tests, and a fake Herdr executable

Live terminal input (including composer submissions and extra keys) and output use `/api/terminal` WebSocket. After the initial snapshot, only changes are sent. Herdr 0.8.2 has no general screen-change subscription, so the server observes output: 50 ms after each read during activity, 500 ms when quiet, shared by viewers of the same pane and line range. Background pages disconnect and receive a fresh snapshot on return. Session status uses Herdr `pane.agent_status_changed` events over WebSocket, including unselected sessions. Project/session lists still refresh over HTTP every two seconds and resynchronize after the status subscription starts. HTTP list refreshes also cover subscription failures while retrying. Older history, authentication, and project/session management remain HTTP. Push notifications are unchanged.

## Additional machines

Local Herdr remains the default. Use **+ → Connect Server** at the top of the sidebar to add another machine. All registered servers appear together as **server → Herdr session → project → tab/pane**; selecting a pane sends input and reads output on that machine.

Every server is another HerdRabbit. Install it on that machine in **leaf mode**, naming this machine as its hub, then enter its tailnet address here, such as `http://100.101.171.95:38787`. Nothing is stored on this side but the name and the address: a leaf recognises its hub by the address the requests arrive from, so there is no key or password to keep anywhere. **Save** stays disabled until **Test connection** succeeds for the address currently in the form; changing it closes Save again.

A leaf needs no HTTPS and no `tailscale serve`. It listens on its own tailnet address, and the tailnet is what proves who is calling. HTTPS matters only for a hub, which a browser opens: service workers and passkeys require a secure context.

Both machines must run the same HerdRabbit version. A mismatch shows that server as offline and names both versions rather than merging a snapshot whose shape may differ. `update.sh` moves a machine to the latest `main`, so update hub and leaves together.

Remote snapshots refresh independently, with slower retries after a failure, so an unreachable machine does not hold up local data. Last-known remote panes stay visible during an outage and their server is marked offline. Terminal output for a remote pane is polled through the same watcher local panes use, and agent status arrives on a server-sent event stream from the leaf.

A linked machine is a full participant: its sessions appear in the project/session picker, and projects and tabs can be created, renamed and closed there. The machine that owns a session is the one that validates the change, so its rules cannot drift from what a person sitting at it would get.

Servers are stored on this machine in `~/.config/herdr-bridge/servers.json` with mode `0600`; override with `HERDR_WEB_SERVERS_FILE`. They are shared by every device using this HerdRabbit instance.

## Architecture

```text
Browser / installed PWA
        │
        │ HTTPS (optional)
        ▼
Tailscale Serve
        │
        │ http://127.0.0.1:3xxxx
        ▼
HerdRabbit Node.js server
        │
        │ execFile argument arrays
        ▼
local herdr CLI ── default and named Herdr persistent sessions
                         └─ workspaces, tabs, and panes
```

Creating a project creates a Herdr workspace and default shell. Creating a session creates a new tab and default shell in that workspace. HerdRabbit does not run a separate terminal backend; it reads from and writes to Herdr panes.

### Multiple Herdr persistent sessions

HerdRabbit calls `herdr session list --json`, reads snapshots from every running persistent session, and scopes local IDs such as `w1:p1` to their originating session.

- One persistent session is shown without an extra grouping level.
- Multiple or unavailable sessions are grouped and labeled in the sidebar.
- Stopped sessions show their state but are not queried for snapshots.
- Commands are routed back to the original Herdr persistent session.
- Sessions owned by another OS user and one-off `herdr --no-session` processes are not included.

### Multiple OS users on one server

Each Linux user runs their own installation. `systemd --user` isolates identically named services by OS account, while the installer selects an unused local and Tailscale HTTPS port.

```text
alice → 127.0.0.1:38787 → https://server.example.ts.net:38787
bob   → 127.0.0.1:30000 → https://server.example.ts.net:30000
```

Each instance is still personal: it exposes only the Herdr sessions and configuration of the OS user running that instance.

## Requirements

- Linux for automatic systemd service installation; macOS may use direct execution
- Node.js 22 or newer
- Git and curl for the one-line installer
- A running Herdr persistent session
- Tailscale when remote HTTPS access is required
- Outbound internet access to browser push services when background notifications are enabled

Check the local tools with:

```bash
node --version
herdr --version
herdr status server
```

If Herdr is absent, the HerdRabbit service installer downloads the official Herdr installer automatically. To install Herdr yourself:

```bash
curl -fsSL https://herdr.dev/install.sh | sh
```

Herdr installs to `~/.local/bin/herdr` by default. Add it to your shell PATH if necessary:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Quick install

Run this in a Linux terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/ultivis-iot/HerdRabbit/main/install.sh | sh
```

The bootstrap script:

1. Checks Linux, Git, and Node.js 22+
2. Clones or updates HerdRabbit in `~/.local/share/herd-rabbit`
3. Installs Herdr from `https://herdr.dev/install.sh` when `herdr` is missing
4. Prompts for an optional HerdRabbit password through the terminal
5. Selects an unused port, preferring `38787` and then `30000–39999`
6. Installs and starts `herdrabbit.service` for the current OS user
7. Registers Tailscale Serve HTTPS when Tailscale is running
8. Prints the final local port and HTTPS URL

The bootstrap refuses to overwrite local changes in an existing installation. Override its installation directory with `HERD_RABBIT_INSTALL_DIR`:

```bash
HERD_RABBIT_INSTALL_DIR="$HOME/apps/herd-rabbit" \
  sh -c "$(curl -fsSL https://raw.githubusercontent.com/ultivis-iot/HerdRabbit/main/install.sh)"
```

### Manual repository install

```bash
gh repo clone ultivis-iot/HerdRabbit
cd HerdRabbit
npm ci --omit=dev
npm run install-service
```

The service installer asks for the password without echoing it:

```text
HerdRabbit 비밀번호 (비워 두면 사용 안 함):
비밀번호 확인:
```

- Enter a password to require login in the web app.
- Press `Enter` with an empty password to disable authentication.
- Tailscale setup may request your sudo password for `sudo tailscale serve`.
- If Tailscale is not running, local service installation still completes.

### Direct execution

Run without installing a service:

```bash
npm ci --omit=dev
npm start
```

The default address is:

```text
http://127.0.0.1:38787
```

The one-line installer installs the Web Push and WebAuthn runtime dependencies automatically. Run `npm ci --omit=dev` after a manual clone or update.

## Password and Passkey authentication

Run this as the same Linux user that owns the service:

```bash
cd ~/.local/share/herd-rabbit
npm run password
```

Entering a new password twice replaces the old password and restarts the installed service. Leaving the first input empty disables password authentication. Existing login sessions and registered Passkeys become invalid after either change.

The plaintext HerdRabbit login password is never stored. The `scrypt` hash, session-signing secret, and registered Passkey public data are stored with mode `0600` in the compatibility path:

```text
~/.config/herdr-bridge/auth.json
```

Authenticated sessions have a fixed seven-day maximum lifetime. Every API request requires both an `HttpOnly`, `SameSite=Strict` cookie and a separately signed token stored in the current window's `sessionStorage`. Closing the PWA or tab and opening a new one requires login again by Passkey or password. Reloading or returning from the background in the same window keeps the login. HTTPS connections also use the cookie's `Secure` attribute.

After the first successful password login, HerdRabbit offers to register a Passkey when the browser supports WebAuthn. Later login screens show **Sign in with a passkey** beside the password fallback. Depending on the device, the browser can use Face ID, a fingerprint, Windows Hello, the device PIN, a security key, or cross-device QR authentication. The biometric and private key stay on the authenticator; HerdRabbit stores only the credential ID, public key, signature counter, and transport metadata. Passkeys are bound to the exact hostname used during registration, so use the stable Tailscale HTTPS address rather than alternating between addresses.

## Usage

### Selecting and restoring a session

Select an agent or pane in the sidebar to show its output. The last selected pane is stored in `localStorage` and restored on reload when it still exists. Browser storage is isolated by origin, so an HTTP LAN URL and a Tailscale HTTPS URL have separate preferences.

Opening a completed `✓` session marks that completion as viewed and changes it to idle `○` in the current browser. A later completion has a new state sequence and displays `✓` again.

### Agent status notifications

Use the bell at the bottom of the sidebar to enable or disable notifications for the current browser or installed PWA. Permission is requested only after pressing this control.

- Titles use `project name · tab name`.
- Completion, input required, returned to idle, and unavailable-state transitions use short status-only messages.
- Each state event is sent once, and a newer alert replaces the previous alert for the same session. Opening it launches or focuses the installed PWA and restores the targeted session.

Background delivery uses standards-based Web Push; a Firebase project and FCM SDK are not required. On iPhone and iPad, install HerdRabbit on the Home Screen and allow notifications on iOS/iPadOS 16.4 or newer.

VAPID keys and per-device Push subscriptions are stored with mode `0600` in:

```text
~/.config/herdr-bridge/push.json
```

Project and tab names may appear on the lock screen. Previous commands and request text are not included. Enable notifications only on personal devices.

### Projects and sessions

- Use the top `+` action to create a named workspace with a default shell.
- Use a project's `⋯` menu to rename it, add a shell session, or close the project.
- Use a session's `⋯` menu to close that Herdr tab.
- Collapse or expand a project's child sessions with the arrow beside its name.
- Servers and Herdr sessions collapse the same way, so a sidebar listing several machines can be narrowed to the one in use. The choice is remembered per browser.
- Destructive close actions always require confirmation.

Run commands such as `cd`, `codex`, or `claude` inside a created shell. Creation uses Herdr's `--no-focus` option so it does not steal focus from the desktop Herdr client.

### Input

Click or tap the terminal output for direct input, indicated by `Direct input`. Text, Tab, arrows, Enter, and Ctrl combinations go to the current pane immediately, including shell and agent completion menus. IME composition updates are sent immediately as edits to the changed suffix. Selecting terminal text preserves native copy; clicking the composer returns to the draft-and-submit behavior below. Composer history does not intercept direct input.

Direct writes are ordered. A failed write stops pending input without automatic retries; check the terminal before clicking it to resume. Output still uses server-observed ANSI snapshots rather than a full terminal emulator, so cursor and full-screen TUI fidelity are not guaranteed.

| Action | Key or control |
| --- | --- |
| Send input in a mouse-oriented environment | `Enter` |
| Insert a newline in a mouse-oriented environment | `Ctrl+Enter` |
| Insert a newline in a touch-oriented environment | `Enter` |
| Send input in a touch-oriented environment | Arrow send button |
| Send from an external keyboard on a touch device | `Ctrl+Enter` or `Cmd+Enter` |
| Recall previous sent input | `↑` |
| Recall later input or restore the current draft | `↓` |

The composer starts at one line, grows with explicit or soft wrapping up to five lines, and then scrolls internally. Submitted text is delivered atomically with Enter through Herdr's `pane run` command.

### Files

The attach button beside the composer, and the folder icon at the foot of the sidebar, both open the **Uploads** dialog. Pick a file and choose **Upload**: it is stored in a shared uploads folder on the machine running HerdRabbit, and its absolute path is inserted into the composer, ready to hand to an agent. Nothing is sent until you submit. The dialog also lists what the folder already holds, with a row each for inserting the path, copying it, downloading the file, and deleting it.

A file can also be dropped anywhere on the terminal panel without opening anything, and an image pasted with `Ctrl`/`Cmd`+`V` is uploaded the same way — a screenshot goes from the clipboard to a path in the composer in one step, stored under a name that records when it arrived. Ordinary text pasting is unchanged.

Browsing is separate, in the sidebar. It has two tabs: **Sessions** is the project list, and **Files** is a tree of the machine's filesystem. Folders expand in place when you click their name or the arrow beside them, and a folder's own button re-roots the tree there so a deep path stops costing indentation. The ↑ button walks to the parent, and **Show hidden** reveals dotfiles. Any file can be downloaded to the browsing device from its row.

The path box above the tree goes anywhere directly. Typing offers matching folder names — arrow keys move through them and `Enter` opens the highlighted one. The tab reopens wherever browsing last stopped, and the uploads folder is the starting point on a first visit.

Browsing is read-only: nothing in the tree can be changed, and uploading and deleting live in the Uploads dialog instead. Files copied into the folder from a terminal appear in that dialog too. The uploads folder is `~/.local/share/herdrabbit/files` unless `HERDR_WEB_FILES_DIR` names another directory; it is deliberately separate from the configuration directory that holds credentials. One upload may be at most 50MB, one download at most 1GB, and the folder itself has no size or file-count limit, so it grows until the disk is full and nothing is removed on your behalf.

With more than one machine registered, the Files tab gains a picker: choose one and the tree shows that machine, starting at its home. Each machine remembers its own last folder. Uploads follow the session you are looking at — with a remote session selected, a file you attach or paste lands on **that** machine and the path inserted into the composer is one the session can open.

A linked machine answers for its own files using the same browser it would use for a person opening it directly. This hub never reads another machine's disk; it asks. The confinement is therefore identical on every machine: browsing is read-only, and writes reach only that machine's own uploads folder.

On iOS, a browser in standalone PWA mode may open a downloaded file instead of saving it. Use the share sheet to store it.

### Output and history

터미널 출력과 이전 기록은 Herdr의 ANSI 화면 및 스크롤백에서만 가져옵니다. Claude JSONL 로그를 조회하거나 화면에 합치지 않습니다. 상단으로 스크롤하면 이전 기록을 200줄씩 추가 요청하며 최대 100,000줄까지 조회합니다. Herdr에 남아 있지 않은 기록은 표시할 수 없습니다. Claude는 설치 시 설정하는 일반 터미널 모드를 사용해야 스크롤백을 조회할 수 있습니다.

Live terminal input (including composer submissions and extra keys) and output use `/api/terminal` WebSocket. After the initial snapshot, only changes are sent. Herdr 0.8.2 has no general screen-change subscription, so the server observes output: 50 ms after each read during activity, 500 ms when quiet, shared by viewers of the same pane and line range. Background pages disconnect and receive a fresh snapshot on return. Session status uses Herdr `pane.agent_status_changed` events over WebSocket, including unselected sessions. Project/session lists still refresh over HTTP every two seconds and resynchronize after the status subscription starts. HTTP list refreshes also cover subscription failures while retrying. Older history, authentication, and project/session management remain HTTP. Push notifications are unchanged.

### Display settings

Use the control at the bottom of the sidebar to switch between light and dark mode. Adjust terminal and composer text size with `Ctrl`/`Cmd` + wheel or trackpad zoom. On mobile, pinch over terminal output with two fingers. The selected size is saved in `localStorage`.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `HERDR_WEB_HOST` | `127.0.0.1` | Any literal address to listen on: `127.0.0.1`, `0.0.0.0`, or one interface such as this host's Tailscale address. A single address is the tightest option -- the service is then absent from every other network the machine is on, and that address is accepted as a request host automatically. Names are refused, since they resolve at listen time. |
| `HERDR_WEB_PORT` | `38787` | Listening port from 1024 through 65535 |
| `HERDR_WEB_ALLOWED_HOSTS` | empty | Additional reverse-proxy or Tailscale hostnames, comma-separated |
| `HERDR_WEB_ROLE` | `hub` | `hub` serves people; `leaf` serves only its hub and answers nothing else. A leaf listens either on this machine's tailnet address, where the caller is read off the socket, or on loopback behind `tailscale serve`, where Tailscale stamps the caller's identity on. It may not bind every interface, and it must have no password -- the process refuses to start otherwise. |
| `HERDR_WEB_PEER_LOGINS` | empty | Tailnet logins a leaf accepts, comma-separated. Read from `Tailscale-User-Login`, which Tailscale Serve stamps on and strips from public traffic. Setting this without `HERDR_WEB_ROLE=leaf` is refused, because it would otherwise leave the API open to the whole tailnet while everything still appeared to work. |
| `HERDR_WEB_PEER_ADDRESSES` | empty | Tailnet addresses a leaf accepts, comma-separated. Required when a leaf listens on its tailnet address, since that is the only thing it has to go on. Behind Serve it is still worth setting: a login proves the account, not the device, so without it a leaf answers every device that account owns. |
| `HERDR_WEB_AUTH_FILE` | `~/.config/herdr-bridge/auth.json` | Password hash and signing-secret file |
| `HERDR_WEB_PUSH_FILE` | `~/.config/herdr-bridge/push.json` | VAPID keys and browser Push subscriptions |
| `HERDR_BIN` | `herdr` | Herdr executable path |

Example:

```bash
HERDR_WEB_HOST=0.0.0.0 \
HERDR_WEB_PORT=38787 \
HERDR_WEB_ALLOWED_HOSTS=my-server.example-tailnet.ts.net \
HERDR_BIN="$HOME/.local/bin/herdr" \
npm start
```

`127.0.0.1` is the recommended value for local and Tailscale Serve access. Use `0.0.0.0` only when direct LAN access is intentional. Password protection does not make direct public-internet exposure appropriate because authenticated users can write to your Herdr terminal panes and read any file that account can read.

## systemd user service

The recommended setup is:

```bash
npm run install-service
```

New installations try `38787`, then search `30000–39999` while excluding local listeners and existing Tailscale HTTPS ports. Reinstalling an existing user service preserves its assigned port.

For a manual service installation, review and adapt [`systemd/herdrabbit.service`](systemd/herdrabbit.service), then run:

```bash
mkdir -p ~/.config/systemd/user
cp systemd/herdrabbit.service ~/.config/systemd/user/
systemctl --user edit --full herdrabbit.service
systemctl --user daemon-reload
systemctl --user enable --now herdrabbit.service
```

Inspect the service with:

```bash
systemctl --user status herdrabbit.service
journalctl --user -u herdrabbit.service -f
```

To keep the per-user service running after logout, enable linger if allowed by the machine's policy:

```bash
sudo loginctl enable-linger "$USER"
```

## Tailscale Serve HTTPS

[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) proxies tailnet-only HTTPS requests to HerdRabbit's loopback listener. Both the server and client device must be connected to the same tailnet.

The automatic installers perform this setup. For manual setup:

```bash
tailscale status
tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")'
```

Add the resulting DNS name, without a scheme or port, to `HERDR_WEB_ALLOWED_HOSTS`, restart HerdRabbit, and register the HTTPS port. For port `38787`:

```bash
systemctl --user restart herdrabbit.service
sudo tailscale serve --bg --yes --https=38787 http://127.0.0.1:38787
tailscale serve status
```

Expected shape:

```text
https://my-server.example-tailnet.ts.net:38787 (tailnet only)
|-- / proxy http://127.0.0.1:38787
```

The `--bg` configuration survives Tailscale and machine restarts. Remove every Serve rule with `sudo tailscale serve reset`. Do not use Tailscale Funnel for HerdRabbit.

## Install the PWA

- **Chrome or Edge desktop:** open the Tailscale HTTPS URL and use the browser's install-app action.
- **iPhone or iPad:** open the HTTPS URL in Safari, use Share, then **Add to Home Screen**.
- **Android:** open the HTTPS URL in Chrome and choose **Install app** or **Add to Home screen**.

If an older name, icon, or app shell remains cached, fully close and reopen the PWA. Reinstalling the PWA may be required for an OS-level app-name or icon cache.

## Update

설치 및 업데이트 시 현재 사용자의 Claude 전역 설정(`~/.claude/settings.json`, `CLAUDE_CONFIG_DIR` 지정 시 해당 경로)에 `tui: "default"`와 `env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: "1"`을 적용합니다. Claude 자체 스크롤 대신 일반 터미널 스크롤을 사용하기 위한 설정입니다. 기존 설정은 변경 시 같은 폴더의 `settings.json.herdrabbit-*.bak`에 백업하고 다른 항목은 보존합니다. 실행 중인 Claude는 재시작 후 적용되며, 원격 SSH 호스트에는 별도로 적용해야 합니다. Claude 자체 업데이트 후에도 전역 설정은 유지됩니다. 수동 적용 명령은 `node scripts/configure-claude.mjs`입니다.

```bash
cd ~/.local/share/herd-rabbit
sh ./update.sh
```

Run as the Linux account that installed the service. The updater uses its own directory, or `HERD_RABBIT_INSTALL_DIR`. It requires a clean `main` branch and the official origin, fetches and fast-forwards `main`, installs dependencies, verifies, and restarts the matching user service. A lock prevents concurrent updates. Local changes, divergent commits, or failed dependency installation/verification stop the process before restart. This is an in-place update: code or dependencies may already have changed on failure; there is no automatic rollback. Ports, authentication, Tailscale settings, and saved servers are preserved. If an older installation lacks `update.sh`, run `git pull --ff-only` once first.

The Service Worker reloads the page once when it activates a new app shell. Manually refresh a tab that has remained open for a long time.

## Verification and development

```bash
npm run verify
npm run dev
```

Tests use a fake Herdr executable and temporary state. They do not write to real terminal panes or create and close real workspaces or sessions.

```text
public/   browser UI, PWA manifest, Service Worker, and icons
scripts/  bootstrap, service installation, Herdr installation, and password tools
src/      HTTP server, validation, authentication, and Herdr CLI adapters
systemd/  example per-user service unit
test/     unit and integration tests plus fake Herdr
```

## Troubleshooting

### `421 Request host rejected`

Add the current DNS hostname, without a scheme or port, to `HERDR_WEB_ALLOWED_HOSTS` and restart the service.

### Connection indicator shows an error

```bash
systemctl --user status herdrabbit.service
herdr status server
herdr api snapshot
journalctl --user -u herdrabbit.service -n 100 --no-pager
```

### `Herdr returned invalid JSON`

This means a Herdr command that should return JSON did not do so. Verify `HERDR_BIN` and run `herdr api snapshot` directly.

### Tailscale HTTPS does not open

```bash
tailscale status
tailscale serve status
systemctl --user status herdrabbit.service
```

Confirm that server and client use the same tailnet, MagicDNS and HTTPS certificates are enabled, and the tailnet ACL permits the client.

### Forgotten password

Open a shell on the machine as the service's OS user and run `npm run password`. The old password is not required. Replacing or disabling it invalidates existing sessions and registered Passkeys.

### Installer cannot find a port

The installer stops only when every port in `30000–39999` is already used by a local listener or Tailscale Serve rule.

```bash
ss -ltn
tailscale serve status
```

### Old UI or icon remains visible

Close every tab or installed PWA window and reopen it. If necessary, clear site data or reinstall the PWA. Clearing site data also resets the selected pane, collapsed workspaces, theme, and terminal font size.

## Security boundaries

- The default listener is `127.0.0.1`.
- This remains a personal single-user tool even when the repository is public.
- HerdRabbit login passwords are stored only as `scrypt` hashes in a mode-`0600` file. Servers hold no credential at all: a leaf recognises its hub by the address its requests arrive from, so there is nothing to store.
- Passkey private keys and biometric data never reach HerdRabbit; only public credential data is stored.
- Protected APIs require both a signed `HttpOnly` cookie and a separate signed current-window token.
- HTTPS cookies use `Secure`; all login cookies use `SameSite=Strict`.
- Changing or disabling the password invalidates existing sessions and removes registered Passkeys.
- Herdr commands use shell-free `execFile` argument arrays.
- Session, workspace, tab, pane, label, input length, output row count, and command duration are validated and bounded.
- The browser cannot invent a Herdr persistent session; only recently discovered running sessions are accepted.
- Destructive close APIs require an explicit confirmation value.
- Write APIs require both a per-process CSRF token and a same-origin request.
- Allowed request hosts are restricted, CORS is not enabled, and strict CSP, frame, and MIME-sniffing protections are sent.
- The Service Worker caches only static app-shell files, never API responses or terminal output.
- Writes reach only this machine's uploads folder, which sits outside the configuration directory holding the password hash and VAPID keys. Upload and delete cannot address a path outside it: names from the URL are rejected rather than repaired, and the target is taken from the directory listing rather than a composed path.
- Browsing is read-only and reaches **every path the service account can read on this machine**. There is no path allow-list; the OS file permissions are the boundary. That includes `~/.ssh`, `~/.config/herdr-bridge/`, and `/proc/self/environ`. This is not an escalation, because an authenticated client can already run arbitrary commands as that account through a terminal pane — but it is a further reason not to run HerdRabbit as root or as a shared account.
- A **leaf** is protected by the tailnet, not by a password. Listening on its own tailnet address is the stronger of the two shapes: the caller's address is set by the kernel from a WireGuard-authenticated peer, so a process on the leaf cannot claim to be the hub. Behind `tailscale serve` the proof is a header instead, which only holds while Serve is the one thing that can reach the socket -- and there **any local process on the leaf, as any user, can forge that header and reach the whole API.** Prefer the direct shape unless something else needs Serve on that port.
- A leaf's identity check authenticates an **account**, not a device, so `HERDR_WEB_PEER_ADDRESSES` is what stops every device that account owns from reaching it directly.
- No machine holds another's credentials. Each one runs its own HerdRabbit and its own Herdr, so compromising one does not hand over the others.
- Reading a file this way leaves no trace in any pane's history, works with no Herdr session running at all, and streams at link speed. Terminal-borne copying does none of those things.
- Regular files only. Directories, devices, and FIFOs are refused after the file is opened non-blocking, so a named pipe cannot stall the server. Files are served as `attachment` with `application/octet-stream`, and a single download is capped at 1GB.
- Downloads are fetched through a single-use ticket that expires in 30 seconds, so no file path appears in a URL. Directory paths and the server they belong to do appear in the browse request URL and will be recorded by any reverse proxy in front of HerdRabbit.
- Stored files are mode `0600` inside a mode-`0700` directory, and are always served as `attachment` with `application/octet-stream` so an uploaded HTML or SVG file cannot render in the browser.
- One upload is capped at 50MB and is refused from its declared `Content-Length` before any of the body is read. The uploads folder has no total size or file-count limit, so disk space is the only bound.
- Accepting a whole file in one request raises the body-receive timeout to two minutes for every route. The header timeout is unchanged, so slow-header attacks are still cut off, but a slow body is not.
- VAPID private keys and Push subscription URLs are stored in a mode-`0600` file readable only by the owning OS user.
- Browser storage contains UI preferences and the current-window launch token, not terminal history or the password.

## License

[MIT](LICENSE)
