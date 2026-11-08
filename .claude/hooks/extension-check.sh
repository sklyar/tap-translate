#!/usr/bin/env bash
# Stop hook: runs the format check, lint, typecheck, and tests when the extension (extension/)
# has uncommitted changes. On failure it blocks the stop (exit code 2), so Claude sees the errors
# and fixes them. It blocks only once in a row, so a problem that Claude cannot fix does not
# cause a loop.
set -uo pipefail

input=$(cat)
cd "${CLAUDE_PROJECT_DIR:-.}/extension" || exit 0

if [[ -z "$(git status --porcelain -- . 2>/dev/null)" ]]; then
	exit 0
fi

# The tools come from npm ci. Without them there is nothing to run.
[[ -d node_modules ]] || exit 0

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

if ! out=$(npm run --silent format:check 2>&1); then
	report "Prettier found unformatted files. Run npm run format in extension/:" "$out"
fi

if ! out=$(npm run --silent lint 2>&1); then
	report "ESLint found issues. Fix them before you finish:" "$out"
fi

if ! out=$(npm run --silent typecheck 2>&1); then
	report "tsc found type errors. Fix them before you finish:" "$out"
fi

if ! out=$(npm run --silent test 2>&1); then
	report "Vitest failed. Fix the tests before you finish:" "$out"
fi

exit 0
