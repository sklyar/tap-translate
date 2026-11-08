---
name: go-style
description: Use when you write, edit, or review Go code in this repo. It lists the Uber Go Style Guide rules that golangci-lint cannot check, so you must apply them with judgment.
---

# Go style: rules that need judgment

This repo follows the [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md).
golangci-lint checks many of its rules (see [Checked by linters](#checked-by-linters)).
This file lists the rules that a linter cannot check. Apply them to all new and changed code.
Each heading links to its section in the guide. When a rule allows a choice, follow the code
around the change ([Be Consistent](https://github.com/uber-go/guide/blob/master/style.md#be-consistent)).

## Interfaces, receivers, mutexes

### [Verify interface compliance](https://github.com/uber-go/guide/blob/master/style.md#verify-interface-compliance)

If a type must implement an interface, check this at compile time. Put the check right after the
type: `var _ http.Handler = (*Handler)(nil)`. For value receivers: `var _ http.Handler = LogHandler{}`.
Do this for exported types with an API contract and for types in a set of implementations.

### [No pointers to interfaces](https://github.com/uber-go/guide/blob/master/style.md#pointers-to-interfaces)

Pass interfaces as values: `r io.Reader`, not `r *io.Reader`. The data inside the interface can
still be a pointer.

### [Receivers and interfaces](https://github.com/uber-go/guide/blob/master/style.md#receivers-and-interfaces)

You can call a value-receiver method on a value or a pointer. You can call a pointer-receiver
method only on a pointer or an addressable value. So if one method has a pointer receiver, only
`*T` implements the interface. Map values are not addressable: store `*T` in the map if you need
pointer methods.

### [Use zero-value mutexes](https://github.com/uber-go/guide/blob/master/style.md#zero-value-mutexes-are-valid)

The zero value of `sync.Mutex` and `sync.RWMutex` is ready to use. Write `var mu sync.Mutex`, not
`new(sync.Mutex)`. In a struct, use a named field `mu sync.Mutex`, not `*sync.Mutex`, and use the
struct by pointer.

## Ownership and cleanup

### [Copy slices and maps at boundaries](https://github.com/uber-go/guide/blob/master/style.md#copy-slices-and-maps-at-boundaries)

Slices and maps share their data. Copy a slice or map that you receive and store. Copy internal
state before you return it. Otherwise the caller can change your data, or read it without the lock.

```go
// Bad
func (d *Driver) SetTrips(trips []Trip) { d.trips = trips }

// Good
func (d *Driver) SetTrips(trips []Trip) { d.trips = slices.Clone(trips) }

func (s *Stats) Snapshot() map[string]int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return maps.Clone(s.counters) // not s.counters: the caller would read it without the lock
}
```

### [Defer to clean up](https://github.com/uber-go/guide/blob/master/style.md#defer-to-clean-up)

Use `defer` to release locks, files, tickers, and response bodies. Put the `defer` right after you
get the resource. Then every return path releases it. The cost of `defer` is very small.

## Types and values

### [Start enums at one](https://github.com/uber-go/guide/blob/master/style.md#start-enums-at-one)

Start `iota` enums at one (`Add Operation = iota + 1`), so the zero value means "not set".
Start at zero only when zero is the correct default value, for example `LogToStdout`.

### [Use time.Time and time.Duration](https://github.com/uber-go/guide/blob/master/style.md#use-time-to-handle-time)

Use `time.Time` for instants and `time.Duration` for periods. Do not use `int` seconds or
milliseconds. Compare instants with `Before`, `After`, and `Equal`. For the next calendar day, use
`t.AddDate(0, 0, 1)`. For exactly 24 hours later, use `t.Add(24 * time.Hour)`.

Use these types with external systems too
([guide](https://github.com/uber-go/guide/blob/master/style.md#use-timetime-and-timeduration-with-external-systems)).
Parse env vars and flags with `time.ParseDuration` (`"5s"`). JSON and YAML encode `time.Time` as
an RFC 3339 string. `gopkg.in/yaml.v3` also supports `time.Duration`. If the format cannot hold a
`time.Duration` (for example, JSON), use `int` or `float64` and put the unit in the name. If it
cannot hold a `time.Time`, use an RFC 3339 `string`. Bad: `func poll(delay int)` (seconds or
milliseconds?). Good: `func poll(delay time.Duration)`, and `IntervalMillis int` with the tag
`json:"interval_millis"` in a JSON struct.

## Errors

### [Choose the error type](https://github.com/uber-go/guide/blob/master/style.md#error-types)

Ask two questions. Does the caller need to match the error? Is the message static or dynamic?

| Caller matches it? | Message | Use                                           |
|--------------------|---------|-----------------------------------------------|
| No                 | static  | `errors.New("...")`                           |
| No                 | dynamic | `fmt.Errorf("...", args)`                     |
| Yes                | static  | top-level `var ErrX = errors.New("...")`      |
| Yes                | dynamic | custom type `XError` with an `Error()` method |

Exported error variables and types are part of the package API. Export them only when callers
must match them. Otherwise use `errX` and `xError`.

### [Wrap errors with useful context](https://github.com/uber-go/guide/blob/master/style.md#error-wrapping)

- Return the error as is when you have no context to add. Otherwise add context with `fmt.Errorf`.
- Use `%w` when callers may need `errors.Is` or `errors.As` (the default). Use `%v` to hide the cause.
- If you wrap a known sentinel or error type with `%w`, it is part of the contract. Document it
  and test it.
- Keep the context short. Name the operation. Do not write "failed to", "unable to", or "error".
- Do not repeat what the inner error already says. For example, `os.Open` errors contain the path.
- wrapcheck skips errors from this module. Wrap them only when you add new information.

```go
// Bad: the result is "failed to x: failed to create new store: <cause>"
return fmt.Errorf("failed to create new store: %w", err)

// Good: the result is "x: new store: <cause>"
return fmt.Errorf("new store: %w", err)
```

### [Handle errors once](https://github.com/uber-go/guide/blob/master/style.md#handle-errors-once)

Handle each error one time. Do not log an error and then return it: the caller will log it again.
You can return it (wrapped or as is), or match it and handle each case. You can also log it and
continue in a degraded mode when the work is optional, for example when you emit metrics.
Log errors under the `"error"` key.

```go
// Bad
if err != nil {
	logger.Error("get user", slog.Any("error", err))
	return err
}

// Good: handle the known case, return the others
tz, err := userTimeZone(id)
switch {
case errors.Is(err, ErrUserNotFound):
	tz = time.UTC
case err != nil:
	return fmt.Errorf("user time zone %q: %w", id, err)
}
```

## Program structure

### [Don't panic](https://github.com/uber-go/guide/blob/master/style.md#dont-panic)

Return an error and let the caller decide. Panic only when the program cannot continue, such as a
nil dereference. A `Must` helper at program start is OK, for example `template.Must` in `main`.
In tests, use `t.Fatal` or `require`, not `panic`.

### [Avoid mutable globals](https://github.com/uber-go/guide/blob/master/style.md#avoid-mutable-globals)

Do not change package-level state at run time. This includes function variables such as
`var _timeNow = time.Now`. Pass dependencies (clock, logger, clients) to the constructor and keep
them in struct fields: `type signer struct{ now func() time.Time }`. Tests then set the field.
Pass a `*slog.Logger`; do not use `slog.Default()`.

### [Avoid embedding types in public structs](https://github.com/uber-go/guide/blob/master/style.md#avoid-embedding-types-in-public-structs)

Embedding adds the inner type's methods and fields to your API. Later you cannot remove or replace
the inner type without a breaking change. Use a named field and write the delegate methods you
need. Embed only if every exported method and field of the inner type belongs on the outer type,
and the zero value and copy behavior of the outer type stay correct
([Embedding in Structs](https://github.com/uber-go/guide/blob/master/style.md#embedding-in-structs)).

```go
// Bad
type ConcreteList struct{ *AbstractList }

// Good
type ConcreteList struct{ list *AbstractList }

func (l *ConcreteList) Add(e Entity) { l.list.Add(e) }
```

### [Exit in main, exit once](https://github.com/uber-go/guide/blob/master/style.md#exit-in-main)

Only `main` calls `os.Exit` or `log.Fatal`, and only once
([Exit Once](https://github.com/uber-go/guide/blob/master/style.md#exit-once)). `main` calls
`run() error`. All other functions return errors. An exit skips deferred calls and stops the test
binary. If the program needs specific exit codes, `run` may return an exit code.

```go
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
```

### [Stop and wait for every goroutine](https://github.com/uber-go/guide/blob/master/style.md#dont-fire-and-forget-goroutines)

Every goroutine needs a stop signal (a closed channel or a canceled context) or a known end.
The caller also needs a way to wait until it exits: a `done` channel, or `wg.Go(fn)` and
`wg.Wait()` for many goroutines
([Wait](https://github.com/uber-go/guide/blob/master/style.md#wait-for-goroutines-to-exit)).
If a type starts a goroutine, it has a `Stop`, `Close`, or `Shutdown` method that signals and
waits. Do not start goroutines in `init()`
([No goroutines in init](https://github.com/uber-go/guide/blob/master/style.md#no-goroutines-in-init)).
Bad: `go func() { for { flush(); time.Sleep(delay) } }()`. Nothing can stop it.

```go
func (f *Flusher) loop(delay time.Duration) {
	defer close(f.done) // tells Stop that the goroutine exited
	ticker := time.NewTicker(delay)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			f.flush()
		case <-f.stop:
			return
		}
	}
}

func (f *Flusher) Stop() {
	close(f.stop) // signal the goroutine to stop
	<-f.done      // wait until it exits
}
```

Each package calls `goleak.VerifyTestMain(m)` (`go.uber.org/goleak`) in its `TestMain`. If a
goroutine still runs after the tests, the package fails. So each test must stop the goroutines
it starts, for example with `t.Cleanup(f.Stop)`.

## Names and declarations

### [Prefix unexported globals with _](https://github.com/uber-go/guide/blob/master/style.md#prefix-unexported-globals-with-_)

The team adopted this rule. Prefix unexported top-level `var` and `const` names with `_`, for
example `_defaultPort`. A reader then sees that the name is global, and a local variable cannot
hide it by mistake. Exception: unexported error variables use the `err` prefix (`errNotFound`,
see [Error Naming](https://github.com/uber-go/guide/blob/master/style.md#error-naming)).
Exported names and local names get no prefix.

### [Group similar declarations](https://github.com/uber-go/guide/blob/master/style.md#group-similar-declarations)

Group related `const`, `var`, and `type` declarations in one block. Do not put unrelated
declarations in the same block. Inside a function, group adjacent variable declarations in one
`var ( ... )` block.

### [Variable declarations](https://github.com/uber-go/guide/blob/master/style.md#local-variable-declarations)

- Local, with a value: `s := "foo"`, not `var s = "foo"`.
- Local, zero value: `var filtered []int`.

### [nil is a valid slice](https://github.com/uber-go/guide/blob/master/style.md#nil-is-a-valid-slice)

Return `nil`, not `[]T{}`. Check for an empty slice with `len(s) == 0`, not `s == nil`. A slice
declared with `var s []T` works with `append` without `make`. Note: JSON encodes a nil slice as
`null` and an empty slice as `[]`. If an API must return `[]`, make the empty slice on purpose.

### [Reduce scope of variables](https://github.com/uber-go/guide/blob/master/style.md#reduce-scope-of-variables)

Declare a variable in the smallest scope: `if err := f(); err != nil { ... }`. Do not do this when
you need the result after the `if`, or when it adds nesting. If only one function uses a constant,
declare the constant inside that function.

```go
// Bad: data is needed after the if, so the code nests
if data, err := os.ReadFile(name); err == nil {
	// ... uses data
} else {
	return err
}

// Good
data, err := os.ReadFile(name)
if err != nil {
	return fmt.Errorf("read config: %w", err)
}
```

### [Unnecessary else](https://github.com/uber-go/guide/blob/master/style.md#unnecessary-else)

If both branches of an `if` set the same variable, set the default first: `a := 10`, then `if b { a = 100 }`.

### [Initialize structs](https://github.com/uber-go/guide/blob/master/style.md#initializing-structs)

- Use field names. Test tables with three or fewer fields may omit them.
- Omit fields with zero values. Keep them only when the name adds meaning, for example in tests.
- Use `var u User` when all fields are zero.
- Use `&T{...}` for a pointer to a struct, not `new(T)` (ruleguard checks this). For a pointer to
  a basic value, `new(v)` (Go 1.26+) is fine.

```go
// Bad
u := User{"John", "Doe", true}
v := User{FirstName: "John", MiddleName: "", Admin: false}

// Good
u := User{FirstName: "John", LastName: "Doe", Admin: true}
v := User{FirstName: "John"}
```

### [Initialize maps](https://github.com/uber-go/guide/blob/master/style.md#initializing-maps)

Use `make` for an empty map or a map that code fills in. Give a size hint when you know the size:
`make(map[string]os.DirEntry, len(files))`. Use a map literal when the content is fixed:
`map[string]int{"a": 1, "b": 2}`.

### [Avoid naked parameters](https://github.com/uber-go/guide/blob/master/style.md#avoid-naked-parameters)

If the meaning of an argument is not clear, add a comment:
`printInfo("foo", true /* isLocal */, true /* done */)`. A custom type is better than `bool`. It
reads well and allows more than two states later: `printInfo("foo", RegionLocal, StatusDone)`.

### [Use raw string literals](https://github.com/uber-go/guide/blob/master/style.md#use-raw-string-literals-to-avoid-escaping)

Use a raw string literal when a string has quotes or backslashes:
`` `unknown name:"test"` ``, not `"unknown name:\"test\""`.

### [Keep format strings const](https://github.com/uber-go/guide/blob/master/style.md#format-strings-outside-printf)

If a `Printf`-style format string is not a literal in the call, declare it as `const`. Then
`go vet` can check it.

### [Function grouping and ordering](https://github.com/uber-go/guide/blob/master/style.md#function-grouping-and-ordering)

Order a file like this:

1. Types, constants, and variables.
2. The constructor (`NewT` or `newT`) right after its type, before the methods.
3. Methods, grouped by receiver. Exported methods first.
4. Plain helper functions (no receiver) at the end of the file.

Sort functions in call order where you can: a caller comes before the functions it calls.

### [Import groups and aliases](https://github.com/uber-go/guide/blob/master/style.md#import-group-ordering)

Use exactly two import groups: the standard library, then all other packages. Packages of this
module go in the second group too. Use an alias only when the package name is different from the
last element of the path, or when two imports have the same name
([Import Aliasing](https://github.com/uber-go/guide/blob/master/style.md#import-aliasing)).

```go
import (
	"fmt"
	"net/http"

	client "example.com/client-go" // the package name is client
	"github.com/sklyar/tap-translate/backend/internal/translation"
	transporthttp "github.com/sklyar/tap-translate/backend/internal/transport/http" // conflicts with net/http
)
```

### [Package and function names](https://github.com/uber-go/guide/blob/master/style.md#package-names)

Package names are lower case, with no underscores. They are short and not plural (`url`, not
`urls`). Do not use `util`, `common`, `shared`, or `lib`. Most callers must not need to rename
the package on import. Function names use MixedCaps. Test names may use an underscore to group
cases: `TestParse_EmptyInput`
([Function Names](https://github.com/uber-go/guide/blob/master/style.md#function-names)).

## Performance

These rules are for hot paths (code that runs very often). In other code, prefer clear code.

### [Specify container capacity](https://github.com/uber-go/guide/blob/master/style.md#prefer-specifying-container-capacity)

If you know the size, pass it to `make`: `make([]string, 0, len(users))`,
`make(map[string]User, len(users))`. With a slice capacity, `append` does not allocate until the
slice is full. A map size is only a hint, but it still reduces allocations.

### [Convert a fixed string to bytes once](https://github.com/uber-go/guide/blob/master/style.md#avoid-repeated-string-to-byte-conversions)

Do not write `buf.Write([]byte("hello"))` in a loop. Convert the string once before the loop:
`data := []byte("hello")`, and then call `buf.Write(data)` in the loop.

## Tests

### [Test tables](https://github.com/uber-go/guide/blob/master/style.md#test-tables)

Use a table when the same test logic runs with different inputs. Name the slice `tests` and the
loop variable `tt`. Prefix input fields with `give` and output fields with `want`.

```go
tests := []struct {
	give     string
	wantHost string
	wantPort string
}{
	{give: "192.0.2.0:8000", wantHost: "192.0.2.0", wantPort: "8000"},
	{give: ":8000", wantHost: "", wantPort: "8000"},
}
for _, tt := range tests {
	t.Run(tt.give, func(t *testing.T) {
		t.Parallel()
		host, port, err := net.SplitHostPort(tt.give)
		require.NoError(t, err)
		assert.Equal(t, tt.wantHost, host)
		assert.Equal(t, tt.wantPort, port)
	})
}
```

### [Avoid complex table tests](https://github.com/uber-go/guide/blob/master/style.md#avoid-unnecessary-complexity-in-table-tests)

Do not use a table when the subtest needs branches. These are bad signs: fields such as
`shouldCallX` or `expectCall`, functions in the table (`setupMocks func(*FooMock)`), and many `if`
statements in the loop. Split such a table into separate `Test...` functions or smaller tables.
Each case must use all fields and run all test logic. One `wantErr` branch is OK if the test body
is short.

### [Parallel tests](https://github.com/uber-go/guide/blob/master/style.md#parallel-tests)

Call `t.Parallel()` at the start of each test and each subtest. Since Go 1.22, each loop
iteration has its own `tt`, so do not write `tt := tt`. Parallel tests must not share mutable
state. Give each test its own values and fakes.

## Patterns

### [Functional options](https://github.com/uber-go/guide/blob/master/style.md#functional-options)

Use functional options for optional arguments of constructors and of public APIs that will grow,
especially with three or more arguments. Use the guide's form: an `Option` interface with an
unexported `apply` method. Do not use closures (`type Option func(*options)`). Option values can
be compared in tests and can implement `fmt.Stringer`.

```go
type options struct {
	timeout time.Duration
}

type Option interface {
	apply(*options)
}

type timeoutOption time.Duration

func (o timeoutOption) apply(opts *options) { opts.timeout = time.Duration(o) }

func WithTimeout(d time.Duration) Option { return timeoutOption(d) }

func NewClient(addr string, opts ...Option) *Client {
	o := options{timeout: _defaultTimeout} // defaults first
	for _, opt := range opts {
		opt.apply(&o)
	}
	// ...
}
```

## Checked by linters

`make lint` in `backend/` (golangci-lint, `backend/.golangci.yml`) already checks these rules.
Do not spend effort on them. Fix what the linter reports.

- Error names `ErrX` and `XError`: errname.
- `%w` in `fmt.Errorf`, and `errors.Is` / `errors.As` instead of `==` and type switches: errorlint.
- Wrapping errors from other packages: wrapcheck.
- No "failed to" prefix in error messages: custom ruleguard rule in `lint/rules.go`.
- Channel size is 0 or 1: ruleguard.
- Unchecked type assertions: errcheck.
- Mutable globals: gochecknoglobals.
- No `init()`: gochecknoinits.
- Built-in names used as identifiers: predeclared.
- Field tags in marshaled structs: musttag.
- Embedded fields at the top of the struct, no embedded mutexes: embeddedstructfieldcheck.
- `strconv` instead of `fmt` for simple conversions: perfsprint.
- Slice capacity in simple loops: prealloc.
- `panic` calls anywhere, tests included: forbidigo.
- Exit only in `main`: revive deep-exit, gocritic exitAfterDefer.
- Nesting and `else`: nestif, revive early-return, superfluous-else, indent-error-flow.
- nil slices and `make` for maps: revive enforce-slice-style, enforce-map-style.
- Line length 99: golines.
- Import grouping (two groups): gci. Missing and unused imports: goimports.
- An import alias that equals the package name: revive redundant-import-alias.
- `sync/atomic` functions instead of typed atomics (`atomic.Int64`, `atomic.Bool`): ruleguard.
- `new(T)` for a struct instead of `&T{}`: ruleguard.
- Top-level `var` with a type that the value already gives: revive var-declaration.
- Formatting: gofumpt.
- Printf-style function names end with `f`: goprintffuncname.
- Parallel tests: paralleltest, tparallel.
- Possible nil panics: nilaway (run it with `make nilaway`).

## Workflow

Before you finish a Go change, run in `backend/`:

1. `make fix-style` (formats the code)
2. `make check` (format check, lint, nilaway, tests)

Fix every lint issue in the code. Do not add `//nolint` to hide an issue. If `//nolint` is really
needed, name the linter and explain why on the same line, for example
`//nolint:gosec // G304: the path comes from the config file, not from user input.`
