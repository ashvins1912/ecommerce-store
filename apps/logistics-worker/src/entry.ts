import mongoose from 'mongoose';
import { runLogisticsWorker } from './run.js';

// The worker needs the shared MongoDB models, but must not run the full API
// bootstrap (demo seeding, application index synchronization, etc.).
const requiredEnv = [
  'MONGODB_URI',
  'LOGISTICS_SUPABASE_URL',
  'LOGISTICS_SUPABASE_SERVICE_ROLE_KEY',
  'ENCRYPTION_MASTER_KEY',
] as const;

const missingEnv = requiredEnv.filter((key) => !process.env[key]?.trim());
if (missingEnv.length > 0) {
  throw new Error('LOGISTICS_WORKER_REQUIRED_ENV_MISSING:' + missingEnv.join(','));
}

await mongoose.connect(process.env.MONGODB_URI!.trim(), {
  autoIndex: false,
  maxPoolSize: 5,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 10_000,
});

console.info('Logistics worker MongoDB connection established.');

try {
  await runLogisticsWorker();
} finally {
  await mongoose.disconnect();
  console.info('Logistics worker MongoDB connection closed.');
}
