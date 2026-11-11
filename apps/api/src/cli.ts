// price-tracker reset-password [--password-stdin]
//   Sets the app's password and signs everyone out. Products, listings and history are untouched.
import { stdin, stdout } from 'node:process';
import { PasswordBody } from '@price-tracker/shared';
import { resetPassword } from './auth/account.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { migrateAndSeed } from './db/migrate.ts';

const USAGE = `Usage:
  price-tracker reset-password                   asks for the new password
  price-tracker reset-password --password-stdin  reads it from standard input

Needs the same DATABASE_URL as the server.`;

async function readAll(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

/** Reads a line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    stdout.write(question);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (key: string) => {
      for (const ch of key) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          cleanup();
          stdout.write('\n');
          reject(new Error('Cancelled'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    stdin.on('data', onData);
  });
}

async function main(argv: string[]): Promise<number> {
  const [command, ...flags] = argv;
  if (command !== 'reset-password') {
    console.error(USAGE);
    return command ? 2 : 0;
  }
  let password: string;
  if (flags.includes('--password-stdin')) {
    password = await readAll();
  } else if (stdin.isTTY) {
    password = await promptHidden('New password: ');
    if ((await promptHidden('Repeat it: ')) !== password) {
      console.error("The passwords don't match.");
      return 1;
    }
  } else {
    console.error('No terminal to ask on; pass the password with --password-stdin.');
    return 2;
  }
  const parsed = PasswordBody.safeParse({ password });
  if (!parsed.success) {
    console.error(parsed.error.issues[0]?.message ?? 'Invalid password');
    return 1;
  }

  const { db, pool } = createDb(loadConfig({ ...process.env, CHECKS_ENABLED: 'false' }).DATABASE_URL);
  try {
    await migrateAndSeed(db);
    await resetPassword(db, parsed.data.password);
  } finally {
    await pool.end();
  }
  console.log('Password set. Every login session was ended; sign in with the new password.');
  return 0;
}

process.exitCode = await main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  return 1;
});
