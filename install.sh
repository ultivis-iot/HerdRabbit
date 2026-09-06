#!/bin/sh
set -eu

REPOSITORY_URL="https://github.com/ultivis-iot/HerdRabbit.git"
INSTALL_DIRECTORY="${HERD_RABBIT_INSTALL_DIR:-$HOME/.local/share/herd-rabbit}"

log() {
    printf '  > %s\n' "$1"
}

fail() {
    printf '  x %s\n' "$1" >&2
    exit 1
}

need() {
    command -v "$1" >/dev/null 2>&1 || fail "requires '$1'"
}

need git
need node
need npm

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 22 ]; then
    fail "requires Node.js 22 or newer (found $(node --version))"
fi

case "$(uname -s)" in
    Linux) ;;
    *) fail "the automatic service installer currently supports Linux only" ;;
esac

if [ -e "$INSTALL_DIRECTORY" ]; then
    [ -d "$INSTALL_DIRECTORY/.git" ] || \
        fail "$INSTALL_DIRECTORY already exists and is not a Git repository"
    ORIGIN_URL="$(git -C "$INSTALL_DIRECTORY" remote get-url origin 2>/dev/null || true)"
    case "$ORIGIN_URL" in
        "$REPOSITORY_URL"|"https://github.com/ultivis-iot/HerdRabbit") ;;
        *) fail "$INSTALL_DIRECTORY does not point to $REPOSITORY_URL" ;;
    esac
    [ "$(git -C "$INSTALL_DIRECTORY" branch --show-current)" = "main" ] || \
        fail "$INSTALL_DIRECTORY is not on the main branch"
    [ -z "$(git -C "$INSTALL_DIRECTORY" status --porcelain)" ] || \
        fail "$INSTALL_DIRECTORY has local changes; update it manually"
    log "Updating HerdRabbit in $INSTALL_DIRECTORY"
    git -C "$INSTALL_DIRECTORY" pull --ff-only origin main
else
    log "Installing HerdRabbit in $INSTALL_DIRECTORY"
    mkdir -p "$(dirname "$INSTALL_DIRECTORY")"
    git clone --depth 1 "$REPOSITORY_URL" "$INSTALL_DIRECTORY"
fi

log "Installing runtime dependencies"
npm --prefix "$INSTALL_DIRECTORY" ci --omit=dev

[ -r /dev/tty ] || fail "an interactive terminal is required for setup"
log "Starting service setup"
node "$INSTALL_DIRECTORY/scripts/install-service.mjs" </dev/tty
