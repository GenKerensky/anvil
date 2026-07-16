#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 2 ]]; then
  printf 'usage: %s SOURCE_DIR INSTALL_DIR\n' "$0" >&2
  exit 2
fi

source_dir=$1
install_dir=${2%/}
expected_install_name="anvil@GenKerensky.github.com"

if [[ ! -d "$source_dir" ]]; then
  printf 'install source is not a directory: %s\n' "$source_dir" >&2
  exit 1
fi

if [[ -z "$install_dir" || "$install_dir" == "/" ]]; then
  printf 'refusing unsafe install destination: %s\n' "$install_dir" >&2
  exit 1
fi

install_parent=$(dirname -- "$install_dir")
install_name=$(basename -- "$install_dir")
if [[ "$install_name" != "$expected_install_name" ]]; then
  printf 'refusing install destination with unexpected basename: %s\n' "$install_dir" >&2
  exit 1
fi
mkdir -p -- "$install_parent"

staging_dir=$(mktemp -d -- "$install_parent/.${install_name}.install.XXXXXX")
backup_dir=""
had_existing=false
cleanup() {
  status=$?
  rm -rf -- "$staging_dir"
  if [[ -n "$backup_dir" && -e "$backup_dir" ]]; then
    if [[ "$had_existing" == true && ! -e "$install_dir" ]]; then
      mv -- "$backup_dir" "$install_dir" || true
    else
      rm -rf -- "$backup_dir"
    fi
  fi
  return "$status"
}
trap cleanup EXIT

# Stage a complete payload before replacing the installed extension. Copying
# directly over install_dir would leave files removed from dist in place.
cp -a -- "$source_dir/." "$staging_dir/"

if [[ -e "$install_dir" ]]; then
  backup_dir=$(mktemp -d -- "$install_parent/.${install_name}.backup.XXXXXX")
  rmdir -- "$backup_dir"
  mv -- "$install_dir" "$backup_dir"
  had_existing=true
fi
mv -- "$staging_dir" "$install_dir"

if [[ -n "$backup_dir" ]]; then
  rm -rf -- "$backup_dir"
  backup_dir=""
fi

trap - EXIT
