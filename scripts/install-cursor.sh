#!/bin/sh
set -eu

root=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
cursor_home=${CURSOR_HOME:-"$HOME/.cursor"}
skill_source=$root/skills/tri-method
skill_target=$cursor_home/skills/tri-method
agent_source=$root/agents/tri-worker.md
agent_target=$cursor_home/agents/tri-worker.md

resolve() {
  # Resolve symlinks when possible so ~/.tri and Documents/tri compare equal.
  if command -v realpath >/dev/null 2>&1; then
    realpath "$1"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1"
  else
    printf '%s\n' "$1"
  fi
}

same_path() {
  [ "$(resolve "$1")" = "$(resolve "$2")" ]
}

install_link() {
  source_path=$1
  target_path=$2
  mkdir -p "$(dirname "$target_path")"
  if [ -L "$target_path" ] || [ -e "$target_path" ]; then
    if same_path "$target_path" "$source_path"; then
      # Refresh to a direct symlink to this checkout when an equivalent path already works.
      rm -f "$target_path"
    else
      echo "refusing to overwrite existing path: $target_path" >&2
      exit 1
    fi
  fi
  ln -s "$source_path" "$target_path"
}

if [ "${1-}" = "--check" ]; then
  [ -e "$skill_target" ] && same_path "$skill_target" "$skill_source" \
    || { echo "TRI Cursor skill is not installed or differs: $skill_target" >&2; exit 1; }
  [ -e "$agent_target" ] && same_path "$agent_target" "$agent_source" \
    || { echo "TRI Cursor worker is not installed or differs: $agent_target" >&2; exit 1; }
  echo "TRI Cursor skill and worker are current"
  echo "  skill: $skill_target"
  echo "  agent: $agent_target"
  exit 0
fi

[ "$#" -eq 0 ] || { echo "usage: install-cursor.sh [--check]" >&2; exit 2; }

install_link "$skill_source" "$skill_target"
install_link "$agent_source" "$agent_target"

echo "Installed TRI Cursor surfaces:"
echo "  skill: $skill_target"
echo "  agent: $agent_target"
echo "Start a fresh Cursor agent chat so Task discovery exposes subagent_type tri-worker."
