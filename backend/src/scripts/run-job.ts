import { config } from '../config';
import { connectDatabase, disconnectDatabase } from '../db/connection';
import { runJob } from '../jobs/run-once';

// Usage: npm run job -- <grace|trial|reconcile> [as-of date, e.g. a test clock's 2026-12-04T13:00:00Z]
async function main() {
  await connectDatabase({ uri: config.mongodbUri, autoIndex: true });
  const asOf = process.argv[3] ? new Date(process.argv[3]) : undefined;
  if (asOf && isNaN(asOf.getTime())) throw new Error(`Invalid date "${process.argv[3]}"`);
  console.log(await runJob(process.argv[2], asOf));
}

main()
  .then(async () => {
    await disconnectDatabase();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Fatal error during run-job:', err);
    await disconnectDatabase();
    process.exit(1);
  });
