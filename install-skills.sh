#!/usr/bin/env bash
# install-skills.sh
# Installs skills from this repo into ~/.agents/skills/ via symlinks.
# Each skill directory is symlinked, so edits in ~/.agents/skills/<name>
# are immediately reflected in the repo and vice versa.
#
# Usage:
#   ./install-skills.sh          # install all skills
#   ./install-skills.sh dry-run  # preview without making changes

set -euo pipefail

REPO_SKILLS="$(cd "$(dirname "$0")/skills" && pwd)"
INSTALL_DIR="$HOME/.agents/skills"
DRY_RUN="${1:-}"

mkdir -p "$INSTALL_DIR"

echo "Installing skills from: $REPO_SKILLS"
echo "Into: $INSTALL_DIR"
[ "$DRY_RUN" = "dry-run" ] && echo "(dry run — no changes will be made)"
echo ""

installed=0
skipped=0
replaced=0

for skill_dir in "$REPO_SKILLS"/*/; do
  name=$(basename "$skill_dir")
  target="$INSTALL_DIR/$name"

  if [ -L "$target" ]; then
    current=$(readlink "$target")
    if [ "$current" = "$skill_dir" ]; then
      echo "  ✓ $name (already linked)"
      ((skipped++)) || true
      continue
    else
      echo "  ↺ $name (relinking: $current → $skill_dir)"
      if [ "$DRY_RUN" != "dry-run" ]; then
        rm "$target"
        ln -s "$skill_dir" "$target"
      fi
      ((replaced++)) || true
    fi
  elif [ -d "$target" ]; then
    echo "  ↺ $name (replacing directory with symlink)"
    if [ "$DRY_RUN" != "dry-run" ]; then
      rm -rf "$target"
      ln -s "$skill_dir" "$target"
    fi
    ((replaced++)) || true
  else
    echo "  + $name (new)"
    if [ "$DRY_RUN" != "dry-run" ]; then
      ln -s "$skill_dir" "$target"
    fi
    ((installed++)) || true
  fi
done

echo ""
echo "Done: $installed new, $replaced relinked, $skipped already up to date"
