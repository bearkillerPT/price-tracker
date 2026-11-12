import { createBrowserFetcher, createFetcher } from './browser/fetcher.ts';
import { LiveSessions } from './browser/live.ts';
import { BrowserManager } from './browser/manager.ts';
import { attachLiveSocket } from './browser/socket.ts';
import { CatalogService } from './catalog.ts';
import { startHousekeeping } from './checks/housekeeping.ts';
import { createCheckRunner } from './checks/run-check.ts';
import { Scheduler } from './checks/scheduler.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { migrateAndSeed } from './db/migrate.ts';
import { createApp } from './http/app.ts';
import { log } from './log.ts';
import { createNotifier, seedChannelFromEnv } from './notify/index.ts';
import { createHttpFetcher } from './stores/http.ts';
import { StoreIcons } from './stores/icons.ts';
import { Previewer } from './stores/preview.ts';
import { setAllowPrivateHosts } from './stores/private-hosts.ts';
import { StoreSessions } from './stores/sessions.ts';

const config = loadConfig();
setAllowPrivateHosts(config.ALLOW_PRIVATE_HOSTS);
const { db, pool } = createDb(config.DATABASE_URL);
await migrateAndSeed(db);
await seedChannelFromEnv(db, config.GOTIFY_URL, config.GOTIFY_TOKEN);

const catalog = new CatalogService(db);
await catalog.refresh();

const notify = createNotifier(db);
const browsers = new BrowserManager();
const liveSessions = new LiveSessions(browsers);
const httpFetcher = createHttpFetcher();
// Previews and selector tests are plain page loads; checks use the browser for stores set to it
const fetchPage = createFetcher(httpFetcher, createBrowserFetcher(browsers));
const storeSessions = new StoreSessions(db, config.SESSION_KEY);
if (!storeSessions.enabled) log.warn('SESSION_KEY is not set: store sign-ins are off');
const storeIcons = new StoreIcons(db);
const checks = createCheckRunner({ db, catalog, fetchPage, notify, sessions: storeSessions, icons: storeIcons });
const scheduler = new Scheduler(db, catalog, checks.runCheck);
const app = createApp({
  db,
  catalog,
  wake: (group) => scheduler.wake(group),
  previewer: new Previewer(httpFetcher),
  recordOutcome: checks.recordOutcome,
  liveSessions,
  storeSessions,
  storeIcons,
  webDist: config.webDist,
});

// Express 5 hands a failed listen (e.g. port in use) to this callback instead of throwing
const server = app.listen(config.PORT, config.HOST, (err) => {
  if (err) {
    const inUse = (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
    log.error(inUse ? `port ${config.PORT} is already in use by another program; set PORT to a free port` : 'could not start the server', {
      error: err,
    });
    process.exit(1);
  }
  log.info('listening', { url: `http://${config.HOST}:${config.PORT}`, web: config.webDist ?? 'not served' });
});
attachLiveSocket(server, db, liveSessions);

let stopHousekeeping = () => {};
if (config.CHECKS_ENABLED) {
  scheduler.start();
  stopHousekeeping = startHousekeeping(db, () => catalog.get(), notify);
} else {
  log.warn('checks are disabled (CHECKS_ENABLED=false)');
}

const shutdown = async (signal: string) => {
  log.info('shutting down', { signal });
  stopHousekeeping();
  server.close();
  await scheduler.stop();
  await liveSessions.closeAll();
  await browsers.shutdown();
  await pool.end();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
