import { defineConfig } from 'drizzle-kit';

// Only `drizzle-kit generate` is used (it needs no database); the app applies migrations at startup.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
