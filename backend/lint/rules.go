//go:build ruleguard

// Package gorules contains custom rules for the gocritic ruleguard checker.
//
// golangci-lint loads this file from .golangci.yml. The ruleguard build tag
// excludes it from the build, but go mod tidy still keeps the dsl dependency.
//
// DSL reference: https://github.com/quasilyte/go-ruleguard/blob/master/_docs/dsl.md
package gorules

import "github.com/quasilyte/go-ruleguard/dsl"

// errorMessagePrefix reports error messages that start with "failed to" and similar phrases.
// These phrases state the obvious and repeat at every level of the error chain.
// See https://github.com/uber-go/guide/blob/master/style.md#error-wrapping.
func errorMessagePrefix(m dsl.Matcher) {
	m.Match(`fmt.Errorf($msg, $*_)`, `errors.New($msg)`).
		Where(m["msg"].Text.Matches(`^"(?i)(failed|unable|cannot|can't|could not|couldn't|error)\b`)).
		Report(`error message starts with "failed to" or a similar phrase; name the operation instead, for example "new store: %w"`)
}

// channelSize reports buffered channels with a size other than one.
// See https://github.com/uber-go/guide/blob/master/style.md#channel-size-is-one-or-none.
func channelSize(m dsl.Matcher) {
	const msg = `channel size must be one or none; ` +
		`if a larger buffer is really needed, explain why in a //nolint:gocritic comment`

	m.Match(`make(chan $_, $size)`).
		Where(m["size"].Const && m["size"].Value.Int() > 1).
		Report(msg)

	m.Match(`make(chan $_, $size)`).
		Where(!m["size"].Const).
		Report(msg)
}

// atomicFunctions reports sync/atomic functions that have type-safe replacements.
// See https://github.com/uber-go/guide/blob/master/style.md#use-gouberorgatomic.
func atomicFunctions(m dsl.Matcher) {
	m.Import("sync/atomic")
	m.Match(`atomic.$fn($*_)`).
		Where(m["fn"].Text.Matches(`^(Add|And|Or|Load|Store|Swap|CompareAndSwap)(Int32|Int64|Uint32|Uint64|Uintptr|Pointer)$`)).
		Report(`use the sync/atomic types (atomic.Int64, atomic.Bool, ...) instead of atomic.$fn`)
}

// newStruct reports new(T) for struct types.
// See https://github.com/uber-go/guide/blob/master/style.md#initializing-struct-references.
func newStruct(m dsl.Matcher) {
	m.Match(`new($t)`).
		Where(m["t"].Type.Underlying().Is(`struct{$*_}`)).
		Report(`use &$t{} instead of new($t)`)
}
