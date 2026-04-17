---
name: rust-perf
description: Static performance audit for Rust projects — analyzes code for allocation, async, database, data-structure, and compile-time anti-patterns without requiring a running system. Use when reviewing code for performance issues before or instead of load testing. For runtime profiling and load-test analysis, use rust-perf-measure.
allowed-tools: bash, read, edit
argument-hint: "[file-or-module] [focus-area]"
---

# Rust Performance Audit (Static)

Code-based performance audit. Finds anti-patterns the compiler and static analysis can see: unnecessary allocations, async mis-configuration, N+1 query shapes, missing capacity hints, oversized enums, mis-set profile flags.

**This skill does not measure.** It infers from code structure. For real measurements (flamegraphs, load tests, heap profiling, production trace analysis), use the companion `rust-perf-measure` skill.

Scope the audit via `$ARGUMENTS` (e.g., a file, a crate, a module path, or a focus area like "async" / "db" / "allocations").

---

## Core principles

1. **Every finding must include file, line, current code, proposed fix, and rationale.** If the rationale is only "clippy said so," drop it.
2. **Hot path first.** A `.clone()` in a startup function is noise; the same in a per-request handler is signal.
3. **Do not claim measured impact.** This skill infers. Say "likely reduces allocations by N per call," not "+15% throughput."
4. **Do not flood output with style lints.** Filter clippy to perf-relevant lints — pedantic/nursery on a real workspace produces thousands of warnings and buries the signal.
5. **Preserve readability.** A marginal gain that obscures intent is a net loss.

---

## Phase 0 — Scope & hot-path inference

Before scanning, identify from code structure:

1. **Project shape:** server (gRPC/HTTP), CLI, library, worker — look at binary `[[bin]]` targets and entry points.
2. **Critical paths:**
   - Request handlers (`services/`, `routes/`, `handlers/`, `*_service.rs`, gRPC impls)
   - Functions called inside `for`/`while`/`.map()`/`.for_each()`
   - Middleware / interceptors (run per-request)
   - NATS/Kafka subscribers, cron workers
3. **Ambient constraints from CLAUDE.md or docs:** latency targets, multi-tenant hot queries, known bottlenecks.
4. **Scope the recommendations to the hot path.** Something cloned once at startup is not critical.

Output: one sentence stating what path the audit is prioritizing.

---

## Phase 1 — Compiler, tooling, dependencies

### Clippy — filter for signal

**Never run full `clippy::nursery + clippy::pedantic` on a real workspace** — it produces 1000s of warnings.

Start with pure-signal lints:
```bash
cargo clippy --workspace --all-targets -- -W clippy::perf
```

Then add specific perf lints from nursery/pedantic:
```bash
cargo clippy --workspace --all-targets -- \
  -W clippy::perf \
  -W clippy::redundant_clone \
  -W clippy::inefficient_to_string \
  -W clippy::large_enum_variant \
  -W clippy::needless_collect \
  -W clippy::slow_vector_initialization \
  -W clippy::redundant_closure \
  -W clippy::or_fun_call \
  -W clippy::unnecessary_to_owned \
  -W clippy::trivial_regex \
  -W clippy::format_push_string
```

### Binary & dependency hygiene

| Command | What it finds |
|---|---|
| `cargo tree --duplicates` | Duplicate crate versions — bloat + compile time |
| `cargo bloat --release --crates` | Which crates dominate the binary |
| `cargo bloat --release -n 30` | Largest individual functions |
| `cargo-machete` / `cargo-udeps` | Unused dependencies |
| `cargo tree -e normal -e build` | Heavy proc-macro deps pulled transitively |

### Cargo.toml

**`[profile.release]` checklist:**
```toml
[profile.release]
lto = "fat"
codegen-units = 1
opt-level = 3
strip = true
panic = "abort"  # only if no catch_unwind

[profile.release-with-debug]  # for when rust-perf-measure runs
inherits = "release"
debug = true
strip = false
```

**Feature flags:** look for `default-features = false` opportunities on heavy deps (`tokio` with `full` when a subset suffices, `reqwest` TLS stack, `sqlx` drivers).

**Alt-deps worth considering** (only flag if hot-path-relevant):
- `aho-corasick` vs `regex` for fixed-string patterns
- `simd-json` vs `serde_json` for large JSON (needs AVX2)
- `ahash`/`foldhash`/`FxHash` vs default `SipHash` in non-DoS-sensitive maps
- `bytes::Bytes` vs `Vec<u8>` for zero-copy sharing

---

## Phase 2 — Allocation & memory patterns

