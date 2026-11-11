# Architecture decision records

Each record captures one decision: the context that forced it, the choice, the alternatives that were rejected, and the consequences the team has to live with. Records are never deleted — when a decision is reversed, the old record is marked **Superseded** and a new one is added.

| #                                              | Decision                                                                                                                                                                                                           | Status   | Shipped in |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ---------- |
| [0001](0001-phase-4a-ingestion-and-vision.md)  | Multimodal ingestion and vision architecture — one parse pipeline (magic-byte detection, per-format parsers, OCR, vision descriptions) feeding a single `documents` row, with provenance stored alongside the text | Accepted | `v0.4.6`   |
| [0002](0002-approximate-retrieval-at-scale.md) | Approximate retrieval at scale — per-dimension pgvector HNSW indexes, chunk-level workspace isolation and a measured load envelope instead of exact scans                                                          | Accepted | `v0.4.8`   |
| [0003](0003-document-storage-abstraction.md)   | Document storage abstraction — a narrow `StorageDriver` (local disk or S3-compatible) behind `materialize`, so every parser keeps reading local files                                                              | Accepted | `v0.4.9`   |
| [0004](0004-learning-portal-shell.md)          | Learning-portal shell — Home aggregates every topic, Topics is the primary object and a topic has Learn / Practice / Voice / Language modes instead of tabs                                                        | Accepted | `v0.4.11`  |
| [0005](0005-brand-identity.md)                 | Brand identity — the braid mark, a lowercase Inter Tight wordmark shipped as outlines, one violet point, and SVG masters with generated rasters                                                                    | Accepted | unreleased |

## Writing a record

1. Copy the structure of the most recent record: a title with the number and the decision, then status, date and phase, then **Context**, **Decisions** (numbered, each with _Why_ and _Consequences_), **Alternatives considered** and **Verification**.
2. Add the record to the table above.
3. Reference the record from the pull request, the changelog entry and any documentation it changes.
4. Never rewrite history: if a decision changes, mark the old record **Superseded by 000N** and write the new one.
