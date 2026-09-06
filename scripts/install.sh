#!/bin/sh
# Release packaging replaces the marker with an immutable GitHub release URL.
# Keep all work inside main so a truncated download cannot execute a partial body.
main() {
  set -eu
  target=${1:-}
  case "$target" in
    --help|-h|help|'')
      printf '%s\n' 'Lazada setup: codex | claude-code | claude-desktop | grok' 'One command downloads and verifies the package, then runs setup.'
      [ -n "$target" ] && return 0 || return 1 ;;
    codex|claude-code|claude-desktop|grok) ;;
    *) printf '%s\n' "Unknown target: $target" >&2; return 1 ;;
  esac
  if [ "$#" -ne 1 ]; then printf '%s\n' 'Pass exactly one setup target.' >&2; return 1; fi
  release_base=${LAZADA_RELEASE_BASE_URL:-__LAZADA_RELEASE_BASE_URL__}
  case "$release_base" in
    https://*) ;;
    *) printf '%s\n' 'This installer has not been published yet. Use a packaged release installer.' >&2; return 1 ;;
  esac
  system=$(uname -s)
  case "$system" in Darwin|Linux) ;; *) printf '%s\n' 'Lazada currently supports macOS and Linux.' >&2; return 1 ;; esac
  if [ "$target" = claude-desktop ] && [ "$system" != Darwin ]; then
    printf '%s\n' 'The Claude Desktop bundle currently supports macOS only.' >&2; return 1
  fi
  for command in curl mktemp; do
    command -v "$command" >/dev/null 2>&1 || { printf '%s\n' "Setup needs $command on PATH." >&2; return 1; }
  done
  if [ "$target" != claude-desktop ]; then
    command -v node >/dev/null 2>&1 && command -v npx >/dev/null 2>&1 || {
      printf '%s\n' 'Node.js 22+ is required. Ask your assistant to install Node.js LTS, then rerun this command.' >&2; return 1;
    }
    node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' || {
      printf '%s\n' 'Update to Node.js 22+ and rerun this command.' >&2; return 1;
    }
  fi
  if command -v shasum >/dev/null 2>&1; then hash_command=shasum
  elif command -v sha256sum >/dev/null 2>&1; then hash_command=sha256sum
  else printf '%s\n' 'Setup needs shasum or sha256sum to verify the download.' >&2; return 1
  fi
  stage=$(mktemp -d "${TMPDIR:-/tmp}/lazada-install.XXXXXX")
  trap 'rm -rf "$stage"' 0
  trap 'exit 130' INT
  trap 'exit 143' TERM
  asset=lazada-mcp.tgz
  [ "$target" != claude-desktop ] || asset=lazada-mcp.mcpb
  printf '%s\n' "Downloading Lazada for ${target}..."
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 20 --max-time 180 "$release_base/$asset" -o "$stage/$asset"
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 20 --max-time 60 "$release_base/SHA256SUMS" -o "$stage/SHA256SUMS"
  expected=$(awk -v file="$asset" '$2 == file { print $1 }' "$stage/SHA256SUMS")
  [ "${#expected}" -eq 64 ] || { printf '%s\n' 'Release checksum is missing or malformed. Nothing was installed.' >&2; return 1; }
  case "$expected" in *[!0-9a-fA-F]*) printf '%s\n' 'Invalid release checksum. Nothing was installed.' >&2; return 1 ;; esac
  if [ "$hash_command" = shasum ]; then actual=$(shasum -a 256 "$stage/$asset" | awk '{print $1}')
  else actual=$(sha256sum "$stage/$asset" | awk '{print $1}'); fi
  [ "$actual" = "$expected" ] || { printf '%s\n' 'Download checksum mismatch. Nothing was installed. Try again later.' >&2; return 1; }
  if [ "$target" = claude-desktop ]; then
    # Keep the verified bundle while Claude's asynchronous installation dialog is open.
    bundle_dir=${XDG_CACHE_HOME:-"$HOME/.cache"}/lazada-mcp/installers
    mkdir -p "$bundle_dir"
    bundle="$bundle_dir/lazada-mcp-$actual.mcpb"
    cp "$stage/$asset" "$bundle"
    open "$bundle"
    printf '%s\n' 'Review the Lazada installation dialog in Claude. Then start a new chat and say "Connect Lazada".'
  else
    case "$target" in claude-code) client=claude ;; grok) client=config ;; *) client=$target ;; esac
    npx --yes "$stage/$asset" setup "$client"
    if [ "$target" = grok ]; then
      printf '%s\n' 'Grok: register the printed MCP configuration on this shared computer using its existing host-browser settings. Follow SETUP.md in the installed package. Do not copy login cookies or guess a debugging port.' >&2
    fi
  fi
}
main "$@"
