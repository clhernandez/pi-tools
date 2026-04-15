---
name: rust-doc-comments
description: Use when adding, reviewing, or improving doc-comments on Rust functions, methods, structs, enums, or modules. Covers idiomatic `///` and `//!` style, required sections, and automation via cargo doc.
allowed-tools: bash, read, edit, grep
---

# Rust Doc Comments

## Overview

Add idiomatic Rust documentation comments (`///`) to all public — and relevant private — functions, methods, structs, enums, traits, and modules. Follow standard Rustdoc conventions so `cargo doc` generates correct, navigable HTML.

## When to Use

- Adding doc-comments to an undocumented Rust project
- Reviewing quality of existing doc-comments
- Deciding which sections (`# Arguments`, `# Returns`, etc.) a comment needs
- Generating or verifying doctests compile

## Step-by-Step Process

### 1. Discover undocumented items

```bash
# Find public items missing doc-comments (rustdoc lint)
cargo rustdoc -- -D rustdoc::missing_doc_code_examples 2>&1 | head -60

# Simpler: just find missing docs warnings
RUSTDOCFLAGS="-D missing_docs" cargo doc 2>&1 | grep "warning\|error"

# Manual grep: find pub fn/struct/enum/trait without preceding ///
grep -n "pub fn\|pub struct\|pub enum\|pub trait" src/**/*.rs
```

### 2. Write the comment

Place `///` immediately above the item — no blank line between comment and item.

```rust
/// Brief one-line summary (imperative mood, no period at end).
///
/// Longer description if needed. Explain *what* and *why*, not *how*.
/// Use Markdown freely: **bold**, `code`, [links](crate::OtherType).
///
/// # Arguments
///
/// * `name` - What this argument represents and valid range/values.
/// * `flag` - `true` means X; `false` means Y.
///
/// # Returns
///
/// Describe the success value. For `Option<T>` note when `None` is returned.
///
/// # Errors
///
/// List each error variant that can be returned and under what condition.
/// Required whenever the function returns `Result<_, E>`.
///
/// # Panics
///
/// Describe conditions that cause a panic. Required if function can panic.
///
/// # Examples
///
/// ```rust
/// use my_crate::greet;
/// let msg = greet("world");
/// assert_eq!(msg, "Hello, world!");
/// ```
pub fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}
```

### 3. Section rules — include only what applies

| Section | Include when |
|---|---|
| `# Arguments` | Function has ≥ 1 parameter worth explaining |
| `# Returns` | Return type is non-obvious or has special cases |
| `# Errors` | Function returns `Result<_, E>` |
| `# Panics` | Function can panic (even via `unwrap`) |
| `# Safety` | Function is `unsafe` — **required** |
| `# Examples` | Any public item; doctests are run by `cargo test` |

**Skip sections that add no information.** `# Returns` for `()` is noise.

### 4. Module-level and crate-level docs

Use `//!` (inner doc comment) at the top of `lib.rs` / `main.rs` / `mod.rs`:

```rust
//! # My Crate
//!
//! Short description of the crate's purpose.
//!
//! ## Usage
//!
//! ```rust
//! use my_crate::Client;
//! let c = Client::new("http://localhost");
//! ```
```

### 5. Verify

```bash
# Build docs — fails on broken intra-doc links
cargo doc --no-deps 2>&1 | grep -E "warning|error"

# Run all doctests
cargo test --doc

# Check nothing is missing (configure in Cargo.toml or lib.rs)
# #![warn(missing_docs)]
```

## Quick Reference

```rust
// ✅ Correct placement — no blank line
/// Does the thing.
pub fn do_thing() {}

// ❌ Wrong — blank line breaks association
/// Does the thing.

pub fn do_thing() {}

// ✅ Private items: use /// only if implementation is non-obvious
/// Retries up to MAX_RETRIES using exponential back-off.
fn retry_with_backoff(f: impl Fn() -> bool) -> bool { ... }

// ✅ Struct fields get their own ///
pub struct Config {
    /// Maximum number of retries before giving up.
    pub max_retries: u32,
}

// ✅ Enum variants get their own ///
pub enum Status {
    /// Request completed successfully.
    Ok,
    /// Server returned an error; contains the HTTP status code.
    Error(u16),
}
```

## Common Mistakes

| Mistake | Fix |
|---|---|
| `// comment` instead of `/// comment` | Use `///` for rustdoc |
| Blank line between `///` and item | Remove the blank line |
| `# Arguments` for self-evident params | Skip obvious parameters |
| Doctest not in a ```` ```rust ```` block | Add `rust` language tag |
| Doctest uses private API | Mark with ```` ```rust,ignore ```` or use `pub` |
| Missing `# Errors` on `Result`-returning fn | Always document error variants |
| Missing `# Safety` on `unsafe fn` | **Required** — document invariants |
| Outdated docs after refactor | Re-run `cargo doc` and `cargo test --doc` |

## Automation Tips

```bash
# Add to Cargo.toml [package.metadata.docs.rs] for docs.rs
# or add to lib.rs to enforce during development:
#![warn(missing_docs)]
#![warn(rustdoc::broken_intra_doc_links)]
#![warn(rustdoc::missing_doc_code_examples)]  # nightly only
```
