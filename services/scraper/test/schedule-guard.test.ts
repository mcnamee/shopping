import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const guard = (event: string, now: string) =>
  execFileSync(path.join(ROOT, '.github/scripts/schedule-guard.sh'), [event], {
    env: { PATH: process.env.PATH ?? '', NOW: now },
    encoding: 'utf8',
  });

describe('scrape schedule guard (Friday 5pm Canberra)', () => {
  it('lets 06:00 UTC through in daylight saving time (AEDT, UTC+11) and skips 07:00 UTC', () => {
    expect(guard('schedule', '2026-12-04T06:00:00Z')).toMatch(/^run=true/);
    expect(guard('schedule', '2026-12-04T07:00:00Z')).toMatch(/^run=false/);
  });

  it('lets 07:00 UTC through in standard time (AEST, UTC+10) and skips 06:00 UTC', () => {
    expect(guard('schedule', '2026-07-03T07:00:00Z')).toMatch(/^run=true/);
    expect(guard('schedule', '2026-07-03T06:00:00Z')).toMatch(/^run=false/);
  });

  it('is exactly one of the two crons on the DST changeover Fridays', () => {
    for (const day of ['2026-04-03', '2026-04-10', '2026-10-02', '2026-10-09']) {
      const hits = ['06', '07'].filter((h) =>
        guard('schedule', `${day}T${h}:00:00Z`).startsWith('run=true'),
      );
      expect(hits, day).toHaveLength(1);
    }
  });

  it('a delayed run still counts within the hour but not after it', () => {
    expect(guard('schedule', '2026-12-04T06:50:00Z')).toMatch(/^run=true/);
    expect(guard('schedule', '2026-12-04T07:10:00Z')).toMatch(/^run=false/);
  });

  it('always runs a manual dispatch', () => {
    expect(guard('workflow_dispatch', '2026-12-04T03:00:00Z')).toMatch(/^run=true/);
  });

  it('the workflow schedules both crons, no monthly one, and gates every later step', () => {
    const yml = readFileSync(path.join(ROOT, '.github/workflows/scrape-fallback.yml'), 'utf8');
    expect(yml).toContain("cron: '0 6 * * 5'");
    expect(yml).toContain("cron: '0 7 * * 5'");
    expect(yml).not.toContain('1 * *');
    expect(yml).toContain('vars.SCRAPE_FALLBACK_ENABLED');
    expect(yml).toContain('workflow_dispatch');
    const afterGuard = yml.slice(yml.indexOf('id: guard'));
    const steps = afterGuard.split('\n      - ').slice(1);
    expect(steps.length).toBeGreaterThan(3);
    for (const step of steps) expect(step).toContain("steps.guard.outputs.run == 'true'");
  });
});
