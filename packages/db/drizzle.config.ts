import { loadRootEnv } from '@nexter/config';
import { defineConfig } from 'drizzle-kit';

loadRootEnv();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/nexter',
  },
  verbose: true,
  strict: true,
});