| Anti-pattern | Fix |
|---|---|
| `.clone()` on `String`/`Vec`/custom structs in hot path | Borrow, `Cow<'_, T>`, or restructure ownership |
| `.clone()` on `Arc<T>` | Fine (refcount bump). Not a finding. Skip. |
| `String` parameter where `&str`/`Cow<str>` fits | Change signature to borrowed |
| `Vec::new()` + repeated `push` in loop | `Vec::with_capacity(n)` |
| `collect()` into `Vec` only to iterate again | Chain iterators, `flat_map`, `itertools` |
| `Box<dyn Trait>` in hot path | Generics, `enum_dispatch`, static dispatch |
| Repeated small allocs inside a loop | Hoist buffer; reuse across iterations |
| `format!()` / `to_string()` in hot path | `write!` into reusable buffer; `itoa`/`ryu` for numbers |
| String literal `.to_string()` in struct fields built per-request | `&'static str` field, or `const NAME: &str = "..."` reused |
| `HashMap` with small fixed key count | `BTreeMap`, array, `phf` for compile-time static maps |
| Large struct (>~128B) passed by value repeatedly | Pass `&T` or `Box<T>` |
| `anyhow::Error` + `.context()` on hot error paths (per-request validation) | Typed errors, lazy context |
| `Arc::new(...)` inside a loop for shared-identity data | Hoist above loop |
| `unwrap_or(some_alloc)` | `unwrap_or_else(|| alloc)` — avoids unconditional allocation |

**How to find:** grep `.clone()`, `.to_string()`, `format!(`, `Vec::new()`, `.collect::<Vec`. Cross-reference with hot paths from Phase 0.

---

## Phase 3 — Async & concurrency (code-level)

| Issue | Fix |
|---|---|
| **Sequential `.await` chain where calls are independent** | `tokio::join!` / `try_join!` / `FuturesUnordered`. Often the biggest static-findable win. |
| Blocking or CPU-heavy sync call inside `async fn` | `tokio::task::spawn_blocking` or async alternative |
| `std::sync::Mutex` held across `.await` | `tokio::sync::Mutex`, or narrow scope so guard drops before await |
| Unbounded channels | Bounded + backpressure |
| `Arc<Mutex<Vec<T>>>` for shared state under write contention | `DashMap`, `RwLock`, sharded, or actor |
| Spawning tasks unbounded in a loop | `Semaphore` / `stream::buffer_unordered(N)` |
| New `reqwest::Client` per request | Share singleton (conn pool reuse) |
| Multiple independent DB queries in one handler `.await`'d serially | `try_join!` or batch into one query |
| Large `Stream::collect()` when processing can be incremental | `while let Some(x) = s.next().await` |
| `.await` inside `tokio::sync::Mutex` guard on contended lock | Drop guard before await |

**Grep patterns:**
```bash
# Candidate for join!: two+ await calls with no data dependency between them
grep -rn "\.await" --include="*.rs" -A 3 | grep -B 1 "\.await"

# reqwest client created outside main
grep -rn "reqwest::Client::new\|ClientBuilder::new" --include="*.rs"

# std::sync::Mutex in async crates
grep -rn "std::sync::Mutex" --include="*.rs"
```

---

## Phase 4 — Database access (always run if project uses SQLx / diesel / sea-orm)

Database access usually dominates server latency. Static patterns to look for:

| Issue | Check / Fix |
|---|---|
| **N+1 queries** — loop body calls `find_by_id` / `fetch_one` / repo method | Batch with `WHERE id = ANY($1)`, `IN`, or fetch-all + group |
| `fetch_all` without `LIMIT` or pagination | Add `LIMIT`; unbounded = OOM under scale |
| `SELECT *` when rows have large/unused columns (BLOBs, JSONB, TEXT) | Project only used columns |
| Transaction scope wider than necessary | Begin late, commit early; never hold tx across external HTTP/NATS call |
| Repeatedly parsing JSON column in Rust per row | Push to DB: `->>`, `jsonb_path_query`, materialized view |
| Row-by-row insert in a loop | `INSERT ... VALUES (..),(..),(..)`, `UNNEST`, or `COPY` |
| Connection pool size vs worker count mismatch | Pool must match actual concurrency, not arbitrary |
| `.fetch_optional` when `.fetch_one` is expected (or vice versa) | Match to business rule; wrong one adds roundtrip or panic risk |
| Search with `LIKE '%x%'` on large tables | Needs trigram/GIN index or full-text search |
| Dynamic SQL via `format!` | Correctness first (SQL injection), then perf (no prepared stmt reuse) |

**Static detection commands:**
```bash
# N+1 candidates: repo/query calls inside for-loops
grep -rn "for .* in" --include="*.rs" -A 10 | grep -B 2 "\.find\|\.fetch_\|\.get_"

# Unbounded fetch_all
grep -rn "fetch_all" --include="*.rs" | grep -v "LIMIT\|limit"

# SELECT * in queries
grep -rn "SELECT \*\|select \*" --include="*.rs"

# Per-column projection audit (SQLx query! macro is safer than query_as)
grep -rn "sqlx::query_as::<\|sqlx::query(" --include="*.rs"
```

---

## Phase 5 — Data structures & algorithms

