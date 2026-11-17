import 'dotenv/config';
import mongoose from 'mongoose';
import { initDatabase } from '../../src/server/services/store.js';
import { createPaymentServiceApp } from './app.js';

const PORT = Number(process.env.PAYMENT_SERVICE_PORT || process.env.PORT || 4010);

async function main() {
  const dbStatus = await initDatabase();
  if (dbStatus.mode !== 'mongodb' && process.env.NODE_ENV === 'production') {
    throw new Error('PAYMENT_SERVICE_MONGODB_REQUIRED_IN_PRODUCTION');
  }
  const app = createPaymentServiceApp();
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Payment Gateway Service listening on http://0.0.0.0:${PORT} (DB mode: ${dbStatus.mode})`);
  });
  const shutdown = (signal: string) => {
    console.log(`Payment Gateway Service received ${signal}; closing gracefully.`);
    server.close(async () => { await mongoose.disconnect().catch(() => {}); process.exit(0); });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
main().catch((err) => { console.error('Payment Gateway Service failed to start:', err); process.exit(1); });
