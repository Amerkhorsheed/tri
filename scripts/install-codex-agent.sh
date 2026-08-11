#!/bin/sh
set -eu

source_dir=$(CDPATH= cd "$(dirname "$0")/../agents" && pwd)
target_dir=${CODEX_HOME:-"$HOME/.codex"}/agents
source_file=$source_dir/tri-worker.toml
target_file=$target_dir/tri-worker.toml

if [ "${1-}" = "--check" ]; then
  cmp -s "$source_file" "$target_file" || { echo "TRI Codex worker is not installed or differs: $target_file" >&2; exit 1; }
  echo "TRI Codex worker is current: $target_file"
  exit 0
fi
[ "$#" -eq 0 ] || { echo "usage: install-codex-agent.sh [--check]" >&2; exit 2; }
mkdir -p "$target_dir"
if [ -e "$target_file" ] && ! cmp -s "$source_file" "$target_file"; then
  echo "refusing to overwrite modified worker: $target_file" >&2
  exit 1
fi
cp "$source_file" "$target_file"
echo "Installed TRI Codex worker: $target_file"
echo 'Start a fresh Codex task so native agent discovery exposes agent_type tri_worker.'
