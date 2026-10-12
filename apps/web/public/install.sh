#!/bin/sh
# Install bo, the BufferOverride CLI (npm: @profullstack/bufferoverride).
#
#   curl -fsSL https://bufferoverride.com/install.sh | sh
#
# Uses bun if present, otherwise npm (Node >= 20). When the global npm prefix
# is not writable it installs into ~/.local instead of asking for sudo.
# Re-running it upgrades to the latest release.
set -eu

PKG="@profullstack/bufferoverride"

say() { printf '%s\n' "$*"; }
die() { printf 'bo install: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

say "Installing bo (the BufferOverride CLI)..."

if have bun; then
  bun add -g "$PKG@latest"
  BIN_DIR="${BUN_INSTALL:-$HOME/.bun}/bin"
elif have npm && have node; then
  node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 20 || (a === 20 && b >= 0) ? 0 : 1)' \
    || die "Node >= 20 required (found $(node -v)). Upgrade Node or install bun: https://bun.sh"
  prefix=$(npm config get prefix)
  modules="$prefix/lib/node_modules"
  [ -d "$modules" ] || modules="$prefix/lib"
  if [ -w "$modules" ] && [ -w "$prefix/bin" ]; then
    npm install -g "$PKG@latest"
    BIN_DIR="$prefix/bin"
  else
    BIN_DIR="$HOME/.local/bin"
    say "npm prefix $prefix is not writable; installing into $HOME/.local"
    npm install -g --prefix "$HOME/.local" "$PKG@latest"
  fi
else
  die "needs bun (https://bun.sh) or Node >= 20 with npm (https://nodejs.org)"
fi

say ""
if have bo; then
  say "bo $(bo --version 2>/dev/null | head -n 1) installed."
else
  say "bo installed to $BIN_DIR, which is not on your PATH. Add it:"
  say "  export PATH=\"$BIN_DIR:\$PATH\""
fi
say ""
say "Next:"
say "  bo login                    # sign this terminal in"
say "  bo run -- npm test          # capture a failure and find the existing answer"
say "  bo --help                   # every command, plus MCP setup"
