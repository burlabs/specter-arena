// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CREW_HANDOFFS, HANDOFF_LIMIT_NOTE } from './handoff';

interface RouteRecord {
  id: string;
  path: string | null;
  state: string;
}

const record = JSON.parse(readFileSync(fileURLToPath(new URL('../../../docs/compatibility/handoff-routes.json', import.meta.url)), 'utf8')) as {
  hostVersion: string;
  routes: RouteRecord[];
};

describe('CREW_HANDOFFS', () => {
  it('holds exactly one entry, the Bots page', () => {
    expect(CREW_HANDOFFS.map((handoff) => handoff.id)).toEqual(['open-bots']);
    expect(CREW_HANDOFFS[0]?.label).toBe('Open Bots in Crew');
    expect(CREW_HANDOFFS[0]?.buildHref()).toBe('/members');
  });

  it('lists only ids that the compatibility record marks allowed, with the same path', () => {
    for (const handoff of CREW_HANDOFFS) {
      const row = record.routes.find((route) => route.id === handoff.id);
      expect(row?.state).toBe('allowed');
      expect(row?.path).toBe(handoff.buildHref());
    }
    expect(record.hostVersion).toBe('0.12.2');
  });

  it('points at an evidence file that exists', () => {
    for (const handoff of CREW_HANDOFFS) {
      const file = handoff.evidencePath.split('#')[0] ?? '';
      expect(() => readFileSync(fileURLToPath(new URL(`../../../${file}`, import.meta.url)), 'utf8')).not.toThrow();
    }
  });

  it('never offers a route to a specific chat, approval or name', () => {
    for (const row of record.routes.filter((route) => route.state !== 'allowed')) {
      expect(CREW_HANDOFFS.some((handoff) => handoff.id === row.id)).toBe(false);
    }
  });

  it('says plainly what the handoff cannot do', () => {
    expect(HANDOFF_LIMIT_NOTE).toBe("Opens the Bots page in Crew. It cannot open this bot's chat or approvals directly.");
  });
});