- Flag `O(n²)` patterns: nested loops over collections, `Vec::contains` in a loop, `.position()` in a loop
- Frequent lookups on `Vec` → `HashSet`/`HashMap`
- Small fixed collections → `SmallVec`, `ArrayVec`, `tinyvec`, stack arrays
- Shared `Vec<u8>` ownership → `bytes::Bytes` (zero-copy)
- Sorted data + repeated lookups → `binary_search`
- Concurrent counters under contention → `AtomicU64` or per-thread sharded
- `String` keys for fixed small set → actual `enum`

---

## Phase 6 — Serialization & I/O

| Issue | Fix |
|---|---|
| Full struct serialization when only a subset is used | `#[serde(skip)]`, view types, `#[serde(flatten)]` |
| `serde_json::Value` as intermediate when the struct is known | Deserialize directly into the typed struct |
| Unbuffered file I/O | `BufReader` / `BufWriter` |
| `fs::read_to_string` on large files | Stream with `AsyncBufReadExt::lines` |
| Small socket writes in a loop | `BufWriter` or batch |
| Service-to-service JSON in internal hot path | Consider `bincode`, `postcard`, `rkyv`, or protobuf |

---

## Phase 7 — Observability overhead (code-level)

These issues are findable in code without running anything:

| Issue | Fix |
|---|---|
| `tracing::debug!(field = ?huge_struct)` — eager formatting even when level filtered | Use `if tracing::enabled!(Level::DEBUG) { ... }`, or pass plain fields not `?`/`%` |
| `#[instrument]` on a tight-loop inner function | Move span outside loop, or drop the attribute |
| High-cardinality labels in metrics (user_id, request_id, session_id as label) | Use as event attributes, not metric labels |
| OTLP / `tracing-loki` exporter without batch config | Set batch size + timeout |
| Debug-level spans in hot paths shipped to prod | Level-gate via `EnvFilter` |
| `panic::catch_unwind` per request with `panic = "abort"` | Remove — incompatible |
| Sync log writer on request path | Async writer + bounded channel |

---

## Phase 8 — Server tuning (HTTP/gRPC config review)

Review configuration files and server initialization for:

- Worker count matches CPU / workload — not hardcoded to an arbitrary number
- Body/message size limits set explicitly (`PayloadConfig`, `tonic` max message sizes)
- Keepalive tuned (too short = reconnect storm, too long = dead conns)
- gRPC compression enabled if bandwidth-bound (`send_compressed`/`accept_compressed`)
- `reqwest::Client` is an app-level singleton passed via `Arc`
- DB pool size declared alongside worker count (not independent knobs)
- Tokio runtime `worker_threads` / `max_blocking_threads` tuned if defaults don't match workload

---

## Phase 9 — Compile-time & type-level

- `#[inline]` on small frequently-called library functions (needed for cross-crate inlining on non-generic fns)
- `const fn` for functions whose body is const-eligible — enables compile-time evaluation
- `clippy::large_enum_variant` — `Box` the large variant. Confirm with `std::mem::size_of::<Enum>()`.
- `dyn Trait` → generics when static dispatch viable
- Heavy proc-macro deps pulled transitively (`cargo tree -e build`)
- Feature flags: disable unused features on big deps

---

## Output format

### 1. Scope statement

One sentence: what was audited, what goal, what hot path was prioritized, that this is **static analysis without measurement**.

### 2. Findings by severity

#### Critical (high-confidence impact or correctness concern)
- `file:line` — current code — proposed fix — why it matters

#### Recommended (likely improvement, low risk)
- Same format

#### Consider (potential, needs measurement via `rust-perf-measure` to confirm)
- Same format + trade-off note

### 3. What's clean (always include)

Explicitly list checks that passed. This tells the reader what scope was actually covered:
- Blocking ops correctly wrapped in `spawn_blocking` ✓
- `[profile.release]` has `lto = "fat"` and `codegen-units = 1` ✓
- No N+1 query patterns found ✓
- No `std::sync::Mutex` across `.await` ✓
- (etc.)

### 4. Profile configuration (if any flag missing)

Provide the full recommended block.

### 5. Next steps

If findings suggest CPU-bound or alloc-heavy paths that benefit from real measurement, recommend running `rust-perf-measure` next.

### 6. Prioritized checklist

```
- [ ] (Critical #1 — short description)
- [ ] (Critical #2)
- [ ] (Recommended #1)
- ...
```

---

## Anti-patterns in audit output itself

Do **not**:
- Claim a percentage impact without a benchmark (this skill doesn't measure)
- Flag `Arc::clone` or `.clone()` on `Arc<T>` as a problem (it's a refcount bump)
- Recommend swapping deps (`serde_json` → `simd-json`) without evidence of hot-path JSON parsing
- Suggest `unsafe` for micro-gains
- Flood with cosmetic lints — scope is **performance**, not style
- Propose changes that regress readability without clear win
- Output recommendations for code paths that are NOT hot (validate against Phase 0 scope)
