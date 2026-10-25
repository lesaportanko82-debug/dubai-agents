/**
 * Server-side OWED state for the panel. In-memory for the prototype,
 * seeded with a synthetic 3-month history so every screen has something to show.
 * Swapped for the Supabase store later without touching the UI.
 */
import { InMemoryStore } from '@core/owed/store';
import { DEMO_BATCHES, DEMO_SUPPLIERS } from '@core/owed/fixtures';
import { computeCaseCost } from '@core/owed/tools/cost';
import { decide } from '@core/owed/tools/decide';
import type { DefectCase, DefectClass, Attribution } from '@core/owed/types';
import type { IntakeResult } from '@core/owed/agent';

export interface RunRecord { id: string; at: string; input: string; result: IntakeResult }

interface OwedState { store: InMemoryStore; runs: RunRecord[] }

declare global {
  // eslint-disable-next-line no-var
  var __owedState: OwedState | undefined;
}

export function owedState(): OwedState {
  if (!globalThis.__owedState) {
    const store = new InMemoryStore(DEMO_SUPPLIERS, DEMO_BATCHES);
    seed(store);
    globalThis.__owedState = { store, runs: [] };
  }
  return globalThis.__owedState;
}

// deterministic pseudo-random so the demo looks the same every restart
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const DESCRIPTIONS: Record<DefectClass, string[]> = {
  manufacturing: [
    'Cartridge leaks after a few weeks of normal use',
    'Chrome coating peeling off the lever',
    'Porous casting, pinhole leak on the body',
    'Inlet thread cut crooked, cannot seal',
    'Ceramic cartridge cracked under normal use',
  ],
  transport: ['Box crushed in shipping, body dented', 'Broken on arrival, packaging torn'],
  installation: ['Overtightened nut cracked the body', 'No filter on well water, cartridge seized', 'Pressure above spec burst the body'],
  unknown: ['Customer says it stopped working, no details'],
};

function seed(store: InMemoryStore) {
  const r = rng(42);
  const classes: DefectClass[] = ['manufacturing', 'manufacturing', 'manufacturing', 'transport', 'installation', 'installation', 'unknown'];
  // batch weights: B-2026-058 is the problem batch
  const batchPick = [0, 1, 1, 1, 1, 2, 3];
  const start = new Date('2026-07-15T09:00:00Z').getTime();
  const span = 1000 * 60 * 60 * 24 * 100;

  for (let i = 0; i < 64; i++) {
    const b = DEMO_BATCHES[batchPick[Math.floor(r() * batchPick.length)]];
    const cls = classes[Math.floor(r() * classes.length)];
    const hasSerial = r() > 0.25;
    const attribution: Attribution = hasSerial ? 'serial' : b.sku === 'MX-210' ? 'sku_latest_batch_guess' : 'sku_single_batch';
    const confidence = cls === 'unknown' ? 0.4 : 0.78 + r() * 0.2;
    const cost = computeCaseCost(b, { compensation: r() > 0.8 ? Math.round(r() * 60) : 0 });
    const d = decide({ defectClass: cls, confidence, attribution, hasBatch: true });
    const receivedAt = new Date(start + r() * span).toISOString();
    const c: DefectCase = {
      id: `seed-${i.toString().padStart(3, '0')}`,
      externalRef: `A-${4400 + i}`,
      channel: ['telegram', 'email', 'service_act', 'marketplace'][Math.floor(r() * 4)],
      receivedAt,
      sku: b.sku,
      serial: hasSerial ? (b.serialFrom ?? 0) + Math.floor(r() * ((b.serialTo ?? 0) - (b.serialFrom ?? 0))) : undefined,
      batchId: b.id,
      supplierId: b.supplierId,
      attribution,
      description: DESCRIPTIONS[cls][Math.floor(r() * DESCRIPTIONS[cls].length)],
      defectClass: cls,
      confidence: Math.round(confidence * 100) / 100,
      reasoning: cls === 'manufacturing' ? 'Failure under normal use points to a production defect' : cls === 'transport' ? 'Damage consistent with shipping, not production' : cls === 'installation' ? 'Caused by installation or use outside specification' : 'Not enough information to classify',
      cost,
      recoverable: d.recoverable,
      needsReview: d.needsReview,
      reviewReasons: d.reviewReasons,
      status: d.status,
    };
    // a few already recovered / claimed for a realistic ledger
    if (c.status === 'evidenced' && r() > 0.7) c.status = r() > 0.5 ? 'recovered' : 'claimed';
    void store.saveCase(c);
  }
  // the problem batch: a cartridge-seal issue in B-2026-058 pushes it over the 1% allowance
  const hot = DEMO_BATCHES[1];
  for (let i = 0; i < 16; i++) {
    const serial = (hot.serialFrom ?? 0) + 300 + i * 90;
    const cost = computeCaseCost(hot);
    const receivedAt = new Date(start + span * (0.55 + i * 0.025)).toISOString();
    void store.saveCase({
      id: `seed-hot-${i}`, externalRef: `A-${4700 + i}`, channel: i % 2 ? 'service_act' : 'telegram', receivedAt,
      sku: hot.sku, serial, batchId: hot.id, supplierId: hot.supplierId, attribution: 'serial',
      description: 'Cartridge seal fails within 4–8 weeks of normal use', defectClass: 'manufacturing', confidence: 0.91,
      reasoning: 'Same seal failure pattern across the batch; production defect', cost,
      recoverable: true, needsReview: false, reviewReasons: [], status: 'evidenced',
    });
  }
}
