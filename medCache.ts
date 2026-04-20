import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'med_cache.db');
const db = new Database(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS medicine_cache (
    name TEXT PRIMARY KEY,
    dosage TEXT,
    instructions TEXT,
    schedule TEXT,
    form TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS extraction_cache (
    hash TEXT PRIMARY KEY,
    data TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export const getCachedMedicine = db.prepare('SELECT * FROM medicine_cache WHERE name = ?');
export const setCachedMedicine = db.prepare(`
  INSERT INTO medicine_cache (name, dosage, instructions, schedule, form)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(name) DO UPDATE SET
    dosage = excluded.dosage,
    instructions = excluded.instructions,
    schedule = excluded.schedule,
    form = excluded.form,
    updated_at = CURRENT_TIMESTAMP
`);

export const getExtractionData = db.prepare('SELECT data FROM extraction_cache WHERE hash = ?');
export const setExtractionData = db.prepare(`
  INSERT INTO extraction_cache (hash, data)
  VALUES (?, ?)
  ON CONFLICT(hash) DO UPDATE SET
    data = excluded.data,
    updated_at = CURRENT_TIMESTAMP
`);

export default db;
