import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'

// ── Types ────────────────────────────────────────────────────────────────────

export interface MemoryRow {
  id: string
  type: 'capture' | 'preference' | 'decision' | 'identity' | 'synthesis'
  content: string
  summary: string
  embedding: Buffer | null
  source_id: string | null
  tags: string // JSON array
  importance: number
  created_at: number
  accessed_at: number
  access_count: number
  superseded_by: string | null
}

export interface IdentityRow {
  key: string
  value: string
  evidence: string // JSON array of memory IDs
  confidence: number
  updated_at: number
}

export interface SynthesisLogRow {
  id: string
  run_date: string
  type: 'daily' | 'weekly'
  input_memory_ids: string // JSON array
  output_memory_ids: string // JSON array
  identity_updates: string // JSON array
  created_at: number
}

// ── Database ─────────────────────────────────────────────────────────────────

let db: Database.Database | null = null

function getDbPath(): string {
  const dir = join(app.getPath('userData'), 'attacca-memory')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'memory.db')
}

export function getMemoryDb(): Database.Database {
  if (!db) {
    db = new Database(getDbPath())
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initSchema(db)
  }
  return db
}

export function closeMemoryDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('capture','preference','decision','identity','synthesis')),
      content TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      embedding BLOB,
      source_id TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      importance REAL NOT NULL DEFAULT 0.5,
      created_at INTEGER NOT NULL,
      accessed_at INTEGER NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 0,
      superseded_by TEXT
    );

    CREATE TABLE IF NOT EXISTS identity (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 0.5,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS synthesis_log (
      id TEXT PRIMARY KEY,
      run_date TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('daily','weekly')),
      input_memory_ids TEXT NOT NULL DEFAULT '[]',
      output_memory_ids TEXT NOT NULL DEFAULT '[]',
      identity_updates TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
    CREATE INDEX IF NOT EXISTS idx_memories_superseded ON memories(superseded_by);
  `)

  // Check if embedding dimension migration is needed
  triggerEmbeddingMigration(database)
}

// ── Embedding Migration ─────────────────────────────────────────────────────

function triggerEmbeddingMigration(database: Database.Database): void {
  // Use shared constant directly — no circular dependency
  const DIMS = 384 // must match EMBEDDING_DIMS in lib/constants.ts
  const row = database.prepare('SELECT value FROM meta WHERE key = ?').get('embedding_dims') as
    | { value: string }
    | undefined
  if (row && row.value === String(DIMS)) return // already migrated

  // Trigger async migration — does not block startup
  import('./migrate-embeddings')
    .then((m) => m.migrateEmbeddings())
    .then((result) => {
      console.log(
        `[memory] Embedding migration: ${result.migrated} migrated, ${result.failed} failed`
      )
      database
        .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
        .run('embedding_dims', String(DIMS))
    })
    .catch((err) => {
      console.warn('[memory] Embedding migration failed:', err)
    })
}

// ── CRUD Operations ──────────────────────────────────────────────────────────

export function insertMemory(memory: Omit<MemoryRow, 'accessed_at' | 'access_count'>): void {
  const db = getMemoryDb()
  db.prepare(
    `
    INSERT OR REPLACE INTO memories (id, type, content, summary, embedding, source_id, tags, importance, created_at, accessed_at, access_count, superseded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `
  ).run(
    memory.id,
    memory.type,
    memory.content,
    memory.summary,
    memory.embedding,
    memory.source_id,
    memory.tags,
    memory.importance,
    memory.created_at,
    memory.created_at,
    memory.superseded_by
  )
}

export function getMemory(id: string): MemoryRow | undefined {
  return getMemoryDb().prepare('SELECT * FROM memories WHERE id = ?').get(id) as
    | MemoryRow
    | undefined
}

export function getActiveMemories(type?: string, limit = 100): MemoryRow[] {
  const db = getMemoryDb()
  if (type) {
    return db
      .prepare(
        'SELECT * FROM memories WHERE type = ? AND superseded_by IS NULL ORDER BY created_at DESC LIMIT ?'
      )
      .all(type, limit) as MemoryRow[]
  }
  return db
    .prepare('SELECT * FROM memories WHERE superseded_by IS NULL ORDER BY created_at DESC LIMIT ?')
    .all(limit) as MemoryRow[]
}

export function getMemoriesWithEmbeddings(): Array<{
  id: string
  embedding: Buffer
  importance: number
  accessed_at: number
}> {
  return getMemoryDb()
    .prepare(
      'SELECT id, embedding, importance, accessed_at FROM memories WHERE embedding IS NOT NULL AND superseded_by IS NULL'
    )
    .all() as Array<{ id: string; embedding: Buffer; importance: number; accessed_at: number }>
}

export function updateEmbedding(id: string, embedding: Buffer): void {
  getMemoryDb().prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(embedding, id)
}

export function markAccessed(ids: string[]): void {
  const db = getMemoryDb()
  const stmt = db.prepare(
    'UPDATE memories SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?'
  )
  const now = Date.now()
  const tx = db.transaction(() => {
    for (const id of ids) stmt.run(now, id)
  })
  tx()
}

export function supersedeMemory(oldId: string, newId: string): void {
  getMemoryDb().prepare('UPDATE memories SET superseded_by = ? WHERE id = ?').run(newId, oldId)
}

export function getMemoriesSince(since: number, type?: string): MemoryRow[] {
  const db = getMemoryDb()
  if (type) {
    return db
      .prepare(
        'SELECT * FROM memories WHERE created_at >= ? AND type = ? AND superseded_by IS NULL ORDER BY created_at ASC'
      )
      .all(since, type) as MemoryRow[]
  }
  return db
    .prepare(
      'SELECT * FROM memories WHERE created_at >= ? AND superseded_by IS NULL ORDER BY created_at ASC'
    )
    .all(since) as MemoryRow[]
}

export function getMemoryStats(): {
  total: number
  byType: Record<string, number>
  withEmbeddings: number
} {
  const db = getMemoryDb()
  const total = (
    db.prepare('SELECT COUNT(*) as c FROM memories WHERE superseded_by IS NULL').get() as {
      c: number
    }
  ).c
  const withEmbeddings = (
    db
      .prepare(
        'SELECT COUNT(*) as c FROM memories WHERE embedding IS NOT NULL AND superseded_by IS NULL'
      )
      .get() as { c: number }
  ).c
  const byTypeRows = db
    .prepare('SELECT type, COUNT(*) as c FROM memories WHERE superseded_by IS NULL GROUP BY type')
    .all() as Array<{ type: string; c: number }>
  const byType: Record<string, number> = {}
  for (const row of byTypeRows) byType[row.type] = row.c
  return { total, byType, withEmbeddings }
}

export function updateImportance(id: string, newImportance: number): void {
  getMemoryDb().prepare('UPDATE memories SET importance = ? WHERE id = ?').run(newImportance, id)
}

// ── Identity Operations ──────────────────────────────────────────────────────

export function upsertIdentity(
  key: string,
  value: string,
  evidenceIds: string[],
  confidence: number
): void {
  getMemoryDb()
    .prepare(
      `
    INSERT INTO identity (key, value, evidence, confidence, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, evidence = excluded.evidence, confidence = excluded.confidence, updated_at = excluded.updated_at
  `
    )
    .run(key, value, JSON.stringify(evidenceIds), confidence, Date.now())
}

export function getIdentityTraits(minConfidence = 0.4): IdentityRow[] {
  return getMemoryDb()
    .prepare('SELECT * FROM identity WHERE confidence >= ? ORDER BY confidence DESC')
    .all(minConfidence) as IdentityRow[]
}

export function getAllIdentityTraits(): IdentityRow[] {
  return getMemoryDb()
    .prepare('SELECT * FROM identity ORDER BY confidence DESC')
    .all() as IdentityRow[]
}

// ── Synthesis Log ────────────────────────────────────────────────────────────

export function insertSynthesisLog(log: SynthesisLogRow): void {
  getMemoryDb()
    .prepare(
      `
    INSERT INTO synthesis_log (id, run_date, type, input_memory_ids, output_memory_ids, identity_updates, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      log.id,
      log.run_date,
      log.type,
      log.input_memory_ids,
      log.output_memory_ids,
      log.identity_updates,
      log.created_at
    )
}

export function getLastSynthesis(type: 'daily' | 'weekly'): SynthesisLogRow | undefined {
  return getMemoryDb()
    .prepare('SELECT * FROM synthesis_log WHERE type = ? ORDER BY created_at DESC LIMIT 1')
    .get(type) as SynthesisLogRow | undefined
}
