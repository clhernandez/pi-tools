---
name: rust-review
description: Review Rust code for clippy warnings, idiomatic patterns, error handling, performance, and best practices. Use when reviewing Rust files or functions.
allowed-tools: bash, read, edit
---

Review the Rust code in this project (or the files specified by the user) and provide feedback on:

1. **Clippy warnings** — run `cargo clippy` and report any issues found
2. **Idiomatic Rust** — suggest more idiomatic alternatives where applicable
3. **Error handling** — check for proper use of `Result`, `Option`, `?` operator, and avoid `unwrap()`/`expect()` in production paths
4. **Performance** — identify unnecessary clones, allocations, or inefficient patterns
5. **Ownership & lifetimes** — flag any suspicious lifetime annotations or ownership patterns
6. **Safety** — highlight any `unsafe` blocks and verify they are justified

Start by running `cargo clippy -- -D warnings` to get compiler feedback, then read the relevant source files and provide actionable suggestions grouped by severity (error, warning, suggestion).
