#!/usr/bin/env bash
# Builds a self-contained release archive for the current machine's architecture:
# the server, the built client, production dependencies and the Node runtime itself.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

case "$(uname -m)" in
  x86_64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

name="homelab_manager-linux-$arch"
out="dist"
stage="$out/stage/homelab_manager"

npm ci
npm run build

rm -rf "$out/stage"
mkdir -p "$stage/runtime"
cp -r server bin packaging package.json package-lock.json install.sh README.md LICENSE "$stage/"
mkdir -p "$stage/client"
cp -r client/dist "$stage/client/dist"
(cd "$stage" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
cp "$(command -v node)" "$stage/runtime/node"

tar -C "$out/stage" -czf "$out/$name.tar.gz" homelab_manager
(cd "$out" && sha256sum "$name.tar.gz" > "$name.tar.gz.sha256")
cp install.sh "$out/install.sh"
rm -rf "$out/stage"

echo "Built $out/$name.tar.gz ($(du -h "$out/$name.tar.gz" | cut -f1))"
