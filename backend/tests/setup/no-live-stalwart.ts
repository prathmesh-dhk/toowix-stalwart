import { config } from '../../src/config';

// config.ts loads the developer's .env, whose STALWART_URL may be a live server. Unmocked calls
// would then create and delete real domains and accounts, so tests get a closed local port and
// fail fast. Opt in with STALWART_LIVE=1 to run tests/stalwart.test.ts against the real server.
if (process.env.STALWART_LIVE !== '1') {
  config.stalwart.url = 'http://127.0.0.1:9';
}
