#!/usr/bin/env bash
# Stop hook: runs lint and tests when the backend module (backend/) has uncommitted Go changes.
# On failure it blocks the stop (exit code 2), so Claude sees the errors and fixes them.
# It blocks only once in a row, so a problem that Claude cannot fix does not cause a loop.
set -uo pipefail

input=$(cat)
cd "${CLAUDE_PROJECT_DIR:-.}/backend" || exit 0

if [[ -z "$(git status --porcelain -- '*.go' go.mod go.sum .golangci.yml 2>/dev/null)" ]]; then
	exit 0
fi

lint=bin/golangci-lint
[[ -x "$lint" ]] || lint=golangci-lint

report() {
	local title=$1 output=$2
	if [[ "$(jq -r '.stop_hook_active // false' <<<"$input")" == "true" ]]; then
		# Claude already had one try. Tell the user and let the stop happen.
		jq -n --arg msg "$title (still failing after one fix attempt)" '{systemMessage: $msg}'
		exit 0
	fi
	printf '%s\n%s\n' "$title" "$(tail -n 60 <<<"$output")" >&2
	exit 2
}

if ! out=$("$lint" run ./... 2>&1); then
	report "golangci-lint found issues. Fix them before you finish:" "$out"
fi

if ! out=$(go test -race ./... 2>&1); then
	report "go test failed. Fix the tests before you finish:" "$out"
fi

exit 0
