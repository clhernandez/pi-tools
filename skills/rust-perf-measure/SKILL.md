---
name: rust-perf-measure
description: Dynamic performance measurement for Rust projects — profiling, load testing, benchmarking, and analysis of existing observability data (traces, metrics, logs). Use when you need measured impact, not inference. Requires either a runnable binary + load generator, or existing production telemetry. For static code-level analysis without measurement, use rust-perf.
allowed-tools: bash, read, edit
argument-hint: "[binary-or-endpoint] [goal: latency|throughput|memory|binary-size]"
---

# Rust Performance Measurement (Dynamic)

Measure real performance. Produce numbers, not inferences. This skill is the companion to `rust-perf` — the static one finds anti-patterns from code; this one confirms impact, finds the non-obvious bottlenecks, and guides optimization with evidence.

**Prerequisites:** one of these must be true, or the skill cannot produce measured results:
- **Mode A (load-test):** a runnable binary + a way to generate synthetic load (local env, staging)
- **Mode B (observability):** existing production telemetry (OTLP traces, metrics, logs, APM)
- **Mode C (micro):** a specific hot function the user wants benchmarked

If none of these are available, stop and recommend running `rust-perf` (static) instead.

Scope via `$ARGUMENTS`: the binary to profile, the endpoint to load-test, or the goal.

---

## Core principles

1. **Baseline first, always.** No change is "faster" without a before-number. Save and version baselines.
2. **Measure one variable at a time.** Changing two things at once makes the result unattributable.
3. **Reproduce before optimizing.** If you can't reproduce the slow behavior, you can't verify a fix.
4. **Prefer sampling over instrumentation for CPU.** Instrumentation distorts what you measure.
5. **Tail matters more than mean.** p99, p999, max — not just average.
6. **Cost-model your findings.** 100ms saved in a nightly batch job ≠ 100ms saved per request at 1000 req/s.

---

## Phase 0 — Choose the mode

Ask the user (or infer from $ARGUMENTS):

| Question | Selects |
|---|---|
| "Do you have production traffic or staging telemetry?" | Mode B (observability) — easiest, zero setup |
| "Can you run the binary locally and send it load?" | Mode A (load-test) |
| "Do you have a specific function whose cost you want to know?" | Mode C (micro-benchmark) |
| None of the above | Fall back to `rust-perf` (static) |

State the mode before doing anything else. Each mode has a different toolkit and output.

---

## Mode A — Load test + profiler

### Step 1: build a profilable binary

`[profile.release]` with `strip = true` makes flamegraphs unreadable. Build a variant with debuginfo preserved:

```toml
[profile.release-with-debug]
inherits = "release"
debug = true
strip = false
```

```bash
cargo build --profile release-with-debug
```

### Step 2: choose a profiler

| Tool | Best for | Install |
|---|---|---|
| `samply` | CPU sampling, Firefox Profiler UI, cross-platform | `cargo install --locked samply` |
| `cargo flamegraph` | Classic flamegraph SVG, Linux perf-based | `cargo install flamegraph` (needs `perf` on Linux, `dtrace` on mac) |
| `dhat` | Heap allocations, peak memory, drain | Crate dep + `DhatAlloc` global allocator |
| `heaptrack` (Linux only) | Alloc tracking w/ GUI | distro pkg |
| `tokio-console` | Async task state — stuck tasks, starved tasks, poll times | `console-subscriber` dep |
| `cargo-show-asm` | Inspect assembly of a specific fn | `cargo install cargo-show-asm` |
| `bytehound` | Alloc profiler with low overhead | separate install |

**Default recommendation:** `samply` for CPU, `dhat` for allocations, `tokio-console` for async.

### Step 3: choose a load generator

| Protocol | Tool |
|---|---|
| HTTP | `vegeta`, `wrk`, `k6`, `oha` |
| gRPC | `ghz` |
| Raw TCP | `tcpkali` |
| PostgreSQL | `pgbench` |

Define:
- **Arrival rate** (fixed RPS) — better for latency measurement than closed-loop
- **Duration** — minimum 60s to stabilize, 5+ min for reliable tail
- **Payload** — realistic distribution (not one synthetic payload)
- **Warmup** — at least 30s discarded before measuring

### Step 4: run baseline

