/**
 * Database setup script
 * Run with: npx tsx scripts/setup-db.ts
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function setupDatabase() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is not set');
    console.error('');
    console.error('Set it in your .env file or export it:');
    console.error('  export DATABASE_URL="postgresql://user:password@localhost:26257/crashproof"');
    process.exit(1);
  }

  console.log('Connecting to database...');

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('cockroachlabs.cloud') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    // Test connection
    await pool.query('SELECT 1');
    console.log('Connected successfully!');

    // Read SQL file
    const sqlPath = join(__dirname, 'setup-db.sql');
    const sql = readFileSync(sqlPath, 'utf-8');

    // Remove comments and split by semicolons
    const cleanSql = sql
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');

    const statements = cleanSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    console.log(`Executing ${statements.length} SQL statements...`);

    for (const statement of statements) {
      try {
        await pool.query(statement);
        // Print first 50 chars of each statement for progress
        const preview = statement.replace(/\s+/g, ' ').slice(0, 50);
        console.log(`  ✓ ${preview}...`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        // Ignore "already exists" errors
        if (msg.includes('already exists') || msg.includes('duplicate')) {
          console.log(`  ⚠ Skipped (already exists): ${statement.slice(0, 40)}...`);
        } else {
          console.error(`  ✗ Failed: ${statement.slice(0, 40)}...`);
          console.error(`    Error: ${msg}`);
        }
      }
    }

    console.log('');
    console.log('Database setup complete!');
  } catch (error) {
    console.error('Failed to connect to database:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setupDatabase();
