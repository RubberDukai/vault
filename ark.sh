#!/usr/bin/env bash
# Ark - offline knowledge vault. Linux and macOS launcher.
# Make executable once with:  chmod +x ark.sh

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  cat <<'MESSAGE'

  ------------------------------------------------------------
   Ark needs Node.js, and it is not installed on this machine.
  ------------------------------------------------------------

   Debian / Ubuntu :  sudo apt install nodejs
   Fedora          :  sudo dnf install nodejs
   Arch            :  sudo pacman -S nodejs
   macOS           :  brew install node

   Ark needs version 22.15 or newer. If your distribution ships
   something older, get the current LTS from https://nodejs.org

MESSAGE
  exit 1
fi

exec node bin/ark.js serve --open "$@"
