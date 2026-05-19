/**
 * db.ts owns the Postgres connection pool used by the standalone landing-pages backend.
 * It reads the same DB_* environment shape as apps/server so deployment can reuse the existing runtime secret,
 * while keeping runtime data access inside apps/landing-pages instead of adding server modules.
 */
import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg';

type LandingPromptGlobal = typeof globalThis & {
  __landingPromptPool?: Pool;
};

/**
 * Builds a node-postgres PoolConfig from the shared Kollab database environment variables.
 * This is called by the landing-pages server-only DB singleton and by tests; it does not open a connection.
 * Landing prompt specific overrides let test/prod share the same prompt read model without pointing the whole test
 * namespace at production DB_* values.
 */
export function buildPostgresConfig(env: Record<string, string | undefined> = process.env): PoolConfig {
  const port = Number.parseInt(env.LANDING_PROMPTS_DB_PORT || env.DB_PORT || '5432', 10);
  const sslValue = env.LANDING_PROMPTS_DB_SSL ?? env.DB_SSL ?? env.DATABASE_SSL;
  const sslEnabled = sslValue === 'true';

  return {
    host: env.LANDING_PROMPTS_DB_HOST || env.DB_HOST || 'localhost',
    port: Number.isFinite(port) ? port : 5432,
    user: env.LANDING_PROMPTS_DB_USERNAME || env.DB_USERNAME || env.DB_USER || 'postgres',
    password: env.LANDING_PROMPTS_DB_PASSWORD || env.DB_PASSWORD || 'postgres',
    database: env.LANDING_PROMPTS_DB_DATABASE || env.DB_DATABASE || 'seeds',
    max: Number.parseInt(env.LANDING_PROMPTS_DB_POOL_MAX || '4', 10),
    ...(sslEnabled ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

/**
 * Returns the shared landing prompt Postgres pool.
 * Next.js dev hot reload can re-evaluate modules, so the pool is cached on globalThis to avoid leaking clients
 * while still letting simple route handlers use `pool.query` for one-off reads.
 */
export function getLandingPromptPool(): Pool {
  const landingGlobal = globalThis as LandingPromptGlobal;
  if (!landingGlobal.__landingPromptPool) {
    landingGlobal.__landingPromptPool = new Pool(buildPostgresConfig());
  }

  return landingGlobal.__landingPromptPool;
}

/**
 * Runs a single SQL query through the shared pool.
 * This helper is for non-transactional reads/writes; sync flows that need advisory locks and multiple statements
 * should use `withLandingPromptDbClient` so all queries stay on the same checked-out client.
 */
export async function queryLandingPromptDb<T extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await getLandingPromptPool().query<T>(text, values);
  return result.rows;
}

/**
 * Checks out one Postgres client for a multi-step landing prompt operation.
 * The client is always released in finally so failed Notion/media syncs do not leak database connections.
 */
export async function withLandingPromptDbClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getLandingPromptPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
