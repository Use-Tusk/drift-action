#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   sh scripts/release.sh [patch|minor|major]
# Default bump type: patch

BUMP_TYPE="${1:-patch}"
DEFAULT_BRANCH="main"
GIT_REMOTE="origin"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[1;34m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

validate_bump_type() {
  case "$BUMP_TYPE" in
    patch|minor|major) ;;
    *) error "Invalid bump type: $BUMP_TYPE. Use patch, minor, or major." ;;
  esac
}

require_clean_worktree() {
  if ! git diff --quiet || ! git diff --staged --quiet; then
    error "Working directory has uncommitted changes. Commit or stash them first."
  fi
}

latest_semver_tag() {
  git tag --list 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | head -n 1
}

validate_semver_tag() {
  local tag="$1"
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

compute_suggested_tag() {
  local last_tag="$1"
  if [[ -z "$last_tag" ]]; then
    echo "v0.1.0"
    return
  fi

  local version="${last_tag#v}"
  local major minor patch
  IFS='.' read -r major minor patch <<< "$version"
  [[ -n "${major:-}" && -n "${minor:-}" && -n "${patch:-}" ]] || error "Unable to parse last tag: $last_tag"

  case "$BUMP_TYPE" in
    patch) patch=$((patch + 1)) ;;
    minor) minor=$((minor + 1)); patch=0 ;;
    major) major=$((major + 1)); minor=0; patch=0 ;;
  esac

  echo "v${major}.${minor}.${patch}"
}

confirm_yes_default() {
  local prompt="$1"
  read -r -p "$prompt [Y/n] " reply
  [[ -z "$reply" || "$reply" =~ ^[Yy]$ ]]
}

if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  error "Not in a git repository."
fi

validate_bump_type
require_clean_worktree

current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "$DEFAULT_BRANCH" ]]; then
  error "Not on ${DEFAULT_BRANCH}. Current branch: ${current_branch}."
fi

info "Fetching latest tags from ${GIT_REMOTE}/${DEFAULT_BRANCH}..."
git fetch "$GIT_REMOTE" "$DEFAULT_BRANCH" --tags

local_commit="$(git rev-parse HEAD)"
remote_commit="$(git rev-parse "${GIT_REMOTE}/${DEFAULT_BRANCH}")"
if [[ "$local_commit" != "$remote_commit" ]]; then
  error "Local ${DEFAULT_BRANCH} is not up to date with ${GIT_REMOTE}/${DEFAULT_BRANCH}. Run git pull first."
fi

last_tag="$(latest_semver_tag)"
if [[ -z "$last_tag" ]]; then
  warn "No previous semver tag found."
else
  info "Latest release tag: ${BLUE}${last_tag}${NC}"
fi

suggested_tag="$(compute_suggested_tag "$last_tag")"
info "Suggested ${BUMP_TYPE} release: ${BLUE}${suggested_tag}${NC}"

new_tag="$suggested_tag"
if ! confirm_yes_default "Use suggested tag ${suggested_tag}?"; then
  read -r -p "Enter a new release tag (vX.X.X): " new_tag
fi

if ! validate_semver_tag "$new_tag"; then
  error "Invalid tag format: ${new_tag}. Must be vX.X.X."
fi

if git rev-parse -q --verify "refs/tags/${new_tag}" >/dev/null; then
  error "Tag ${new_tag} already exists."
fi

new_major_tag="$(expr "$new_tag" : '\(v[0-9]*\)')"
[[ -n "$new_major_tag" ]] || error "Failed to parse major tag from ${new_tag}."

if [[ -z "$last_tag" ]]; then
  is_major_release="yes"
else
  latest_major_tag="$(expr "$last_tag" : '\(v[0-9]*\)')"
  if [[ "$new_major_tag" != "$latest_major_tag" ]]; then
    is_major_release="yes"
  else
    is_major_release="no"
  fi
fi

echo
info "Releasing ${BLUE}${new_tag}${NC}"

# Exact release tag
git tag -a "$new_tag" -m "$new_tag Release"
info "Created tag ${BLUE}${new_tag}${NC}"

# Major tag behavior for GitHub Action consumers
if [[ "$is_major_release" == "yes" ]]; then
  git tag -a "$new_major_tag" -m "$new_major_tag Release"
  info "Created new major tag ${BLUE}${new_major_tag}${NC}"
else
  git tag "$latest_major_tag" --force --annotate --message "Sync ${latest_major_tag} tag with ${new_tag}"
  info "Synced major tag ${BLUE}${latest_major_tag}${NC} -> ${BLUE}${new_tag}${NC}"
fi

git push --follow-tags

if [[ "$is_major_release" == "no" ]]; then
  git push "$GIT_REMOTE" "${latest_major_tag}" --force
  info "Pushed ${BLUE}${latest_major_tag}${NC} and ${BLUE}${new_tag}${NC}"
else
  info "Pushed ${BLUE}${new_major_tag}${NC} and ${BLUE}${new_tag}${NC}"
fi

if [[ "$is_major_release" == "yes" ]]; then
  release_branch="releases/${new_major_tag}"
  if git rev-parse -q --verify "refs/heads/${release_branch}" >/dev/null; then
    warn "Branch ${release_branch} already exists locally; reusing it."
  else
    git branch "$release_branch" "$new_major_tag"
    info "Created branch ${BLUE}${release_branch}${NC} from ${BLUE}${new_major_tag}${NC}"
  fi
  git push --set-upstream "$GIT_REMOTE" "$release_branch"
  info "Pushed branch ${BLUE}${release_branch}${NC}"
fi

info "Done."
