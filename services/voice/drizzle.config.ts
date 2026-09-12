import type { Config } from 'drizzle-kit';

export default {
  schema: './src/store/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env['DATABASE_URL'] ?? 'postgres://eight80:eight80@127.0.0.1:5432/eight80' },
} satisfies Config;
