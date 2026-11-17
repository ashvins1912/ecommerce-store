import 'dotenv/config';
import mongoose from 'mongoose';
import { initDatabase } from '../../../src/server/services/store.js';
import { runLogisticsWorker } from '../../logistics-worker/src/run.js';
import { createShippingServiceApp } from './app.js';

const PORT = Number(process.env.SHIPPING_SERVICE_PORT || process.env.PORT || 4020);
const WORKER_ENABLED = process.env.ENABLE_QUEUE_WORKER === '1';

async function main() {
  if (WORKER_ENABLED || process.env.MONGODB_URI?.trim()) {
    const dbStatus = await initDatabase();
    if (WORKER_ENABLED && dbStatus.mode !== 'mongodb' && process.env.NODE_ENV === 'production') {
      throw new Error('SHIPPING_WORKER_MONGODB_REQUIRED_IN_PRODUCTION');
    }
  }

  const app = createShippingServiceApp({ workerEnabled: WORKER_ENABLED });
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Shipping Services Integration listening on http://0.0.0.0:${PORT} (queueWorker: ${WORKER_ENABLED})`
    );
  });

  if (WORKER_ENABLED) {
    void runLogisticsWorker().catch((error) => {
      console.error('Shipping background queue worker stopped unexpectedly:', error);
    });
  }

  const shutdown = (signal: string) => {
    console.log(`Shipping Services Integration received ${signal}; closing gracefully.`);
    server.close(async () => {
      await mongoose.disconnect().catch(() => {});
      process.exit(0);
    });
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Shipping Services Integration failed to start:', err);
  process.exit(1);
});
