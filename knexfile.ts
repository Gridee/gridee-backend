import * as dotenv from 'dotenv';
dotenv.config();

export default {
  development: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST as string,
      port: parseInt(process.env.DB_PORT as string, 10),
      user: process.env.DB_USER as string,
      password: process.env.DB_PASSWORD as string,
      database: process.env.DB_NAME as string,
    },
    migrations: {
      directory: './migrations',
      extension: 'ts',
    },
  },
};
