import { serve } from '@hono/node-server';
import app from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { checkDbConnection } from './config/db.js';

const PORT = Number(env.PORT ?? 3000);

async function start() {
  await checkDbConnection();

  const server = serve({ fetch: app.fetch, port: PORT }, () => {
    logger.info(`Server running on http://localhost:${PORT} [${env.NODE_ENV}]`);
  });

  function shutdown(signal: string) {
    logger.info(`${signal} received — shutting down`);
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { err });
    process.exit(1);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
