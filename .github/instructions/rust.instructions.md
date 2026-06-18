---
description: "Use when working with Rust files. Covers formatting with rustfmt, clippy lints, testing, project layout, error handling, and ownership patterns."
applyTo: "**/*.rs"
---

# Rust Conventions

## Build & Test Commands

- **Build**: `cargo build`
- **Release build**: `cargo build --release`
- **Test**: `cargo test`
- **Test with output**: `cargo test -- --nocapture`
- **Lint**: `cargo clippy -- -D warnings` (treat warnings as errors)
- **Format**: `cargo fmt -- --check` (CI) or `cargo fmt` (apply)
- **Docs**: `cargo doc --open`

## Documentation — Mandatory

Every public item MUST have a `///` doc comment with examples where helpful.

```rust
/// Creates a new connection pool for the given database URL.
///
/// The pool starts with `min` connections and grows up to `max` under load.
/// Connections are validated with a ping before being handed out.
///
/// # Examples
/// ```
/// let pool = connect("postgres://localhost/db", 5, 20)?;
/// ```
///
/// # Errors
/// Returns `ConnectError` if the database is unreachable.
pub fn connect(url: &str, min: u32, max: u32) -> Result<Pool, ConnectError> {
```

- Module-level docs with `//!` at the top of `lib.rs` or `mod.rs`
- Examples in doc comments are compiled and tested — keep them working
- `#[must_use]` on functions where ignoring the return value is a bug

## Error Handling

- Use `Result<T, E>` for recoverable errors — never `unwrap()` in library code
- Use `thiserror` for library error types, `anyhow` for application code
- Implement `std::fmt::Display` and `std::error::Error` for custom errors
- Use the `?` operator for propagation
- Context on errors:

```rust
use anyhow::Context;
let config = read_file("config.toml")
    .with_context(|| "failed to read config")?;
```

- Reserve `panic!` for unrecoverable states (invariants, not expected failures)

## Project Layout

```
project/
├── Cargo.toml
├── Cargo.lock
├── src/
│   ├── main.rs             # Binary entry point
│   ├── lib.rs              # Library root (if library)
│   ├── models/
│   ├── services/
│   └── utils/
├── tests/                  # Integration tests
│   └── integration_test.rs
├── benches/                # Benchmarks
├── examples/               # Example binaries
└── rustfmt.toml            # Formatting config
```

- Use workspaces for multi-crate projects: `[workspace]` in root `Cargo.toml`
- Integration tests go in `tests/`, not `src/`
- Use `rustfmt.toml` for team formatting standards

## Ownership & Borrowing

- Prefer references (`&T`, `&mut T`) over cloning unless ownership is required
- Use `Cow<'_, T>` for copy-on-write patterns
- Derive `Clone` only when cloning is semantically correct, not just convenient
- Use `Arc<Mutex<T>>` for shared mutable state across threads; consider `tokio::sync` for async contexts
- Prefer `&str` over `&String` in function parameters

## Testing

- Unit tests go inline in the same file, in a `#[cfg(test)] mod tests { ... }` block
- Integration tests go in `tests/` directory
- Use descriptive test names: `test_when_queue_is_full_returns_error`
- Prefer `assert_eq!` over `assert!` with `==` for better error messages
- Use `rstest` crate for parameterized/fixture-based tests when needed

## Clippy & Formatting

- All code MUST pass `cargo clippy -- -D warnings` — no exceptions
- All code MUST be formatted with `cargo fmt` (use `rustfmt.toml` for custom rules)
- Enable additional clippy lints in `Cargo.toml`:

```toml
[lints.clippy]
pedantic = "warn"
unwrap_used = "warn"
expect_used = "warn"
```

## General Practices

- Prefer `enum` over `bool` for function parameters — `set_mode(Mode::ReadOnly)` not `set_readonly(true)`
- Use the type system to make invalid states unrepresentable
- Derive common traits: `Debug`, `Clone`, `PartialEq`, `Eq`, `Hash`, `Serialize`, `Deserialize`
- Use `tracing` crate for structured logging (not `println!` or `log` crate directly)
- Async: prefer `tokio` runtime; use `async_trait` for async trait methods
