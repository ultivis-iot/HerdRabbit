# HerdRabbit

English | [한국어](README.ko.md)

HerdRabbit is a small personal web app for controlling [Herdr](https://herdr.dev/) workspaces running on your own machine. It reconnects to existing Herdr sessions, shows terminal output and agent state, sends text and special keys, and installs as a PWA on desktop and mobile devices.

> [!IMPORTANT]
> HerdRabbit is a **personal-use tool for one person to access their own Herdr sessions**. It is not a multi-user account system, an authorization boundary between untrusted users, or a public hosting service. Do not expose it directly to the public internet. Use it over a private network such as Tailscale.

HerdRabbit runs once per OS user and may be protected with one instance password. It does not use usernames. The app and repository are named `HerdRabbit`; the internal `herdr-web-local` systemd service name remains unchanged for compatibility with existing installations.

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
- Render ANSI terminal output and load 200 older lines when scrolling to the top
- Send text, shell commands, `Esc`, `Ctrl+C`, `Tab`, `Shift+Tab`, arrow keys, and `Enter`
- Create shell workspaces and tabs, rename workspaces, and close tabs or workspaces after confirmation
- Remember the selected pane and collapsed workspaces in the browser
- Show Herdr-native state symbols such as `×`, `◐`, `✓`, `○`, and `·`
- Send request-aware PWA notifications with the project and session names when agent state changes
- Install as a responsive PWA with light and dark themes
- Resize terminal text with `Ctrl`/`Cmd` + wheel, trackpad zoom, or a two-finger mobile gesture
- Protect an instance with an optional password, a seven-day hard session limit, and login on each new PWA window
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
- **Authentication:** `scrypt` password hashes, HMAC-signed sessions, `HttpOnly` cookies, per-window signed launch tokens, CSRF tokens, and same-origin checks
- **Testing:** Node's built-in `node:test`, integration tests, and a fake Herdr executable

HerdRabbit does not use WebSockets. Terminal output is refreshed by HTTP polling every second; session and agent state is refreshed every two seconds.

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
6. Installs and starts `herdr-web-local.service` for the current OS user
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

The one-line installer installs the `web-push` runtime dependency automatically. Run `npm ci --omit=dev` after a manual clone or update.

## Password management

Run this as the same Linux user that owns the service:

```bash
cd ~/.local/share/herd-rabbit
npm run password
```

Entering a new password twice replaces the old password and restarts the installed service. Leaving the first input empty disables password authentication. Existing login sessions become invalid after either change.

The plaintext password is never stored. The `scrypt` hash and session-signing secret are stored with mode `0600` in the compatibility path:

```text
~/.config/herdr-bridge/auth.json
```

Authenticated sessions have a fixed seven-day maximum lifetime. Every API request requires both an `HttpOnly`, `SameSite=Strict` cookie and a separately signed token stored in the current window's `sessionStorage`. Closing the PWA or tab and opening a new one requires the password again. Reloading or returning from the background in the same window keeps the login. HTTPS connections also use the cookie's `Secure` attribute.

## Usage

### Selecting and restoring a session

Select an agent or pane in the sidebar to show its output. The last selected pane is stored in `localStorage` and restored on reload when it still exists. Browser storage is isolated by origin, so an HTTP LAN URL and a Tailscale HTTPS URL have separate preferences.

Opening a completed `✓` session marks that completion as viewed and changes it to idle `○` in the current browser. A later completion has a new state sequence and displays `✓` again.

### Agent status notifications

Use the bell at the bottom of the sidebar to enable or disable notifications for the current browser or installed PWA. Permission is requested only after pressing this control.

- Titles use `project name · session name`.
- Text last submitted through HerdRabbit is remembered in memory and included in the status-specific message.
- Completion, input required, returned to idle, and unavailable-state transitions use different messages.
- Each state event is sent once, and a newer alert replaces the previous alert for the same session. Opening it restores the targeted session.
- Work started outside HerdRabbit falls back to a generic state message because its request text is unknown.

Background delivery uses standards-based Web Push; a Firebase project and FCM SDK are not required. On iPhone and iPad, install HerdRabbit on the Home Screen and allow notifications on iOS/iPadOS 16.4 or newer.

VAPID keys and per-device Push subscriptions are stored with mode `0600` in:

```text
~/.config/herdr-bridge/push.json
```

Project names, session names, and request text may appear on the lock screen. Enable notifications only on personal devices.

### Projects and sessions

- Use the top `+` action to create a named workspace with a default shell.
- Use a project's `⋯` menu to rename it, add a shell session, or close the project.
- Use a session's `⋯` menu to close that Herdr tab.
- Collapse or expand a project's child sessions with the arrow beside its name.
- Destructive close actions always require confirmation.

Run commands such as `cd`, `codex`, or `claude` inside a created shell. Creation uses Herdr's `--no-focus` option so it does not steal focus from the desktop Herdr client.

### Input

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

### Output and history

Terminal output refreshes every second. Session and state data refreshes every two seconds. Scrolling to the top requests 200 older lines at a time, up to 100,000 requested lines. Content already lost from a terminal alternate screen may not be recoverable.

### Display settings

Use the control at the bottom of the sidebar to switch between light and dark mode. Adjust terminal and composer text size with `Ctrl`/`Cmd` + wheel or trackpad zoom. On mobile, pinch over terminal output with two fingers. The selected size is saved in `localStorage`.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `HERDR_WEB_HOST` | `127.0.0.1` | Listen on `127.0.0.1` or `0.0.0.0` |
| `HERDR_WEB_PORT` | `38787` | Listening port from 1024 through 65535 |
| `HERDR_WEB_ALLOWED_HOSTS` | empty | Additional reverse-proxy or Tailscale hostnames, comma-separated |
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

`127.0.0.1` is the recommended value for local and Tailscale Serve access. Use `0.0.0.0` only when direct LAN access is intentional. Password protection does not make direct public-internet exposure appropriate because authenticated users can write to your Herdr terminal panes.

## systemd user service

The recommended setup is:

```bash
npm run install-service
```

New installations try `38787`, then search `30000–39999` while excluding local listeners and existing Tailscale HTTPS ports. Reinstalling an existing user service preserves its assigned port.

For a manual service installation, review and adapt [`systemd/herdr-web-local.service`](systemd/herdr-web-local.service), then run:

```bash
mkdir -p ~/.config/systemd/user
cp systemd/herdr-web-local.service ~/.config/systemd/user/
systemctl --user edit --full herdr-web-local.service
systemctl --user daemon-reload
systemctl --user enable --now herdr-web-local.service
```

Inspect the service with:

```bash
systemctl --user status herdr-web-local.service
journalctl --user -u herdr-web-local.service -f
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
systemctl --user restart herdr-web-local.service
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

```bash
cd ~/.local/share/herd-rabbit
git pull --ff-only
npm ci --omit=dev
npm run verify
systemctl --user restart herdr-web-local.service
```

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
systemctl --user status herdr-web-local.service
herdr status server
herdr api snapshot
journalctl --user -u herdr-web-local.service -n 100 --no-pager
```

### `Herdr returned invalid JSON`

This means a Herdr command that should return JSON did not do so. Verify `HERDR_BIN` and run `herdr api snapshot` directly.

### Tailscale HTTPS does not open

```bash
tailscale status
tailscale serve status
systemctl --user status herdr-web-local.service
```

Confirm that server and client use the same tailnet, MagicDNS and HTTPS certificates are enabled, and the tailnet ACL permits the client.

### Forgotten password

SSH into the machine as the service's OS user and run `npm run password`. The old password is not required. Replacing or disabling it invalidates existing sessions.

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
- Passwords are stored only as `scrypt` hashes in a mode-`0600` file.
- Protected APIs require both a signed `HttpOnly` cookie and a separate signed current-window token.
- HTTPS cookies use `Secure`; all login cookies use `SameSite=Strict`.
- Changing or disabling the password invalidates existing sessions.
- Herdr commands use shell-free `execFile` argument arrays.
- Session, workspace, tab, pane, label, input length, output row count, and command duration are validated and bounded.
- The browser cannot invent a Herdr persistent session; only recently discovered running sessions are accepted.
- Destructive close APIs require an explicit confirmation value.
- Write APIs require both a per-process CSRF token and a same-origin request.
- Allowed request hosts are restricted, CORS is not enabled, and strict CSP, frame, and MIME-sniffing protections are sent.
- The Service Worker caches only static app-shell files, never API responses or terminal output.
- VAPID private keys and Push subscription URLs are stored in a mode-`0600` file readable only by the owning OS user.
- Browser storage contains UI preferences and the current-window launch token, not terminal history or the password.

## License

[MIT](LICENSE)