```bash
# Terminal 1: binary under profiler
samply record ./target/release-with-debug/app

# Terminal 2: load
vegeta attack -rate=200 -duration=5m -targets=targets.txt | vegeta report
# or
ghz --insecure --proto ./api.proto --call pkg.Service/Method \
    -d @payload.json -c 50 -n 30000 localhost:50051
```

**Save the baseline.** Commit the load profile, targets, and report.

### Step 5: read the flamegraph

- **Width = CPU time spent.** Start with the widest bars that are your code (not syscalls/runtime).
- **Don't optimize what's already narrow** — 0.5% of time can't become 0%.
- Follow the stack up: is the cost inside your handler, inside a lib call, inside serde, inside tokio? Each suggests different fixes.
- Look for **unexpected** tall stacks — frames you didn't know your code reached.

Common flamegraph findings:
- `serde_json::...::deserialize` is wide → large JSON in hot path, consider schema pruning or binary format
- `sqlx::...` is wide → DB-bound; go to `EXPLAIN ANALYZE`, not the Rust code
- `memcpy`/`__memmove` is wide → excessive buffer copying, look for `.clone()` on large types
- `drop_in_place` is wide → large owned types; consider sharing via `Arc` or `Bytes`
- `<tokio runtime>` is wide → task scheduling overhead, check task granularity

### Step 6: read the heap profile

With `dhat`:
- **Total bytes allocated** (lifetime) vs **peak heap** — different stories
- Top allocating call sites — usually 5–10 sites dominate
- Short-lived allocations in a hot loop = candidate for buffer reuse / `with_capacity`

### Step 7: read tokio-console (if async-bound)

- Tasks with high **poll count** but low **poll duration** → thrashing
- Tasks with long **self duration** → blocking work in async context
- Tasks stuck in `Idle` → awaiting resources (DB pool, lock)

---

## Mode B — Existing observability

If the user has traces/metrics/logs (OTLP, Prometheus, Loki, Datadog, Honeycomb, etc.), start there. Often the data to identify the bottleneck already exists.

### Step 1: frame the question

- What's the SLO being missed? (p99 latency > 500ms on endpoint X)
- Over what time window?
- Is it constant, periodic, or bursty?

### Step 2: queries to run

**Latency breakdown by span** (OTLP / APM):
- Rank child spans by contribution to parent duration
- p99 of parent vs p99 of children — if children fast and parent slow, time is between spans (lock wait, scheduling)

**Metric cardinality & volume:**
- Which metrics have most series? (high cardinality = export cost + scrape cost)
- Which spans emit most frequently? (high-rate spans can cost > 10% CPU alone)

**Log patterns:**
- Error spikes correlated with latency
- Warnings from connection pools (`timed out waiting for connection`, `max_connections reached`) — pool sizing
- Retry/backoff logs — dependent service slow or unavailable

**Resource correlations:**
- CPU saturation → compute-bound → profile the hot binary
- Memory climb → leak or unbounded cache / channel
- DB CPU high → N+1 or missing index
- Network saturation → payload size, compression off

### Step 3: the observability checklist

| Signal | What it suggests |
|---|---|
| p99 >> p95 >> median | Tail issue — lock contention, GC-like pause, cold cache. Look at a single slow trace. |
| Similar latency at p50 and p99 | Uniform slowness — algorithmic or saturated resource |
| Latency scales with concurrency | Shared resource contention (DB, lock, channel) |
| Latency flat with concurrency | Per-request cost — profile CPU |
| CPU high, latency high | Compute-bound — profile, static-analyze |
| CPU low, latency high | I/O or blocking-wait bound — DB, downstream service, lock |
| Memory monotonically increasing | Leak or unbounded growth — heap profile |
| Allocation rate very high | GC pressure equivalent (Rust: allocator contention) — dhat |

### Step 4: pick one slow trace and read it

Don't average. Find one slow request, open the trace, walk the spans in time order. Usually one span dominates — that's the target.

---

## Mode C — Micro-benchmark with criterion

For "is this function faster if I change X?" questions.

### Setup

```toml
[dev-dependencies]
criterion = { version = "0.5", features = ["html_reports"] }

[[bench]]
name = "my_hot_fn"
harness = false
```

