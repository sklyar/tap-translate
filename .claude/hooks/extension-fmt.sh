#!/usr/bin/env bash
# PostToolUse hook: formats a file of the extension (extension/) with Prettier after Claude
# edits it. Reads the hook input JSON from stdin.
set -euo pipefail

file=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty')
[[ -n "$file" && -f "$file" ]] || exit 0

extension="${CLAUDE_PROJECT_DIR:-.}/extension"
[[ "$(cd "$(dirname "$file")" && pwd)/" == "$(cd "$extension" && pwd)/"* ]] || exit 0
cd "$extension"

# Prettier comes from npm ci. Without it there is nothing to run.
[[ -x node_modules/.bin/prettier ]] || exit 0

# --ignore-unknown skips files that Prettier cannot format. The ignore path is the same as in
# npm run format, so files in dist/ and node_modules/ stay as they are.
node_modules/.bin/prettier --write --ignore-unknown --log-level warn \
	--ignore-path ../.gitignore "$file"
