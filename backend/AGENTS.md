# AGENTS.md

Instructions for coding agents (Claude Code, Codex, and others) that work in `backend/`. The
rules for the whole repo are in the root `AGENTS.md`.

## Project

`backend/` is the Go module `github.com/sklyar/tap-translate/backend`. The translation service
does not exist yet (stage 3 in `docs/roadmap.md`). Now the module has the logic that the service
will use and a command that evaluates this logic on real samples.

- `cmd/evaluate/`: runs the translation prompt on the captured samples in `eval/` and writes a
  report. Its requests are paid: run it only with the owner's permission. See `eval/README.md`.
- `internal/translation/`: the translation contract and logic. `DetectionContext` is the
  context that the extension sends. The package also builds the prompt, gives the JSON Schema of
  the model answer, and parses the answer strictly. It has no I/O.
- `internal/llm/`: a client of an OpenAI-compatible chat completions API.
- `lint/rules.go`: custom gocritic ruleguard rules. It is not part of the build.

### Package boundaries

depguard in `.golangci.yml` checks these rules:

- `internal/translation` does not import `internal/llm` or `net/http`. It says what to ask the
  model and how to check the answer, but it does not call the model.
- `internal/llm` does not import `internal/translation`. It knows nothing about translation.
- Only commands (`cmd/*`), and later the wiring of the service, connect the two.

When you add a package, add it to the list above. If the package has a boundary, add a depguard
rule for it.

## Commands

Run the commands in `backend/`. Run `make install-deps` once: it installs the pinned
golangci-lint and nilaway into `bin/`.

| Command          | What it does                                                        |
| ---------------- | ------------------------------------------------------------------- |
| `make build`     | Build `bin/evaluate`.                                               |
| `make fix-style` | Format the code (gofumpt, gci, goimports, golines). Changes files.  |
| `make lint`      | Run golangci-lint with `.golangci.yml`.                             |
| `make nilaway`   | Find possible nil panics.                                           |
| `make test`      | `go test -race ./...`                                               |
| `make check`     | All checks: format, lint, nilaway, tests. CI runs the same checks.  |

Run one test: `go test -race -run '^TestParseResult$' ./internal/translation/`.

## Definition of done

- `make check` passes.
- No new `//nolint`. If one is really needed, it names the linter and gives the reason:
  `//nolint:gosec // G304: the path comes from a flag of the person who runs the command.`
- New behavior has tests. A bug fix has a test that fails without the fix.
- Do not edit `.golangci.yml` or `lint/rules.go` to make a check pass. Fix the code. Change the
  lint config only when the task is about the lint config.

## Code style

The style is the [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md).
golangci-lint enforces most of it. Before you write or review Go code, read
`.claude/skills/go-style/SKILL.md` in the repo root. It lists the rules that linters cannot
check.

Project conventions that are easy to miss:

- **Errors.** Add context that names the operation: `fmt.Errorf("read samples: %w", err)`.
  Never start a message with "failed to", "unable to", "cannot", and similar. Wrap errors from
  std and third-party packages. Return errors from this module as is, unless you add new
  information.
- **Handle an error once.** Log it or return it, not both.
- **Logging.** Use `log/slog` only. Pass `*slog.Logger` through constructors. Put the error in
  `slog.Any("error", err)`. Logs never contain page text.
- **No globals.** Pass dependencies through constructors.
- **Names.** Unexported top-level consts and vars start with `_`: `_maxAnswerTokens`.
  Unexported error vars start with `err`: `errNotFound`.
- **Interfaces.** Add a compile-time check next to each implementation:
  `var _ Provider = (*Client)(nil)`.
- **Imports.** Two groups: standard library, then everything else (this module included).
- **Main.** Only `main()` calls `os.Exit`. All other code returns errors to `run()`.
- **JSON.** Field names are camelCase: this is the contract with the extension, which is
  written in TypeScript. `internal/llm` uses the snake_case names of the OpenAI-compatible API.
  tagliatelle checks both.
- **Language.** Code, comments, logs, and errors are in English. The text for the reader (the
  translation and the explanation) is in Russian and comes from the model.
- **Keys and paid calls.** API keys are read from files. They never go into logs, errors,
  fixtures, command arguments, or the repo. Do not write the host of a provider workspace into
  the repo. Every model request is paid: make one only with the owner's permission.

## Tests

- Tests are in the external package (`package foo_test`) and call `t.Parallel()`. The tests of
  a command stay in `package main`, because a command cannot be imported. A test that uses
  `t.Setenv` cannot be parallel; add a comment that says why.
- Test through the exported API. If a test really needs an unexported detail, export it for
  tests in `export_test.go` (`package foo`).
- Each test has three parts, in this order: arrange, act, assert. Separate them with an empty
  line.
- Use `t.Context()`, not `context.Background()`.
- Use testify: `require` when the test cannot continue, `assert` otherwise. In the handler of a
  test HTTP server, use only `assert`: `require` would stop the wrong goroutine.
- Table tests: the slice is `tests`, the loop variable is `tt`, input fields start with `give`,
  expected fields start with `want`.
- Every package with tests has `main_test.go` with `goleak.VerifyTestMain(m)`. Add it when you
  create tests in a new package.
- Tests make no network calls. Use an `httptest` server instead of a real provider.
- Put large inputs and expected outputs into the `testdata/` directory of the package.

## Review

To review Go changes against the style rules, use the `go-reviewer` agent
(`.claude/agents/go-reviewer.md` in the repo root). Other agents can follow the same file as a
checklist.

## Claude Code hooks

`.claude/settings.json` in the repo root runs two hooks for `backend/`:

- After each edit of a `.go` file under `backend/`: `golangci-lint fmt` on that file.
- When Claude stops and `backend/` has uncommitted Go changes: `golangci-lint run` and
  `go test -race`. If they fail, Claude gets the errors and must fix them.
