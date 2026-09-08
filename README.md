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

## Additional servers over SSH

Local Herdr remains the default. Use **+ → Connect SSH Server** at the top of the sidebar to add remote servers. All registered servers appear together as **server → Herdr session → project → tab/pane**; selecting a pane sends input and reads output on that server. Remote servers need Herdr, but do not need HerdRabbit.

Enter a name and a host or an existing SSH config alias. User and port are optional and inherit the service account's SSH configuration when omitted. Choose **Existing SSH settings**, **Private key** (an absolute key path on the HerdRabbit server), or **Password** under **Authentication**. Under **Advanced**, optionally enter the absolute remote Herdr executable path. The default finds `herdr` on the remote PATH, then tries `$HOME/.local/bin/herdr`. Use **Test connection**, then **Save**. Profiles can be edited or removed; removing one does not stop remote sessions. New project creation includes a server/session selector.

SSH runs as the Linux user running the HerdRabbit service. Existing settings use that user's keys and SSH agent. Password mode supplies the entered password to OpenSSH without placing it in command-line arguments; the remote server must allow SSH password authentication. MFA/keyboard-interactive prompts are not supported, and encrypted keys must already be unlocked in the service's SSH agent. Verify the remote host key with a normal SSH connection as that user first. Unknown or changed keys are rejected. SSH config aliases, including configured jump hosts, can be used; jump hosts need their own working non-interactive authentication. Tailscale is optional for the server-to-server SSH path, provided the remote host is reachable.

SSH passwords are saved in the profile file and restored after updates or service restarts. The file is unencrypted and restricted to its Linux owner (0600); administrators and backup readers can access it. Passwords are excluded from profile API responses. Editing a password connection requires re-entry. Connections from older memory-only versions need to be entered and saved once after upgrading. Use HTTPS (for example, Tailscale Serve) when entering credentials. **Private key** selects an existing server-side file, not a key upload.

Profiles are stored on the HerdRabbit server in `~/.config/herdr-bridge/ssh-profiles.json` with mode `0600` (alongside the configured authentication file); override with `HERDR_WEB_SSH_PROFILES_FILE`. Private-key contents are not stored; SSH passwords are stored in this private file. Profiles are shared by devices using this personal HerdRabbit instance. Protect the instance with its password/passkey login because it can operate the configured remote accounts.

SSH connections are reused for up to 60 idle seconds. Remote snapshots refresh independently, with slower retries on connection failure, so an offline server does not block local data. Last-known remote panes remain visible during outages; their server is marked offline. Remote status subscriptions use a dedicated SSH Unix socket forward, which requires server-side forwarding permission; otherwise HTTP list refreshes provide status updates. Terminal output uses the same server-observed WebSocket delta stream. Notifications include the server name when multiple servers are configured.

Optional integration checks: `node scripts/check-ssh-transport.mjs` uses an isolated loopback SSH server (requires OpenSSH server/client); `node scripts/check-ssh-ui.mjs` checks the profile UI with isolated data (requires Firefox and geckodriver). Neither check changes your real profiles or Herdr sessions.

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

### Output and history

터미널 출력과 이전 기록은 Herdr의 ANSI 화면 및 스크롤백에서만 가져옵니다. Claude JSONL 로그를 조회하거나 화면에 합치지 않습니다. 상단으로 스크롤하면 이전 기록을 200줄씩 추가 요청하며 최대 100,000줄까지 조회합니다. Herdr에 남아 있지 않은 기록은 표시할 수 없습니다. Claude는 설치 시 설정하는 일반 터미널 모드를 사용해야 스크롤백을 조회할 수 있습니다.

Live terminal input (including composer submissions and extra keys) and output use `/api/terminal` WebSocket. After the initial snapshot, only changes are sent. Herdr 0.8.2 has no general screen-change subscription, so the server observes output: 50 ms after each read during activity, 500 ms when quiet, shared by viewers of the same pane and line range. Background pages disconnect and receive a fresh snapshot on return. Session status uses Herdr `pane.agent_status_changed` events over WebSocket, including unselected sessions. Project/session lists still refresh over HTTP every two seconds and resynchronize after the status subscription starts. HTTP list refreshes also cover subscription failures while retrying. Older history, authentication, and project/session management remain HTTP. Push notifications are unchanged.

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

Run as the Linux account that installed the service. The updater uses its own directory, or `HERD_RABBIT_INSTALL_DIR`. It requires a clean `main` branch and the official origin, fetches and fast-forwards `main`, installs dependencies, verifies, and restarts the matching user service. A lock prevents concurrent updates. Local changes, divergent commits, or failed dependency installation/verification stop the process before restart. This is an in-place update: code or dependencies may already have changed on failure; there is no automatic rollback. Ports, authentication, Tailscale settings, and saved SSH connections are preserved. If an older installation lacks `update.sh`, run `git pull --ff-only` once first.

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

SSH into the machine as the service's OS user and run `npm run password`. The old password is not required. Replacing or disabling it invalidates existing sessions and registered Passkeys.

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
- HerdRabbit login passwords are stored only as `scrypt` hashes in a mode-`0600` file. SSH connection passwords are stored separately in the unencrypted, mode-`0600` profile file so they can be reused after restarts.
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
- VAPID private keys and Push subscription URLs are stored in a mode-`0600` file readable only by the owning OS user.
- Browser storage contains UI preferences and the current-window launch token, not terminal history or the password.

## License

[MIT](LICENSE)
