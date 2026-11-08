#!/usr/bin/env bash
# PostToolUse hook: formats a Go file of the backend module (backend/) after Claude edits it.
# Reads the hook input JSON from stdin.
set -euo pipefail

file=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty')
[[ "$file" == *.go && -f "$file" ]] || exit 0

backend="${CLAUDE_PROJECT_DIR:-.}/backend"
[[ "$(cd "$(dirname "$file")" && pwd)/" == "$(cd "$backend" && pwd)/"* ]] || exit 0
cd "$backend"

lint=bin/golangci-lint
[[ -x "$lint" ]] || lint=golangci-lint

"$lint" fmt "$file"
