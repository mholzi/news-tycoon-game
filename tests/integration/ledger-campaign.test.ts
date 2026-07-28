import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPlayFeed, toPlayable, type Playable, type PlayFeed } from '../../src/feed';
import { deal } from '../../src/deal';
import {
  promptCount,
  runLedger,
  START_COPIES,
  type IssueAction,
  type PriceChoice,
} from '../../src/ledger';

const load = (file: string): Playable[] =>
  assertPlayFeed(
    JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures', file), 'utf-8')) as PlayFeed,
  ).episodes.map(toPlayable);

/**
 * The whole economy, checked against a number nobody's code produced.
 *
 * The expected totals below were worked out from the rules in the issue before
 * any of this was written. That is the only reason the assertion means
 * anything: a figure lifted from a first run would agree with whatever the
 * implementation happened to do, including the wrong thing.
 */
describe('the twelve-episode fixture campaign', () => {
  const episodes = load('ledger-campaign.json');
  const allPrint: IssueAction[] = Array.from({ length: 12 }, () => 'print');
  const allStandard: PriceChoice[] = ['standard', 'standard', 'standard', 'standard'];

  it('spans four decades, three episodes each', () => {
    expect(episodes).toHaveLength(12);
    expect(promptCount(episodes)).toBe(4);
  });

  it('ends on the hand-computed total when everything runs at the standard price', () => {
    const ledger = runLedger(episodes, allStandard, allPrint);
    expect(ledger.takingsPence).toBe(1_953_992);
    expect(ledger.copies).toBeCloseTo(START_COPIES * 0.96 ** 4, 6);
  });

  it('ends far richer on the same campaign held from end to end', () => {
    const allHold: IssueAction[] = Array.from({ length: 12 }, () => 'hold');
    const ledger = runLedger(episodes, allStandard, allHold);
    expect(ledger.takingsPence).toBe(13_680_000);
    expect(ledger.copies).toBe(START_COPIES);
  });

  it('can be driven under water by pricing dear to cover the bills', () => {
    const allDear: PriceChoice[] = ['dear', 'dear', 'dear', 'dear'];
    expect(runLedger(episodes, allDear, allPrint).takingsPence).toBe(-740_881);
  });
});

describe('the degraded path', () => {
  it('runs the ledger on a two-episode pool, below the campaign length', () => {
    const pool = load('play.json');
    const campaign = deal(pool, '1');
    expect(campaign.degraded).toBe(true);

    const choices: PriceChoice[] = Array.from({ length: promptCount(campaign.episodes) }, () =>
      'standard' as const,
    );
    const actions: IssueAction[] = campaign.episodes.map(() => 'print');
    const ledger = runLedger(campaign.episodes, choices, actions);

    expect(promptCount(campaign.episodes)).toBeGreaterThanOrEqual(1);
    expect(ledger.takingsPence).toBeGreaterThan(0);
  });
});
