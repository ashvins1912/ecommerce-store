import 'dotenv/config';
import mongoose from 'mongoose';
import { initDatabase } from '../../src/server/services/store.js';
import { runLogisticsWorker } from './queue-poller.js';
import { createShippingServiceApp } from './app.js';

const PORT = Number(process.env.SHIPPING_SERVICE_PORT || process.env.PORT || 4020);
const QUEUE_POLLING_ENABLED = process.env.ENABLE_QUEUE_POLLING === '1' || process.env.ENABLE_QUEUE_WORKER === '1';

async function main() {
  if (QUEUE_POLLING_ENABLED || process.env.MONGODB_URI?.trim()) {
    const dbStatus = await initDatabase();
    if (QUEUE_POLLING_ENABLED && dbStatus.mode !== 'mongodb' && process.env.NODE_ENV === 'production') {
      throw new Error('SHIPPING_WORKER_MONGODB_REQUIRED_IN_PRODUCTION');
    }
  }
  const app = createShippingServiceApp({ workerEnabled: QUEUE_POLLING_ENABLED });
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Shipping Service listening on http://0.0.0.0:${PORT} (queuePolling: ${QUEUE_POLLING_ENABLED})`);
  });
  if (QUEUE_POLLING_ENABLED) void runLogisticsWorker().catch((error) => console.error('Shipping queue poller stopped unexpectedly:', error));
  const shutdown = (signal: string) => {
    console.log(`Shipping Service received ${signal}; closing gracefully.`);
    server.close(async () => { await mongoose.disconnect().catch(() => {}); process.exit(0); });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
main().catch((err) => { console.error('Shipping Service failed to start:', err); process.exit(1); });
