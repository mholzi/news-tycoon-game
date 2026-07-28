/**
 * The archive, fetched rather than compiled in.
 *
 * The game used to live inside the site and read its episodes from the content
 * collection at build time. Now it is its own repository and the data arrives
 * over the network from `/play.json` — the research archive with `outcome` and
 * `sources` taken out, because a decision whose answer is in the payload is a
 * quiz.
 *
 * Two things in here are load-bearing.
 *
 * The feed nests `decision`; the game reads `desk`, `voices`, `print` and
 * `hold` at the top level. `toPlayable` is where that gap is closed, and it is
 * closed here rather than in the feed because a contract should mirror the
 * thing it describes and flattening is a consumer's convenience.
 *
 * And `assertPlayFeed` is a real runtime check, not a type assertion.
 * TypeScript validates nothing at runtime, and this file is the boundary with
 * another origin that can change without us.
 */

export class FeedError extends Error {
  override readonly name = 'FeedError';
}

export interface Voice {
  who: string;
  says: string;
  trust: string;
  doubt: string;
}

export interface Consequence {
  now: string;
  later: string;
  issues: number;
}

export interface Decision {
  desk: string;
  voices: Voice[];
  unverifiable: string;
  print: Consequence;
  hold: Consequence;
}

export interface FeedEpisode {
  slug: string;
  title: string;
  url: string;
  year: number;
  place: string;
  lever: string;
  decision: Decision;
}

export interface PlayFeed {
  version: number;
  count: number;
  episodes: FeedEpisode[];
}

/** What the game consumes: the episode with its decision flattened onto it. */
export type Playable = Omit<FeedEpisode, 'decision' | 'url'> & Decision;

/** The shape this build understands. A feed announcing anything else is refused. */
export const SUPPORTED_VERSION = 1;

/** Mirrors `consequenceSchema` in the site repo, which has always capped this. */
export const MAX_ISSUES = 40;

export const FEED_URL: string =
  import.meta.env?.VITE_FEED_URL ?? 'https://news-tycoon.vercel.app/play.json';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * Checks run top-down and throw on the first failure.
 *
 * Deterministic on purpose: the tests assert exact messages, and a validator
 * that accumulated failures or checked fields in a different order every run
 * would make "exact message" untestable for anything but a single defect.
 */
export function assertPlayFeed(input: unknown): PlayFeed {
  if (!isRecord(input) || !Array.isArray(input.episodes)) {
    throw new FeedError('play feed is not an object with an episodes array');
  }

  if (input.version !== SUPPORTED_VERSION) {
    throw new FeedError(
      `play feed version mismatch: expected ${SUPPORTED_VERSION}, received ${String(input.version)}`,
    );
  }

  const episodes = input.episodes;

  if (input.count !== episodes.length) {
    throw new FeedError(
      `feed count disagrees with episodes: count ${String(input.count)}, episodes ${episodes.length}`,
    );
  }

  episodes.forEach((raw, index) => {
    if (!isRecord(raw)) throw new FeedError(`episode ${index} is not an object`);

    // `slug` first, and separately: every message below keys on it, so there is
    // no sensible way to name an episode that has not got one.
    if (!('slug' in raw)) throw new FeedError(`episode ${index} is missing slug`);
    if (!isText(raw.slug)) throw new FeedError(`episode ${index} has the wrong type for slug`);
    const slug = raw.slug;

    for (const field of ['title', 'place', 'lever'] as const) {
      if (!(field in raw)) throw new FeedError(`episode ${index} is missing ${field}`);
      if (!isText(raw[field])) {
        throw new FeedError(`episode ${index} has the wrong type for ${field}`);
      }
    }

    if (!('year' in raw)) throw new FeedError(`episode ${index} is missing year`);
    if (typeof raw.year !== 'number') {
      throw new FeedError(`episode ${index} has the wrong type for year`);
    }

    if (!('decision' in raw)) throw new FeedError(`episode ${index} is missing decision`);
    assertDecision(raw.decision, slug);
  });

  return input as unknown as PlayFeed;
}

