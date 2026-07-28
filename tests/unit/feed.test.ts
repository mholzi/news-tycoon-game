import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertPlayFeed,
  FeedError,
  toPlayable,
  type FeedEpisode,
  type PlayFeed,
} from '../../src/feed';

const fixture = (): PlayFeed =>
  JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/play.json'), 'utf-8'));

/** A deep clone, so a test that mutates cannot leak into the next one. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('assertPlayFeed', () => {
  it('accepts the real feed', () => {
    expect(() => assertPlayFeed(fixture())).not.toThrow();
  });

  it('refuses a version it does not understand', () => {
    expect(() => assertPlayFeed({ version: 2, count: 0, episodes: [] })).toThrow(
      new FeedError('play feed version mismatch: expected 1, received 2'),
    );
  });

  it('refuses an episode with no decision', () => {
    const feed = clone(fixture());
    delete (feed.episodes[0] as Partial<FeedEpisode>).decision;
    expect(() => assertPlayFeed(feed)).toThrow(
      `episode ${feed.episodes[0].slug} is missing decision`.replace(
        `${feed.episodes[0].slug} is`,
        '0 is',
      ),
    );
  });

  it('refuses a decision offering only one voice, because that is not a choice', () => {
    const feed = clone(fixture());
    const slug = feed.episodes[0].slug;
    feed.episodes[0].decision.voices = [feed.episodes[0].decision.voices[0]];
    expect(() => assertPlayFeed(feed)).toThrow(
      new FeedError(`episode ${slug}: decision needs at least 2 voices, got 1`),
    );
  });

  it('refuses a consequence with no delay on it', () => {
    const feed = clone(fixture());
    const slug = feed.episodes[0].slug;
    delete (feed.episodes[0].decision.print as Partial<{ issues: number }>).issues;
    expect(() => assertPlayFeed(feed)).toThrow(
      new FeedError(`episode ${slug}: print is missing issues`),
    );
  });

  it('refuses a count that disagrees with the episodes it ships', () => {
    const feed = clone(fixture());
    feed.count = 99;
    expect(() => assertPlayFeed(feed)).toThrow(
      new FeedError(`feed count disagrees with episodes: count 99, episodes ${feed.episodes.length}`),
    );
  });

  it('refuses something that is not a feed at all', () => {
    for (const input of [null, 'a string', 42, [], { version: 1 }]) {
      expect(() => assertPlayFeed(input)).toThrow(
        new FeedError('play feed is not an object with an episodes array'),
      );
    }
  });

  it('accepts an empty archive, because nothing to play is a real state', () => {
    expect(() => assertPlayFeed({ version: 1, count: 0, episodes: [] })).not.toThrow();
  });

  it('throws FeedError, so a caller can tell it apart from a bug', () => {
    try {
      assertPlayFeed({ version: 2, count: 0, episodes: [] });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(FeedError);
      expect((error as FeedError).name).toBe('FeedError');
    }
  });
});

describe('toPlayable', () => {
  it('lifts the decision onto the episode', () => {
    const episode = fixture().episodes[0];
    const playable = toPlayable(episode);

    // The feed nests these; the game reads them at the top level. Without the
    // flatten every one of them is undefined and the game renders nothing.
    expect(playable.desk).toBe(episode.decision.desk);
    expect(playable.voices).toEqual(episode.decision.voices);
    expect(playable.unverifiable).toBe(episode.decision.unverifiable);
    expect(playable.print).toEqual(episode.decision.print);
    expect(playable.hold).toEqual(episode.decision.hold);
  });

  it('keeps the episode fields the game shows', () => {
    const episode = fixture().episodes[0];
    const playable = toPlayable(episode);
    expect(playable.slug).toBe(episode.slug);
    expect(playable.title).toBe(episode.title);
    expect(playable.year).toBe(episode.year);
    expect(playable.place).toBe(episode.place);
    expect(playable.lever).toBe(episode.lever);
  });

  it('drops url and decision, which the game never reads', () => {
    const playable = toPlayable(fixture().episodes[0]) as unknown as Record<string, unknown>;
    expect(playable.url).toBeUndefined();
    expect(playable.decision).toBeUndefined();
  });
});

/**
 * The bound the site has always had and this side never checked.
 *
 * `consequenceSchema` in the site repo caps `issues` at 40, so no feed the site
 * produces changes meaning here. What changes is what a feed from anywhere else
 * can do: before this, a delay of 500 was accepted, and no campaign is long
 * enough to ever pay it.
 */
describe('assertPlayFeed, on the delay bound', () => {
  const withIssues = (value: unknown): PlayFeed => {
    const feed = clone(fixture());
    (feed.episodes[0].decision.print as { issues: unknown }).issues = value;
    return feed;
  };

  it('accepts the maximum', () => {
    expect(() => assertPlayFeed(withIssues(40))).not.toThrow();
  });

  it('accepts the minimum', () => {
    expect(() => assertPlayFeed(withIssues(1))).not.toThrow();
  });

  it('refuses a delay above the maximum, saying what it was', () => {
    const slug = fixture().episodes[0].slug;
    expect(() => assertPlayFeed(withIssues(41))).toThrow(
      new FeedError(`episode ${slug}: print has issues 41, above the maximum of 40`),
    );
  });

  it('refuses a wildly out-of-range delay the same way', () => {
    const slug = fixture().episodes[0].slug;
    expect(() => assertPlayFeed(withIssues(500))).toThrow(
      new FeedError(`episode ${slug}: print has issues 500, above the maximum of 40`),
    );
  });

  it('still calls zero a wrong type rather than an out-of-range value', () => {
    const slug = fixture().episodes[0].slug;
    expect(() => assertPlayFeed(withIssues(0))).toThrow(
      new FeedError(`episode ${slug}: print has the wrong type for issues`),
    );
  });

  it('still refuses a non-integer', () => {
    const slug = fixture().episodes[0].slug;
    expect(() => assertPlayFeed(withIssues(3.5))).toThrow(
      new FeedError(`episode ${slug}: print has the wrong type for issues`),
    );
  });
});
