# Performance Baselines

This directory contains JSONL files with performance benchmark results for the Seme memory system.

## Format

Each line in `baseline.jsonl` is a JSON object with:
- `timestamp`: ISO-8601 UTC timestamp of the benchmark run
- `label`: human-readable label for this baseline (e.g., "v1-tonight-baseline", "post-sleep-job")
- `git_commit`: short git commit hash
- `store_size`: { memories, turns, episodes } counts at benchmark time
- `results`: object keyed by operation name, each with count, min/mean/p50/p95/p99/max in ms

## Adding a new baseline

Run the benchmark and append a new line:
```bash
node dist/benchmarks/perf.js  # prints results
# Then append to perf/baseline.jsonl with updated numbers
```

Or use the helper script:
```bash
npm run bench:baseline -- --label "my-label"
```

## Comparing baselines

```bash
# View all baselines
cat perf/baseline.jsonl | python3 -m json.tool

# Compare two baselines
python3 -c "
import json
lines = [json.loads(l) for l in open('perf/baseline.jsonl')]
for l in lines:
    print(l['label'], l['results']['retrieve_context']['p99_ms'])
"
```