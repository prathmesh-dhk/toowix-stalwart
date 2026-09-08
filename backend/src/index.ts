import { app } from './app';
import { config } from './config';
import { connectDatabase } from './db/connection';
import { seedAll } from './db/seed';

async function startServer() {
  try {
    console.log('[Server] Initializing Toowix Mail Platform Backend...');
    
    // Connect to MongoDB
    await connectDatabase({ uri: config.mongodbUri, autoIndex: true });
    console.log('[Server] Connected to MongoDB successfully.');

    // Seed initial Super Admin and System Settings if not present
    await seedAll();

    app.listen(config.port, () => {
      console.log(`[Server] Toowix Mail Backend listening on http://localhost:${config.port}`);
      console.log(`[Server] Health check available at http://localhost:${config.port}/healthz`);
    });
  } catch (err) {
    console.error('[Server] Fatal startup error:', err);
    process.exit(1);
  }
}

startServer();
