import { initDatabase } from '../../../src/server/services/store.js';
import { runLogisticsWorker } from './run.js';

const db = await initDatabase();
if (db.mode !== 'mongodb' && process.env.NODE_ENV === 'production') {
  throw new Error('PRODUCTION_PRIVACY_POLICY_DATABASE_REQUIRED');
}
await runLogisticsWorker();