```rust
// benches/my_hot_fn.rs
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn bench(c: &mut Criterion) {
    let input = setup();
    c.bench_function("my_hot_fn", |b| {
        b.iter(|| my_hot_fn(black_box(&input)))
    });
}

criterion_group!(benches, bench);
criterion_main!(benches);
```

### Workflow

```bash
# Baseline before any changes:
cargo bench --bench my_hot_fn -- --save-baseline before

# Make change, then compare:
cargo bench --bench my_hot_fn -- --baseline before
```

Criterion reports will show % change + statistical significance. Ignore changes with high variance or p > 0.05.

### Pitfalls

- **Always use `black_box`** on inputs — without it, the compiler may constant-fold your benchmark away.
- **Include realistic data.** A `Vec<i32>` of length 10 with small ints doesn't predict behavior on real workloads.
- **Warm up.** Criterion does this by default, but verify via the HTML report.
- **Don't benchmark async with `block_on`.** Use `tokio::runtime::Runtime::block_on` inside a sync bench fn, or `criterion-async`.

---

## Phase 2 — Analysis & prioritization

Regardless of mode, cost-model findings before recommending fixes:

```
impact = (time_per_call OR bytes_per_call)
       × call_rate_per_second
       × criticality (1.0 for per-request, 0.1 for background, 0.01 for startup)
```

A 10ms function called 1/s on a background task costs 10ms/s = 1% of one core. Not worth optimizing unless it's free.

A 50μs function on the request path at 1000 RPS costs 50ms/s = 5% of one core. Worth it.

---

## Phase 3 — Close the loop

Every measured finding must end with:

1. **Baseline number** (before)
2. **Proposed change**
3. **Re-measurement** (after)
4. **Delta with confidence** — "p99 dropped from 420ms to 280ms, ±10ms, over 5-min runs"
5. **Regression check** — was anything else impacted?

If the change doesn't show in measurement, **revert it**. A change that looks right but doesn't move the number is usually masking itself or indicating the hot path is elsewhere.

---

## Output format

### 1. Mode & baseline

State mode (A/B/C), measurement window, tool used, and the **numeric baseline** (p50/p99/peak-rss/RPS/whatever's relevant).

### 2. Bottleneck hypothesis

From the data (flamegraph / trace / heap / bench), the top N contributors to the measured cost. With percentages.

> Example: "In CPU flamegraph (5-min, 200 RPS), `serde_json::from_slice` accounts for 23% of self-time, concentrated in `handlers::create_invoice`. Next: `sqlx::encode` at 11%."

### 3. Proposed interventions

Ranked by expected impact × risk. For each:
- Intervention
- Expected delta (based on the measurement)
- How to verify (specific bench/load-test invocation)

### 4. Verification plan

```bash
# Baseline (already captured)
# ...

# After fix — must re-run same load profile
vegeta attack -rate=200 -duration=5m -targets=targets.txt | vegeta report
cargo bench --bench X -- --baseline before
```

### 5. What the measurement rules out

Things that looked suspicious in a static review but the profile shows are cold / not worth touching. This is valuable — saves wasted work.

> Example: "Multiple `.clone()` calls in `tenant_iam::audit` flagged by `rust-perf`, but heap profile shows audit path accounts for <0.3% of allocations. Skip."

---

## Anti-patterns in measurement output

Do **not**:
- Report "faster" without a number and a baseline
- Mix measurement windows (comparing 1-min run to 5-min run is not a comparison)
- Chase micro-optimizations while leaving a 50% dominant frame untouched
- Use optimization build (`lto = "fat"`) for micro-benchmarks that you'll then apply to non-LTO builds — they won't transfer
- Instrument-profile hot loops (changes what you measure); use sampling
- Make multiple changes between measurements
- Discard "noisy" measurements without investigating why they're noisy — noise itself is often a finding (GC-like pauses, scheduler issues, interference)

---

## When to hand back to `rust-perf` (static)

If measurement shows:
- Hot allocation sites in known anti-patterns → static audit of those files
- Hot DB query → static query audit + `EXPLAIN ANALYZE`
- Obvious sync-in-async or similar code smell in the flamegraph → static audit

The two skills compose: static narrows suspects, dynamic confirms impact, static guides the fix.
