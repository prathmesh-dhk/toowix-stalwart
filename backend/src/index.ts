import { app } from './app';
import { config } from './config';
import { connectDatabase } from './db/connection';
import { seedAll } from './db/seed';
import * as dnsPropagationSweepJob from './jobs/dns-propagation-sweep.job';
import * as billingGraceSweepJob from './jobs/billing-grace-sweep.job';

let memoryServer: any = null;

async function startServer() {
  try {
    console.log('[Server] Initializing Toowix Mail Platform Backend...');
    
    // Connect to MongoDB
    let dbUri = config.mongodbUri;
    try {
      await connectDatabase({ uri: dbUri, autoIndex: true });
      console.log('[Server] Connected to MongoDB successfully.');
    } catch (dbErr: any) {
      if (
        config.nodeEnv === 'development' &&
        (dbUri.includes('127.0.0.1:27017') || dbUri.includes('localhost:27017'))
      ) {
        console.warn('\n[Server] ----------------------------------------------------');
        console.warn('[Server] No running MongoDB found at ' + dbUri);
        console.warn('[Server] Auto-starting embedded local MongoDB instance for development...');
        const { MongoMemoryServer } = await import('mongodb-memory-server');
        try {
          memoryServer = await MongoMemoryServer.create({
            instance: { port: 27017, dbName: 'toowix_mail' },
          });
          dbUri = memoryServer.getUri();
        } catch {
          memoryServer = await MongoMemoryServer.create({
            instance: { dbName: 'toowix_mail' },
          });
          dbUri = memoryServer.getUri();
        }
        await connectDatabase({ uri: dbUri, autoIndex: true });
        console.log(`[Server] Connected to embedded in-memory MongoDB at: ${dbUri}`);
        console.warn('[Server] ----------------------------------------------------\n');
      } else {
        throw dbErr;
      }
    }

    // Seed initial Super Admin and System Settings if not present
    await seedAll();

    dnsPropagationSweepJob.start();
    billingGraceSweepJob.start();

    const server = app.listen(config.port, () => {
      console.log(`[Server] Toowix Mail Backend listening on http://localhost:${config.port}`);
      console.log(`[Server] Stalwart Engine target: ${config.stalwart.url}`);
      console.log(`[Server] Health check available at http://localhost:${config.port}/healthz`);
    });

    const shutdown = async () => {
      console.log('\n[Server] Shutting down gracefully...');
      dnsPropagationSweepJob.stop();
      billingGraceSweepJob.stop();
      server.close();
      if (memoryServer) {
        await memoryServer.stop();
      }
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('[Server] Fatal startup error:', err);
    process.exit(1);
  }
}

startServer();
