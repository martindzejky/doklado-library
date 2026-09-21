#!/bin/sh
set -eu

# Cloud dev install script. Runs when an agent runs in the cloud.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENTFILES="${HOME}/.agentfiles"
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

# set up nvm so agentfiles install can run node
. "$NVM_DIR/nvm.sh"

# pull latest agentfiles
if [ ! -d "$AGENTFILES/.git" ]; then
  echo "agentfiles not found at $AGENTFILES" >&2
  exit 1
fi

git -C "$AGENTFILES" fetch origin master
git -C "$AGENTFILES" checkout -B master origin/master
git -C "$AGENTFILES" submodule update --init --recursive

HOME="$HOME" "$AGENTFILES/install"

# install dependencies
cd "$ROOT"
nvm install
corepack enable
corepack prepare --activate
pnpm install --frozen-lockfile
