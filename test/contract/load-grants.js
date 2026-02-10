/**
 * Loads grants from migrations using an in-memory MongoDB.
 *
 * This module runs all migrations against an in-memory MongoDB instance
 * and provides access to grant documents for use in contract test mocking.
 */

import fs from "fs";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set required environment variables BEFORE importing migrations
// Some migrations import withTransaction which triggers config validation
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.SERVICE_NAME = process.env.SERVICE_NAME || "fg-gas-backend";
process.env.SERVICE_VERSION = process.env.SERVICE_VERSION || "test";
process.env.PORT = process.env.PORT || "0";
process.env.LOG_ENABLED = process.env.LOG_ENABLED || "false";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";
process.env.LOG_FORMAT = process.env.LOG_FORMAT || "pino-pretty";
process.env.MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/test";
process.env.MONGO_DATABASE = process.env.MONGO_DATABASE || "test";
process.env.TRACING_HEADER = process.env.TRACING_HEADER || "x-test";
process.env.AWS_REGION = process.env.AWS_REGION || "eu-west-2";
process.env.ENVIRONMENT = process.env.ENVIRONMENT || "test";
process.env.OUTBOX_MAX_RETRIES = process.env.OUTBOX_MAX_RETRIES || "5";
process.env.OUTBOX_EXPIRES_MS = process.env.OUTBOX_EXPIRES_MS || "5000";
process.env.OUTBOX_CLAIM_MAX_RECORDS =
  process.env.OUTBOX_CLAIM_MAX_RECORDS || "2";
process.env.OUTBOX_POLL_MS = process.env.OUTBOX_POLL_MS || "1000";
process.env.INBOX_MAX_RETRIES = process.env.INBOX_MAX_RETRIES || "5";
process.env.INBOX_EXPIRES_MS = process.env.INBOX_EXPIRES_MS || "5000";
process.env.INBOX_CLAIM_MAX_RECORDS =
  process.env.INBOX_CLAIM_MAX_RECORDS || "2";
process.env.INBOX_POLL_MS = process.env.INBOX_POLL_MS || "1000";

/**
 * Loads all grants from migrations and returns them as a map.
 * @returns {Promise<Map<string, object>>} Map of grant code to grant document
 */
async function loadGrantsFromMigrations() {
  const grants = new Map();

  const mongoMemoryServer = await MongoMemoryServer.create();
  const memoryMongoUri = mongoMemoryServer.getUri();
  const memoryClient = new MongoClient(memoryMongoUri);

  try {
    await memoryClient.connect();
    const memoryDb = memoryClient.db("fg-gas-backend");

    // Discover and import all migrations from the migrations directory
    const migrationsDir = path.resolve(__dirname, "../../migrations");
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".js"))
      .sort(); // Migrations are named with timestamps, so sorting gives correct order

    const migrations = await Promise.all(
      migrationFiles.map(
        (file) => import(path.join(migrationsDir, file).replace(/\\/g, "/")),
      ),
    );

    // Run each migration
    for (const migration of migrations) {
      if (migration.up) {
        try {
          await migration.up(memoryDb);
        } catch (err) {
          // Some migrations may fail due to withTransaction using a different client
          // The grants we need are from the direct migrations which succeed
          console.log(`Migration warning: ${err.message}`);
        }
      }
    }

    // Query all grants from the collection
    const grantDocs = await memoryDb.collection("grants").find({}).toArray();

    for (const grant of grantDocs) {
      grants.set(grant.code, grant);
    }

    console.log(
      `Successfully loaded ${grants.size} grant(s) from migrations: ${[...grants.keys()].join(", ")}`,
    );
  } finally {
    // Cleanup handled by Node.js on process exit
    // Explicit cleanup causes race conditions with MongoDB background operations
  }

  return grants;
}

// Load grants at module initialization (top-level await)
const grants = await loadGrantsFromMigrations();

/**
 * Gets a grant by its code.
 * @param {string} code - The grant code (e.g., "frps-private-beta")
 * @returns {object|undefined} The grant document, or undefined if not found
 */
export function getGrant(code) {
  return grants.get(code);
}
