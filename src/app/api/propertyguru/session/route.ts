import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';

let sessionProcess: ChildProcessWithoutNullStreams | null = null;
let lastOutput = '';
let lastStartedAt: string | null = null;
let lastExitCode: number | null = null;

function appendOutput(chunk: Buffer) {
  lastOutput = `${lastOutput}${chunk.toString()}`.slice(-4000);
}

function getSessionStatus() {
  const lines = lastOutput.split('\n').map(line => line.trim()).filter(Boolean);
  const savedLine = [...lines].reverse().find(line => line.startsWith('Saved browser storage state'));
  const verifiedLine = [...lines].reverse().find(line => line.startsWith('Verified page:'));
  const openedDefaultBrowserLine = [...lines].reverse().find(line => line.startsWith('Opened PropertyGuru verification in default browser.'));
  const waitingLine = [...lines].reverse().find(line => line.startsWith('{') && line.includes('"waiting"'));
  const errorLine = [...lines].reverse().find(line => /Timed out|Target page|PropertyGuru session was not saved|Error:/i.test(line));

  let waiting: unknown = null;
  if (waitingLine) {
    try {
      waiting = JSON.parse(waitingLine);
    } catch {}
  }

  if (savedLine) {
    return {
      state: 'saved',
      saved: true,
      waiting: false,
      verifiedUrl: verifiedLine?.replace(/^Verified page:\s*/, '') || null,
    };
  }

  if (openedDefaultBrowserLine) {
    return {
      state: 'opened-default-browser',
      saved: false,
      waiting: false,
    };
  }

  if (sessionProcess && sessionProcess.exitCode === null) {
    return {
      state: 'waiting',
      saved: false,
      waiting: true,
      latest: waiting,
    };
  }

  if (errorLine || lastExitCode) {
    return {
      state: 'failed',
      saved: false,
      waiting: false,
      exitCode: lastExitCode,
      error: errorLine || 'Verification process exited before saving a session.',
    };
  }

  return {
    state: 'idle',
    saved: false,
    waiting: false,
  };
}

export async function POST() {
  if (sessionProcess && sessionProcess.exitCode === null) {
    return Response.json({
      ok: true,
      running: true,
      startedAt: lastStartedAt,
      status: getSessionStatus(),
      message: 'PropertyGuru verification window is already open.',
    });
  }

  const projectRoot = process.cwd();
  const scriptPath = path.join(projectRoot, 'scripts', 'propertyguru-session.mjs');
  lastOutput = '';
  lastStartedAt = new Date().toISOString();
  lastExitCode = null;

  sessionProcess = spawn(
    process.execPath,
    [scriptPath, '--auto-save'],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        SCRAPER_PROXY: process.env.SCRAPER_PROXY || 'http://127.0.0.1:7897',
        SCRAPER_HEADLESS: process.env.SCRAPER_HEADLESS || 'true',
        PROPERTYGURU_VERIFICATION_BROWSER: process.env.PROPERTYGURU_VERIFICATION_BROWSER || 'default',
      },
    },
  );

  sessionProcess.stdout.on('data', appendOutput);
  sessionProcess.stderr.on('data', appendOutput);
  sessionProcess.on('exit', code => {
    lastExitCode = code;
    sessionProcess = null;
  });

  return Response.json({
    ok: true,
    running: true,
    startedAt: lastStartedAt,
    status: getSessionStatus(),
    message: 'PropertyGuru verification opened in your default browser. Finish Cloudflare there, then retry PropertyGuru.',
  });
}

export async function GET() {
  return Response.json({
    running: Boolean(sessionProcess && sessionProcess.exitCode === null),
    startedAt: lastStartedAt,
    status: getSessionStatus(),
    output: lastOutput,
  });
}