function assertDecision(input: unknown, slug: string): void {
  if (!isRecord(input)) throw new FeedError(`episode ${slug}: decision is not an object`);

  for (const field of ['desk', 'unverifiable'] as const) {
    if (!(field in input)) throw new FeedError(`episode ${slug}: decision is missing ${field}`);
    if (!isText(input[field])) {
      throw new FeedError(`episode ${slug}: decision has the wrong type for ${field}`);
    }
  }

  if (!('voices' in input)) throw new FeedError(`episode ${slug}: decision is missing voices`);
  if (!Array.isArray(input.voices)) {
    throw new FeedError(`episode ${slug}: decision has the wrong type for voices`);
  }
  // Two at minimum: one account is not a choice about whom to believe.
  if (input.voices.length < 2) {
    throw new FeedError(
      `episode ${slug}: decision needs at least 2 voices, got ${input.voices.length}`,
    );
  }
  input.voices.forEach((voice, i) => {
    if (!isRecord(voice)) throw new FeedError(`episode ${slug}: voice ${i} is not an object`);
    for (const field of ['who', 'says', 'trust', 'doubt'] as const) {
      if (!(field in voice)) throw new FeedError(`episode ${slug}: voice ${i} is missing ${field}`);
      if (!isText(voice[field])) {
        throw new FeedError(`episode ${slug}: voice ${i} has the wrong type for ${field}`);
      }
    }
  });

  for (const branch of ['print', 'hold'] as const) {
    if (!(branch in input)) throw new FeedError(`episode ${slug}: decision is missing ${branch}`);
    assertConsequence(input[branch], slug, branch);
  }
}

function assertConsequence(input: unknown, slug: string, branch: 'print' | 'hold'): void {
  if (!isRecord(input)) throw new FeedError(`episode ${slug}: ${branch} is not an object`);

  for (const field of ['now', 'later'] as const) {
    if (!(field in input)) throw new FeedError(`episode ${slug}: ${branch} is missing ${field}`);
    if (!isText(input[field])) {
      throw new FeedError(`episode ${slug}: ${branch} has the wrong type for ${field}`);
    }
  }

  if (!('issues' in input)) throw new FeedError(`episode ${slug}: ${branch} is missing issues`);
  if (typeof input.issues !== 'number' || !Number.isInteger(input.issues) || input.issues < 1) {
    throw new FeedError(`episode ${slug}: ${branch} has the wrong type for issues`);
  }
  // The site's schema has capped this at 40 since the field existed; this side
  // never checked. A feed from anywhere else could hand the game a delay of 500,
  // which no campaign is long enough to ever pay. Separate message from the one
  // above on purpose: "wrong type" is untrue of an integer that is merely large,
  // and the tests here assert exact strings.
  if (input.issues > MAX_ISSUES) {
    throw new FeedError(
      `episode ${slug}: ${branch} has issues ${input.issues}, above the maximum of ${MAX_ISSUES}`,
    );
  }
}

/**
 * The flatten.
 *
 * Remove the spread and the game builds, deploys, and renders nothing — every
 * `episode.desk` reads `undefined` against a nested payload. There is a test
 * that goes red if it disappears.
 */
export function toPlayable(episode: FeedEpisode): Playable {
  return {
    slug: episode.slug,
    title: episode.title,
    year: episode.year,
    place: episode.place,
    lever: episode.lever,
    ...episode.decision,
  };
}

export async function loadEpisodes(url: string = FEED_URL): Promise<Playable[]> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (cause) {
    throw new FeedError(`could not reach the feed at ${url}`, { cause });
  }

  if (!response.ok) {
    throw new FeedError(`feed responded ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new FeedError('feed body is not valid JSON', { cause });
  }

  return assertPlayFeed(body).episodes.map(toPlayable);
}
