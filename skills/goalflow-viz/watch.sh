#!/usr/bin/env bash

# Keep this watcher resilient: transient regen/watch errors should not stop the loop.

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd)"
ROOT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/../.." 2>/dev/null && pwd)"

if [ -z "$ROOT_DIR" ]; then
  echo "could not locate goalflow root" >&2
  exit 1
fi

cd "$ROOT_DIR" || exit 1

derive_slug() {
  local input="$1"
  local normalized
  local slug

  normalized="${input//\\//}"
  slug="${normalized##*/}"

  case "$slug" in
    *.tasks.json)
      slug="${slug%.tasks.json}"
      ;;
    *.md)
      slug="${slug%.md}"
      ;;
  esac

  if [ -z "$slug" ]; then
    echo "could not derive slug from: $input" >&2
    exit 1
  fi

  printf '%s\n' "$slug"
}

if [ -z "${1:-}" ]; then
  echo "Usage: skills/goalflow-viz/watch.sh <slug>" >&2
  exit 1
fi

SLUG="$(derive_slug "$1")"
OUT=".goalflow/viz/${SLUG}.html"

mkdir -p "$(dirname "$OUT")"

stop_watch() {
  echo "stopped"
  exit 0
}

trap stop_watch INT TERM

inject_meta_refresh() {
  [ -f "$OUT" ] || return 0

  if grep -Eqi "http-equiv[[:space:]]*=[[:space:]]*['\"]?refresh" "$OUT" 2>/dev/null; then
    return 0
  fi

  # meta-refresh による2秒間隔リロード=v1 の軽量リロード。zoom/pan はリロードでリセットされる(v1 既知の割り切り)。event-driven な無リロード更新は将来 ramp。
  sed -i '' '/<[Hh][Ee][Aa][Dd][[:space:]>]/a\
<meta http-equiv="refresh" content="2">
' "$OUT" 2>/dev/null || true
}

regen() {
  node skills/goalflow-viz/fuse.mjs "$SLUG" --out "$OUT" || true
  inject_meta_refresh || true
}

mtime_listing() {
  local dir="$1"

  [ -d "$dir" ] || return 0

  find "$dir" -type f -print 2>/dev/null | while IFS= read -r file; do
    stat -f '%m %N' "$file" 2>/dev/null || stat -c '%Y %n' "$file" 2>/dev/null || printf '%s\n' "$file"
  done
}

signature() {
  {
    mtime_listing ".codex-out"
    mtime_listing "projects/-Users-ooizumiyou--claude"
    git rev-parse HEAD 2>/dev/null || true
  } | sort | cksum | awk '{print $1 ":" $2}'
}

poll_watch() {
  local previous
  local current

  previous="$(signature)"

  while true; do
    sleep 2
    current="$(signature)"
    if [ "$current" != "$previous" ]; then
      previous="$current"
      regen
    fi
  done
}

fswatch_paths() {
  local path

  for path in ".codex-out" "projects/-Users-ooizumiyou--claude" ".git"; do
    [ -e "$path" ] && printf '%s\n' "$path"
  done
}

run_fswatch() {
  local paths=()
  local path

  while IFS= read -r path; do
    paths+=("$path")
  done < <(fswatch_paths)

  [ "${#paths[@]}" -gt 0 ] || return 1

  fswatch -o "${paths[@]}" 2>/dev/null | while read -r _; do
    regen
  done
}

regen
open "$OUT" 2>/dev/null || true
echo "watching $SLUG ... (Ctrl-C で停止)"
echo "$OUT"

if command -v fswatch >/dev/null 2>&1; then
  run_fswatch
fi

poll_watch
