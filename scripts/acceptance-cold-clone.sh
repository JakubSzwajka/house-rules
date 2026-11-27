#!/usr/bin/env bash
set -euo pipefail

step="starting"
tmp_parent="$(mktemp -d "${TMPDIR:-/tmp}/house-rules-acceptance.XXXXXX")"
tmp="$tmp_parent/clone"

cleanup() {
  local status=$?
  if [[ "${KEEP:-0}" == "1" ]]; then
    printf 'KEEP=1; kept acceptance copy at %s\n' "$tmp_parent" >&2
  else
    rm -rf "$tmp_parent"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

fail() {
  printf 'acceptance failed [%s]: %s\n' "$step" "$*" >&2
  exit 1
}

run_step() {
  step="$1"
  shift
  printf '== %s ==\n' "$step"
  "$@" || fail "$* exited non-zero"
}

if [[ $# -gt 0 ]]; then
  source_url="$1"
else
  repo_root="$(git rev-parse --show-toplevel)" || fail "could not find the repository root"
  source_url="file://${repo_root}"
fi
printf 'source: %s\n' "$source_url"

run_step "clone" git clone --quiet --depth 1 "$source_url" "$tmp"
cd "$tmp"
printf 'commit: %s\n' "$(git rev-parse HEAD)"

run_step "pnpm install" pnpm install --frozen-lockfile
if [[ ! -f .git/hooks/pre-commit ]]; then
  step="hook install"
  fail "pnpm install did not install the lefthook pre-commit hook"
fi
run_step "pnpm check" pnpm check
run_step "pnpm test" pnpm test

printf 'cold-clone acceptance passed\n'
