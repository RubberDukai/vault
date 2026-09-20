#!/usr/bin/env bash
# Vault - offline knowledge vault. Linux and macOS launcher.
# Make executable once with:  chmod +x vault.sh

cd "$(dirname "$0")" || exit 1

# A copy made with "make-portable --with-node" carries its own Node.js.
if [ -x node/node ]; then
  exec node/node bin/vault.js serve --open "$@"
fi

if ! command -v node >/dev/null 2>&1; then
  cat <<'MESSAGE'

  ------------------------------------------------------------
   Vault needs Node.js, and it is not installed on this machine.
  ------------------------------------------------------------

   Debian / Ubuntu :  sudo apt install nodejs
   Fedora          :  sudo dnf install nodejs
   Arch            :  sudo pacman -S nodejs
   macOS           :  brew install node

   Vault needs version 22.15 or newer. If your distribution ships
   something older, get the current LTS from https://nodejs.org

MESSAGE
  exit 1
fi

exec node bin/vault.js serve --open "$@"
