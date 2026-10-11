/**
 * Finds (and optionally stops) whatever is listening on a TCP port.
 *
 * Solves the "EADDRINUSE" crash-loop that happens when a previous `npm run dev`
 * instance is still running.
 *
 * Usage:
 *   npm run free-port                  # report only (default)
 *   npm run free-port -- --kill        # terminate the listeners
 *   npm run free-port -- --port 5001   # inspect a different port
 *
 * Runs on Windows (netstat), macOS/Linux (lsof) and falls back to a clear
 * message when neither tool is available.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const argv = process.argv.slice(2);
const shouldKill = argv.includes('--kill');
const portIndex = argv.indexOf('--port');
const port = Number(
  portIndex !== -1 ? argv[portIndex + 1] : process.env.PORT || 5000
);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid port: ${port}`);
  process.exit(1);
}

/** `{ pid, command }` for everything LISTENing on `port`. */
async function findListeners() {
  if (process.platform === 'win32') {
    // netstat -ano prints: Proto  Local  Foreign  State  PID
    const { stdout } = await exec('netstat', ['-ano', '-p', 'tcp']);
    const lines = stdout.split(/\r?\n/);
    const pids = new Set();

    for (const line of lines) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 5) continue;
      if (!/^LISTENING$/i.test(columns[columns.length - 2])) continue;
      const local = columns[1] ?? '';
      if (!new RegExp(`:${port}$`).test(local)) continue;
      const pid = Number(columns[columns.length - 1]);
      if (Number.isInteger(pid)) pids.add(pid);
    }

    return [...pids].map((pid) => ({ pid, command: `PID ${pid}` }));
  }

  const { stdout } = await exec('lsof', [
    '-nP',
    `-iTCP:${port}`,
    '-sTCP:LISTEN',
    '-F',
    'pc',
  ]);

  const listeners = [];
  let current = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('p')) current = { pid: Number(line.slice(1)), command: '' };
    else if (line.startsWith('c') && current) current.command = line.slice(1);
    else if (line === '' && current) {
      listeners.push(current);
      current = null;
    }
  }
  if (current) listeners.push(current);
  return listeners;
}

(async () => {
  let listeners;
  try {
    listeners = await findListeners();
  } catch (error) {
    console.error(
      `Could not inspect port ${port}: ${error.message}\n` +
        'Install/enable `netstat` (Windows) or `lsof` (macOS/Linux), ' +
        'or just pick another port with PORT=5001 npm run dev'
    );
    process.exit(1);
  }

  if (listeners.length === 0) {
    console.log(`Nothing is listening on port ${port}. You are good to go.`);
    process.exit(0);
  }

  console.log(`Port ${port} is held by ${listeners.length} process(es):`);
  for (const listener of listeners) {
    console.log(`  PID ${listener.pid}${listener.command ? `  (${listener.command})` : ''}`);
  }

  if (!shouldKill) {
    console.log('\nRe-run with --kill to terminate them:');
    console.log(`  npm run free-port -- --kill${portIndex !== -1 ? ` -- --port ${port}` : ''}`);
    process.exit(0);
  }

  for (const listener of listeners) {
    try {
      // SIGTERM first so the process can shut down gracefully.
      process.kill(listener.pid, 'SIGTERM');
      console.log(`  sent SIGTERM to PID ${listener.pid}`);
    } catch (error) {
      console.warn(`  could not signal PID ${listener.pid}: ${error.message}`);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 1500));

  const remaining = (await findListeners()).map((listener) => listener.pid);
  if (remaining.length) {
    console.log(`\nStill listening on ${port}: ${remaining.join(', ')}`);
    process.exit(1);
  }

  console.log(`\nPort ${port} is now free. Start the server again.`);
})();