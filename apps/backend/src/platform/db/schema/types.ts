import { customType } from 'drizzle-orm/pg-core';

export const vectorDim = customType<{ data: number[]; driverData: string }>({
  dataType: () => 'vector',
  toDriver: (value) => JSON.stringify(value),
  fromDriver: (value) => JSON.parse(value),
});

// Full-text vector populated by the ingestion worker with
// `to_tsvector(<language>, content)`. Never bound from application code; the
// column exists so the GIN index below works for every configured language
// (an expression index on a fixed regconfig cannot serve other languages).

export const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
