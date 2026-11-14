#!/usr/bin/env bash
# Rebuild both contracts with cargo-near (optimized wasm), run unit + sandbox tests,
# and print sha256 of the artifacts. Run from Linux/WSL: bash contracts/build-and-test.sh
set -euo pipefail
cd "$(dirname "$0")"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/skypay-target}"
OUT="${OUT:-$HOME/skypay-out}"
echo "== toolchain"; cargo --version; cargo near --version
for c in vault test-ft; do
  (cd "$c" && cargo near build non-reproducible-wasm --no-abi --out-dir "$OUT" 2>&1 | grep -E 'Binary|Size|checksum hex')
done
mkdir -p target/wasm32-unknown-unknown/release
cp "$OUT"/*.wasm target/wasm32-unknown-unknown/release/
echo "== unit tests"; cargo test -p skypay-vault --lib 2>&1 | grep -E '^test |test result'
echo "== sandbox test"; cargo test -p skypay-vault --test sandbox 2>&1 | grep -E '^test |test result|panicked|Error'
echo "== sha256"; (cd "$OUT" && sha256sum *.wasm)
