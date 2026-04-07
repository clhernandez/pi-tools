---
name: rust-perf
description: Deep performance audit and optimization for Rust projects. Analyzes allocations, async patterns, data structures, CPU/memory efficiency, and generates actionable optimization recommendations. Use when the user wants to optimize Rust code, investigate performance bottlenecks, or review code with a performance-first lens.
allowed-tools: bash, read, edit
argument-hint: "[file-or-module] [focus-area]"
---

# Rust Performance Audit

Perform a thorough performance and best-practices audit on the specified files, module, or the entire project if no target is given. Use `$ARGUMENTS` to scope the analysis (e.g., a file path, module name, or focus area like "async" or "allocations").

## Audit Process

### Phase 1 — Compiler & Tooling Feedback

1. Run `cargo clippy -- -W clippy::perf -W clippy::nursery -W clippy::pedantic` to surface performance-related and advanced lints.
2. Check `Cargo.toml` for:
   - Missing `lto = true`, `codegen-units = 1`, `opt-level` in `[profile.release]`
   - Dependencies with known performance issues or lighter alternatives (e.g., `regex` vs `aho-corasick` for simple patterns, `serde_json` vs `simd-json` where applicable)
   - Feature flags that could be trimmed to reduce compile time and binary size

### Phase 2 — Allocation & Memory Patterns

Look for these anti-patterns and suggest fixes:

| Anti-pattern | Fix |
|---|---|
| Unnecessary `.clone()` on large types | Borrow, use `Cow<'_, T>`, or restructure ownership |
| `String` where `&str` or `Cow<str>` suffices | Use borrowed types in function signatures |
| `Vec` built with repeated `push` without `with_capacity` | Pre-allocate with `Vec::with_capacity(n)` |
| `collect()` into intermediate `Vec` just to iterate again | Chain iterators, use `flat_map`, or `itertools` |
| `Box<dyn Trait>` in hot paths | Consider generics, `enum_dispatch`, or static dispatch |
| Repeated small allocations in loops | Reuse buffers, move allocations outside loops |
| `format!()` / `to_string()` in hot paths | Use `write!()` to a reusable buffer, or `itoa`/`ryu` for numbers |
| `HashMap` with small key count | Consider `BTreeMap`, arrays, or `phf` for static maps |
| Large structs on the stack passed by value | Pass by reference or `Box` for large types |

### Phase 3 — Async & Concurrency Performance

If the project uses `tokio` or other async runtimes:

| Issue | Recommendation |
|---|---|
| Blocking I/O in async context | Move to `tokio::task::spawn_blocking` or use async alternatives |
| `Mutex` from `std` in async code | Use `tokio::sync::Mutex` or restructure to avoid holding locks across `.await` |
| Unbounded channels | Use bounded channels with backpressure to prevent memory growth |
| `Arc<Mutex<Vec>>` as shared state | Consider `dashmap`, `RwLock`, or actor patterns |
| Spawning tasks in tight loops without limits | Use `Semaphore` or `buffer_unordered` to cap concurrency |
| Missing `select!` for cancellation | Ensure tasks check cancellation tokens or use `tokio::select!` |
| Large `.await` chains without yielding | Insert `tokio::task::yield_now()` in CPU-heavy async loops |

### Phase 4 — Data Structures & Algorithms

- Flag O(n^2) or worse patterns (nested loops over collections, repeated linear searches)
- Suggest `HashSet`/`HashMap` for frequent lookups instead of `Vec::contains`
- Check for appropriate use of `SmallVec`, `ArrayVec`, or stack-allocated buffers for small, fixed-size collections
- Look for opportunities to use `bytes::Bytes` instead of `Vec<u8>` for zero-copy sharing
- Check sorting/searching: suggest `binary_search` on sorted data instead of `find`/`position`

### Phase 5 — Serialization & I/O

| Issue | Recommendation |
|---|---|
| Unbuffered reads/writes | Wrap in `BufReader`/`BufWriter` |
| Serializing full structs when only fields needed | Use `#[serde(skip)]` or create view types |
| JSON parsing in hot path | Consider binary formats (`bincode`, `postcard`, `rkyv`) for internal data |
| Frequent small socket writes | Batch writes, use `writev`/vectored I/O |
| Reading entire files into memory | Use streaming/chunked reads where possible |

### Phase 6 — Compile-Time & Type-Level Optimizations

- Check for `#[inline]` on small, frequently-called functions in library code
- Suggest `const fn` where functions can be evaluated at compile time
- Look for `enum` variants with vastly different sizes (use `Box` on the large variant)
- Flag unnecessary `dyn Trait` where static dispatch is viable
- Check if `derive` macros are pulling in heavy proc-macro dependencies

## Output Format

Structure findings as:

### Critical (measurable impact, fix now)
- Finding with file:line reference, estimated impact, and concrete fix

### Recommended (likely improvement, low risk)
- Finding with file:line reference and suggested change

### Consider (potential improvement, needs benchmarking)
- Finding with rationale and trade-offs

### Profile Configuration
If `[profile.release]` is missing optimizations, provide the recommended block:
```toml
[profile.release]
lto = "fat"
codegen-units = 1
opt-level = 3
strip = true
panic = "abort"  # only if no catch_unwind is used
```

### Best Practices Checklist
End with a summary checklist:
- [ ] No unnecessary allocations in hot paths
- [ ] Async code free of blocking operations
- [ ] Pre-allocated buffers where sizes are known
- [ ] Appropriate data structures for access patterns
- [ ] Release profile optimized
- [ ] No clippy::perf warnings

Be specific and actionable. Every recommendation must include the file, line, current code, and proposed replacement. Do not suggest changes that sacrifice readability without meaningful performance gain.
