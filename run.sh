#!/usr/bin/env bash
# Clean-clone run: install, build, start. The same steps as the README, in one command.
# With no .env (or DATABASE_URL empty) data is kept in memory, so no database is needed.
set -euo pipefail
cd "$(dirname "$0")"

node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 9)) {
    console.error("Node.js 20.9 or newer is required; found " + process.versions.node);
    process.exit(1);
  }
'

npm install
npm run build
npm start
