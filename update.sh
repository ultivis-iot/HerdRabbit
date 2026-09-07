#!/bin/sh
set -eu

log() { printf '  > %s\n' "$1"; }
fail() { printf '  x %s\n' "$1" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "requires '$1'"; }

# Parse the entire function before updating this script on disk.
main() {
    [ "$#" -eq 0 ] || fail "Usage: sh update.sh (optional: HERD_RABBIT_INSTALL_DIR=/path)"
    for dependency in git node npm systemctl flock; do need "$dependency"; done
    [ "$(uname -s)" = Linux ] || fail "the service updater supports Linux only"
    [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 22 ] || fail "requires Node.js 22 or newer"

    if [ -n "${HERD_RABBIT_INSTALL_DIR:-}" ]; then
        UPDATE_DIRECTORY="$HERD_RABBIT_INSTALL_DIR"
    elif [ -f "$0" ]; then
        UPDATE_DIRECTORY="$(dirname -- "$0")"
    else
        UPDATE_DIRECTORY="$HOME/.local/share/herd-rabbit"
    fi
    cd "$UPDATE_DIRECTORY" || fail "installation directory does not exist"
    UPDATE_DIRECTORY="$(pwd -P)"
    [ "$(git rev-parse --show-toplevel)" = "$UPDATE_DIRECTORY" ] || fail "run this script from a HerdRabbit repository root"
    case "$(git remote get-url origin)" in
        https://github.com/ultivis-iot/HerdRabbit.git|https://github.com/ultivis-iot/HerdRabbit|git@github.com:ultivis-iot/HerdRabbit.git) ;;
        *) fail "origin is not ultivis-iot/HerdRabbit" ;;
    esac
    UPDATE_LOCK="$(git rev-parse --git-path herdrabbit-update.lock)"
    exec 9>"$UPDATE_LOCK"
    flock -n 9 || fail "another update is running"
    [ "$(git branch --show-current)" = main ] || fail "updates require the main branch"
    [ -z "$(git status --porcelain)" ] || fail "local changes found; commit or move them before updating"

    UPDATE_SERVICE=herdr-web-local.service
    [ "$(systemctl --user show "$UPDATE_SERVICE" --property=LoadState --value)" = loaded ] || fail "service not installed for this user; run the installer first"
    SERVICE_DIRECTORY="$(systemctl --user show "$UPDATE_SERVICE" --property=WorkingDirectory --value)"
    [ -n "$SERVICE_DIRECTORY" ] || fail "could not determine the service installation directory"
    SERVICE_DIRECTORY="$(cd "$SERVICE_DIRECTORY" && pwd -P)"
    [ "$SERVICE_DIRECTORY" = "$UPDATE_DIRECTORY" ] || fail "service uses a different installation directory: $SERVICE_DIRECTORY"

    log "Fetching main in $UPDATE_DIRECTORY"
    git fetch origin main
    git merge-base --is-ancestor HEAD FETCH_HEAD || fail "local main has unpublished or divergent commits; reconcile it manually"
    git merge --ff-only FETCH_HEAD
    log "Installing runtime dependencies"
    npm ci --omit=dev
    log "Verifying the updated code"
    npm run verify
    log "Restarting $UPDATE_SERVICE"
    systemctl --user restart "$UPDATE_SERVICE"
    systemctl --user is-active --quiet "$UPDATE_SERVICE" || fail "service is not active; check journalctl --user -u $UPDATE_SERVICE"
    log "Updated to $(git rev-parse --short HEAD). Refresh the web app or PWA."
    log "Existing service settings and saved SSH connections are preserved."
}

main "$@"
