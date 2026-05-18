#!/usr/bin/env bash
set -euo pipefail

# Dump Harold visitor data for debugging.
#
# Usage:
#   ./scripts/inspect-harold.sh <visitorId> [command]
#
# Commands:
#   all             Everything useful for a visitor (default)
#   messages        Full message rows for the visitor
#   visitor-tables  Every table with a visitor_id column
#   schema          Tables, columns, indexes, and constraints
#   db              Database/time/row-count overview
#   migrations      Applied Drizzle migrations
#   future          Known future Harold tables if present

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

VISITOR_ID="${1:-}"
CMD="${2:-all}"

if [[ -z "$VISITOR_ID" || "$VISITOR_ID" == "-h" || "$VISITOR_ID" == "--help" ]]; then
  echo "Usage: $0 <visitorId> [all|messages|visitor-tables|schema|db|migrations|future]"
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" && -f "$PROJECT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env.local"
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Error: DATABASE_URL is not set. Add it to .env.local or export it."
  exit 1
fi

node --input-type=module - "$VISITOR_ID" "$CMD" <<'NODE'
import { neon } from "@neondatabase/serverless";

const visitorId = process.argv[2];
const command = process.argv[3] ?? "all";
const sql = neon(process.env.DATABASE_URL);
const knownFutureTables = ["runs", "memory", "harold_state"];

function section(title) {
  console.log();
  console.log(`=== ${title} ===`);
}

function dump(value) {
  console.log(JSON.stringify(value, null, 2));
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function qualifiedTableName(table) {
  return `${quoteIdentifier(table.table_schema)}.${quoteIdentifier(table.table_name)}`;
}

async function tableExists(tableName, tableSchema = "public") {
  const rows = await sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = ${tableSchema}
        AND table_name = ${tableName}
    ) AS exists
  `;
  return rows[0]?.exists === true;
}

async function getVisitorTables() {
  return sql`
    SELECT table_schema, table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'visitor_id'
    ORDER BY table_schema, table_name
  `;
}

async function showDbOverview() {
  section("Database Overview");
  const [nowRows, tables, counts] = await Promise.all([
    sql`SELECT now() AS database_time, current_database() AS database_name`,
    sql`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name
    `,
    sql`
      SELECT relname AS table_name, n_live_tup AS estimated_rows
      FROM pg_stat_user_tables
      ORDER BY relname
    `,
  ]);

  dump({
    visitorId,
    command,
    database: nowRows[0],
    tables: tables.map((row) => `${row.table_schema}.${row.table_name}`),
    estimatedRows: counts,
  });
}

async function showSchema() {
  section("Schema");
  const [columns, indexes, constraints] = await Promise.all([
    sql`
      SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name, ordinal_position
    `,
    sql`
      SELECT tablename AS table_name, indexname AS index_name, indexdef
      FROM pg_indexes
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY schemaname, tablename, indexname
    `,
    sql`
      SELECT conrelid::regclass::text AS table_name, conname AS constraint_name, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
      ORDER BY conrelid::regclass::text, conname
    `,
  ]);

  dump({ columns, indexes, constraints });
}

async function showMessages() {
  section("Messages");
  if (!(await tableExists("messages"))) {
    console.log("messages table does not exist.");
    return;
  }

  const rows = await sql`
    SELECT *
    FROM messages
    WHERE visitor_id = ${visitorId}
    ORDER BY created_at ASC, id ASC
  `;

  dump({
    count: rows.length,
    rows,
  });
}

async function showVisitorTables() {
  section("Visitor-Scoped Tables");
  const tables = await getVisitorTables();

  if (tables.length === 0) {
    console.log("No tables with a visitor_id column found.");
    return;
  }

  const result = {};
  for (const table of tables) {
    const tableName = table.table_name;
    const rows = await sql.query(`SELECT * FROM ${qualifiedTableName(table)} WHERE visitor_id = $1 ORDER BY 1`, [visitorId]);
    result[`${table.table_schema}.${tableName}`] = {
      count: rows.length,
      rows,
    };
  }

  dump(result);
}

async function showMigrations() {
  section("Drizzle Migrations");
  const exists = await tableExists("__drizzle_migrations", "drizzle");

  if (!exists) {
    console.log("drizzle.__drizzle_migrations table does not exist.");
    return;
  }

  const rows = await sql`
    SELECT *
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at ASC
  `;

  dump({
    count: rows.length,
    rows,
  });
}

async function showFutureTables() {
  section("Known Future Tables");
  const result = {};

  for (const tableName of knownFutureTables) {
    const exists = await tableExists(tableName);
    result[tableName] = { exists };

    if (!exists) {
      continue;
    }

    if (tableName === "harold_state") {
      const rows = await sql`SELECT * FROM harold_state WHERE visitor_id = ${visitorId}`;
      result[tableName].rows = rows;
      result[tableName].count = rows.length;
      continue;
    }

    const rows = await sql.query(`SELECT * FROM ${qualifiedTableName({ table_schema: "public", table_name: tableName })} WHERE visitor_id = $1 ORDER BY 1`, [visitorId]);
    result[tableName].rows = rows;
    result[tableName].count = rows.length;
  }

  dump(result);
}

const commands = {
  async all() {
    await showDbOverview();
    await showSchema();
    await showMigrations();
    await showVisitorTables();
    await showMessages();
    await showFutureTables();
  },
  messages: showMessages,
  "visitor-tables": showVisitorTables,
  schema: showSchema,
  db: showDbOverview,
  migrations: showMigrations,
  future: showFutureTables,
};

if (!commands[command]) {
  console.error(`Unknown command: ${command}`);
  console.error("Usage: inspect-harold.sh <visitorId> [all|messages|visitor-tables|schema|db|migrations|future]");
  process.exit(1);
}

await commands[command]();
NODE
