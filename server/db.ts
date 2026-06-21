import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedDemoData } from "./seed.js";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(serverDir, "..");

export type CreateDatabaseOptions = {
  dbPath?: string;
  seed?: boolean;
};

export function getDefaultDbPath() {
  return process.env.KOL_SELECTION_DB || path.join(appRoot, "server", "data", "kol-selection.sqlite");
}

export function createDatabase(options: CreateDatabaseOptions = {}) {
  const dbPath = options.dbPath ?? getDefaultDbPath();
  if (dbPath !== ":memory:") {
    const dbDir = path.dirname(dbPath);
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  if (options.seed !== false) seedDemoData(db);
  return db;
}

function runMigrations(db: DatabaseSync) {
  const migrationDir = path.join(appRoot, "server", "migrations");
  const migrationFiles = readdirSync(migrationDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    const sql = readFileSync(path.join(migrationDir, file), "utf8");
    db.exec(sql);
  }
}
