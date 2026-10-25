# 0002 — Approximate retrieval at scale (HNSW, chunk-level workspace)

- **Status:** Accepted
- **Date:** 2026-10-25
- **Phase:** 5 (scale)

## Context

Retrieval filtered by workspace and ordered by cosine distance over
`chunks.embedding`, a dimensionless `vector` column that lets one deployment
store 768/1024/1536/2048/3072-dimension embeddings from different models.
Until now every query was an exact scan plus sort, which is correct but linear:
the README envelope admitted sub-second only up to roughly 100k chunks per
workspace, and the planner had no index to fall back to.

Three constraints forced the shape of the fix:

1. pgvector can only build HNSW on a fixed dimension, and `vector` HNSW stops
   at 2000 dimensions (`halfvec` extends to 4000).
2. The workspace predicate lived only on `documents`, so the planner had to
   join before filtering; with the join it estimated a document-id scan and a
   sort as cheaper than an ANN scan, and never used an index on `chunks`.
3. Filtering after an ANN scan can starve results when the filter is selective
   (many workspaces), which is exactly what a per-workspace query does.

## Decisions

### 1. One partial HNSW index per supported dimension

Migration 0017 backfills `chunks.embedding_dims` from `vector_dims(embedding)`
(previously NULL on legacy rows) and creates partial HNSW indexes over the cast
expression, one per dimension:

```sql
CREATE INDEX chunks_embedding_1536_hnsw_idx
  ON chunks USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
  WHERE embedding_dims = 1536;
```

Retrieval pins the active dimension as a validated integer literal in both the
predicate and the cast, because a bind parameter hides the value from the
partial-index matcher. Dimensions above 2000 use `halfvec` (2048, 3072).

**Why:** one physical column keeps model switching cheap, while per-dimension
partial indexes are empty for the dimensions a deployment does not use — the
cost is only paid when a model of that dimension is actually configured.

**Consequences:** adding a new supported embedding dimension needs a migration
with a matching index (otherwise retrieval silently falls back to an exact
scan); index builds take time and disk on large corpora; `embedding_dims` is
now authoritative, so a legacy row without it is backfilled rather than
matched by `vector_dims()` at query time.

### 2. Denormalise `workspace_id` onto `chunks`

Migration 0018 adds `chunks.workspace_id` (backfilled from the document, FK
cascade, indexed) and the worker writes it on every insert.

**Why:** the ANN scan can only apply the workspace filter when the column is on
the table being scanned. With the filter on `documents`, the planner chose a
document-id scan and a sort (measured 152ms p50 at 20k chunks), never the
index. With the column on `chunks`, the planner uses HNSW when the corpus is
large enough (measured 7ms p50 at 100k chunks).

**Consequences:** the column duplicates `documents.workspace_id`; moving a
document between workspaces (not supported today) would have to update chunks
too; the keyword arm and attached-image lookup also filter on it and get
simpler plans.

### 3. `hnsw.iterative_scan = relaxed_order` at the database level

Migration 0018 sets the pgvector 0.8 setting per database (wrapped in a
`DO` block that skips unsupported versions), so a filtered ANN query keeps
scanning the graph instead of silently returning fewer than `LIMIT` rows.

**Why:** the workspace filter is applied after the graph walk; without
iterative scans a selective filter can return an under-filled result set.

**Consequences:** results are approximate by definition and may include a
slightly different neighbour set than an exact scan; `ef_search` remains the
recall/latency knob (default 40). Older pgvector versions keep exact behaviour.

## Alternatives considered

- **halfvec everywhere** — halves storage and lifts the dimension limit, but
  quantises every embedding even for common dimensions; rejected for now.
- **Per-dimension columns** (`embedding_1536`, `embedding_768`, …) — indexes are
  natural but every insert/backfill has to choose a column, and schema churn
  per model is worse than one migration per dimension.
- **Partitioning chunks by workspace** — would keep filters and ANN together,
  but partitions multiply indexes and complicate global maintenance for a
  single-user deployment.
- **A separate vector store** — rejected: another service, another consistency
  problem, and the personal-corpus envelope does not need it.

## Verification

`scripts/load-test.ts` seeds a synthetic workspace, prints the plan and
percentiles, and removes the workspace. On this machine: 20k chunks @1536 dims
→ exact scan, p50 152ms/p95 179ms; 100k chunks @768 dims → HNSW, p50 7ms/p95
10ms. Numbers are documented in the README envelope table.
