#!/usr/bin/env bash
# Fetch the upstream data sources listed in scripts/sources.lock into .sources/<name>,
# checked out at exactly the pinned commit (sparse, blob-filtered: only the needed files).
set -euo pipefail
cd "$(dirname "$0")/.."
dest=.sources
mkdir -p "$dest"
grep -v '^\s*#' scripts/sources.lock | while read -r name url commit paths; do
  [ -z "${name:-}" ] && continue
  dir="$dest/$name"
  if [ ! -d "$dir/.git" ]; then
    git init -q "$dir"
    git -C "$dir" remote add origin "$url"
  fi
  git -C "$dir" sparse-checkout set --no-cone $(for p in $paths; do printf '/%s ' "$p"; done)
  git -C "$dir" fetch -q --depth 1 --filter=blob:none origin "$commit"
  git -C "$dir" -c advice.detachedHead=false checkout -q "$commit"
  actual=$(git -C "$dir" rev-parse HEAD)
  if [ "$actual" != "$commit" ]; then
    echo "error: $name is at $actual, expected $commit" >&2
    exit 1
  fi
  echo "$name @ ${commit:0:12}"
done
