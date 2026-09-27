#!/bin/sh
set -e

# ANSI colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info() {
    printf "${BLUE}==>${NC} $1\n"
}

success() {
    printf "${GREEN}==>${NC} $1\n"
}

error() {
    printf "${RED}Error:${NC} $1\n"
    exit 1
}

# Install uv (it brings Python and pywire into each new project) if missing
FRESH_UV=
if ! command -v uv >/dev/null 2>&1; then
    info "uv is not installed. Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh

    # Pick up uv in this shell (standard uv install locations)
    if [ -f "$HOME/.local/bin/env" ]; then
        . "$HOME/.local/bin/env"
    elif [ -f "$HOME/.cargo/env" ]; then
        . "$HOME/.cargo/env"
    fi
    export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

    if ! command -v uv >/dev/null 2>&1; then
        error "Failed to install uv or add it to PATH. Please install uv manually: https://docs.astral.sh/uv/getting-started/installation/"
    fi
    success "uv installed successfully"
    FRESH_UV=1
else
    info "uv is already installed"
fi

# Run create-pywire-app: it scaffolds the project and installs pywire into it.
# @latest skips uv's cached copy of the scaffolder.
info "Running create-pywire-app..."
status=0
# `curl | sh` feeds this script on stdin, so reattach the terminal for
# create-pywire-app's prompts, but only if there is one (CI, containers and
# agents have no /dev/tty).
if [ -t 0 ]; then
    uvx create-pywire-app@latest "$@" || status=$?
elif (exec < /dev/tty) 2>/dev/null; then
    uvx create-pywire-app@latest "$@" < /dev/tty || status=$?
else
    uvx create-pywire-app@latest "$@" || status=$?
fi

if [ -n "$FRESH_UV" ]; then
    info "uv was just installed: restart your shell (or run: . \"\$HOME/.local/bin/env\") so uv is on your PATH."
fi
exit "$status"
