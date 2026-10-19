import { config } from '../config';
import { connectDatabase, disconnectDatabase } from '../db/connection';
import { runJob } from '../jobs/run-once';

// Usage: npm run job -- <grace|trial|reconcile>
async function main() {
  await connectDatabase({ uri: config.mongodbUri, autoIndex: true });
  console.log(await runJob(process.argv[2]));
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
