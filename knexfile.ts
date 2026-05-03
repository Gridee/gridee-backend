import * as dotenv from 'dotenv';
dotenv.config();

export default {
  development: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    migrations: {
      directory: './migrations',
      extension: 'ts',
    },
  },
  test: {
    client: 'pg',
    connection: process.env.DATABASE_URL || 'postgresql://localhost/gridee_test',
    migrations: {
      directory: './migrations',
      extension: 'ts',
    },
  },
  production: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    migrations: {
      directory: './migrations',
      extension: 'ts',
    },
  },
};
