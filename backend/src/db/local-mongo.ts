import { MongoMemoryServer } from 'mongodb-memory-server';

async function startLocalMongo() {
  console.log('[Local Mongo] Initializing standalone local MongoDB instance on port 27017...');
  try {
    const mongoServer = await MongoMemoryServer.create({
      instance: {
        port: 27017,
        dbName: 'toowix_mail',
      },
    });

    console.log('[Local Mongo] Successfully running at:', mongoServer.getUri());
    console.log('[Local Mongo] Listening on 127.0.0.1:27017 (toowix_mail)');
    console.log('[Local Mongo] Leave this terminal window open while testing.');

    process.on('SIGINT', async () => {
      console.log('\n[Local Mongo] Stopping...');
      await mongoServer.stop();
      process.exit(0);
    });
  } catch (err: any) {
    console.error('[Local Mongo Error]:', err.message);
    process.exit(1);
  }
}

startLocalMongo();
