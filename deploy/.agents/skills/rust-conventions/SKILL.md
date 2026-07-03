---
name: rust-conventions
description: "Rust conventions — cargo, clippy, thiserror/anyhow, ownership rules, unsafe justification, zeroize/secrecy, project structure. Use when editing **/*.rs files."
---

# Rust Conventions

## When to Use

Invoke this skill when writing or editing Rust files (`**/*.rs`). It covers project structure, error handling, ownership, testing, and security.

## Tools & Commands

- **Build:** `cargo build`
- **Test:** `cargo test`
- **Lint:** `cargo clippy -- -D warnings`
- **Format:** `cargo fmt`
- **Check:** `cargo check` (fast compile check without codegen)
- **Dependency audit:** `cargo audit`
- **Full check (in order):**
  ```bash
  cargo fmt -- --check && cargo clippy -- -D warnings && cargo test && cargo audit
  ```

## Project Structure

```
project/
├── src/
│   ├── main.rs          # Binary entrypoint (or lib.rs for libraries)
│   ├── lib.rs           # Library root (even for binaries, put logic here)
│   ├── config.rs
│   ├── error.rs
│   └── handlers/
├── tests/
│   └── integration_test.rs
├── benches/
├── Cargo.toml
├── Cargo.lock           # Commit for binaries, .gitignore for libraries
└── clippy.toml
```

- **`src/lib.rs`** for all logic, `src/main.rs` is a thin wrapper.
- **Modules:** one concept per file. Group related modules in directories with `mod.rs` (or use `foo/mod.rs` convention).
- **`error.rs`** for error types (use `thiserror` for library errors, `anyhow` for application errors).
- **`config.rs`** for configuration parsing (use `clap` for CLIs, `serde` + `toml`/`yaml` for config files).

## Error Handling

```rust
// Use thiserror for library error types
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("user {0} not found")]
    NotFound(UserId),

    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("validation failed: {0}")]
    Validation(String),
}

// Use anyhow for application-level Result aliases
use anyhow::{Context, Result};

fn main() -> Result<()> {
    let config = load_config().context("loading configuration")?;
    Ok(())
}
```

- **Use `thiserror`** for library error types. Derive `Error`, `Debug`, and implement `Display`.
- **Use `anyhow`** for application-level error handling where you don't need to distinguish error types.
- **Use `.context()`** to add meaningful context to errors.
- **Never `.unwrap()` or `.expect()` in production code** unless you can prove the invariant holds. Use `?` and proper error types instead.
- **Don't box errors unnecessarily** — `Box<dyn Error>` is a last resort.

## Ownership & Borrowing

- **Prefer borrowing over cloning** unless ownership is required.
- **Use `&str` for string parameters** when the function doesn't need to own the string.
- **Use `Cow<str>`** when you sometimes need to clone but usually borrow.
- **Return owned types from functions** — don't return references to locally created data.
- **Use `Arc<Mutex<T>>` or `Arc<RwLock<T>>`** for shared mutable state across threads. Prefer channels when possible.
- **`unsafe` requires a comment explaining** why it's necessary and why it's correct. Every `unsafe` block must have a safety justification.

## Testing

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_positive_numbers() {
        assert_eq!(add(2, 3), 5);
    }

    #[test]
    #[should_panic(expected = "overflow")]
    fn test_add_overflow_panics() {
        add(i32::MAX, 1);
    }
}
```

- **Unit tests in the same file** with `#[cfg(test)]` module.
- **Integration tests in `tests/`** directory.
- **Doc tests** on public APIs — they serve as both examples and tests.
- **Test function names describe what they test.** `test_add_positive_numbers`, not `test_add`.
- **Use pretty_assertions** for clearer diff output on assertion failures (optional but nice).

## Naming Conventions

- **snake_case for functions, methods, variables, modules, crates.**
- **PascalCase for types, traits, enums, enum variants.**
- **SCREAMING_SNAKE_CASE for consts and statics.**
- **No abbreviations.** `config` not `cfg`, `response` not `resp`.
- **Boolean variables read as a question:** `is_ready`, `has_data`.

## Security

- **Use `secrecy::Secret<T>`** for sensitive data (passwords, tokens). It zeroizes on drop and redacts in Debug output.
- **Use `zeroize`** for types that hold secrets but can't use `Secret<T>`.
- **No secrets in logs or error messages.** Use `secrecy` types that auto-redact.
- **Validate all input at trust boundaries.** Use `validator` crate or manual validation.
- **Never `unwrap()` on user-supplied input.**
- **Check `cargo audit` regularly.** Fix or update vulnerable dependencies.

## Performance

- **Use `--release` for benchmarks and production builds.**
- **Profile before optimizing.** Use `flamegraph`, `criterion`, or `perf`.
- **Prefer iterators over manual loops** for clarity and optimization potential.
- **Use `Vec::with_capacity`** when the size is known.
- **Avoid unnecessary allocations.** Reuse buffers, use `Cow`, borrow when possible.
