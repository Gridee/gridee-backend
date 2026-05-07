import * as dotenv from 'dotenv';
dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Missing required env var: DATABASE_URL');
}

const isCloudPostgres =
  databaseUrl.includes('neon.tech') || databaseUrl.includes('sslmode=require');

const connection = isCloudPostgres
  ? {
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false },
    }
  : databaseUrl;

export default {
  development: {
    client: 'pg',
    connection,
    migrations: {
      directory: './migrations',
      extension: 'ts',
    },
  },
  test: {
    client: 'pg',
    connection,
    migrations: {
      directory: './migrations',
      extension: 'ts',
    },
  },
  production: {
    client: 'pg',
    connection,
    migrations: {
      directory: './migrations',
      extension: 'ts',
    },
  },
};
