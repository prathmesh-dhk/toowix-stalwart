import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { connectDatabase } from '../src/db/connection';
import { runJob } from '../src/jobs/run-once';

vi.mock('../src/db/connection', () => ({ connectDatabase: vi.fn(), disconnectDatabase: vi.fn() }));
vi.mock('../src/jobs/run-once', () => ({ runJob: vi.fn().mockResolvedValue({ reminded: 0 }) }));

// Runs the real `npm run job` script with the given args and returns its exit code.
async function runCli(...args: string[]) {
  process.argv = ['node', 'run-job.ts', ...args];
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  vi.resetModules();
  await import('../src/scripts/run-job');
  await vi.waitFor(() => expect(exit).toHaveBeenCalled());
  return exit.mock.calls[0][0];
}

describe('npm run job (CLI)', () => {
  const originalArgv = process.argv;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it('passes a valid as-of date to the job as its now', async () => {
    expect(await runCli('trial', '2026-12-04T13:00:00Z')).toBe(0);
    expect(runJob).toHaveBeenCalledWith('trial', new Date('2026-12-04T13:00:00Z'));
  });

  it('runs the job as of the current time when no date is given', async () => {
    expect(await runCli('grace')).toBe(0);
    expect(runJob).toHaveBeenCalledWith('grace', undefined);
  });

  it('rejects an unparseable date with a non-zero exit, running nothing', async () => {
    expect(await runCli('trial', 'not-a-date')).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'Fatal error during run-job:',
      expect.objectContaining({ message: 'Invalid date "not-a-date"' }),
    );
    expect(runJob).not.toHaveBeenCalled();
    expect(connectDatabase).not.toHaveBeenCalled();
  });
});
