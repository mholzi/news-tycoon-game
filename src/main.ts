import './tokens.css';
import './game.css';
import { loadEpisodes, type Playable } from './feed';
import {
  deal,
  DealError,
  newSeed,
  seedFromSearch,
  validatePool,
  type DealtCampaign,
} from './deal';

/**
 * The game loop, moved out of the site's `prototype.astro`.
 *
 * One thing is genuinely new here and the rest is the same code. On the site
 * the episodes were compiled into the page, so there was no state in which the
 * data had not arrived. Now there is, and there are three of them: loading,
 * empty, and failed. Everything below `start()` is unchanged in behaviour.
 */

const el = <T extends HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;

const loadingBox = el('loading');
const emptyBox = el('empty');
const errorBox = el('error');
const gameBox = el('game');

/** Exactly one of the four sections is ever visible. */
function showOnly(section: HTMLElement | null): void {
  for (const box of [loadingBox, emptyBox, errorBox, gameBox]) {
    box.hidden = box !== section;
  }
}

function start(EPISODES: Playable[]): void {
  const issueNo = el('issue-no');
  const issueWhere = el('issue-where');
  const desk = el('desk');
  const voices = el<HTMLUListElement>('voices');
  const stepBelieve = el('step-believe');
  const stepPrint = el('step-print');
  const stepResult = el('step-result');
  const cannotKnow = el('cannot-know');
  const resultNow = el('result-now');
  const resultWait = el('result-wait');
  const printed = el('printed');
  const record = el<HTMLOListElement>('record');
  const recordEmpty = el('record-empty');
  const issueBox = el('issue');
  const quietBox = el('quiet');
  const quietNo = el('quiet-no');
  const quietOwed = el('quiet-owed');
  const doneBox = el('done');
  const doneText = el('done-text');
  const donePending = el('done-pending');

  /** A consequence that has been incurred and is waiting for its issue. */
  interface Pending {
    dueAt: number;
    text: string;
    from: string;
  }

  let index = 0;
  let issue = 1;
  let ran = 0;
  let pending: Pending[] = [];

  function reset() {
    index = 0;
    issue = 1;
    ran = 0;
    pending = [];
    printed.textContent = '0';
    record.replaceChildren();
    recordEmpty.hidden = false;
    doneBox.hidden = true;
    quietBox.hidden = true;
    issueBox.hidden = false;
    show();
  }

  /**
   * Anything owed by this issue lands now.
   *
   * This is the whole argument in four lines: the entry that appears is the
   * one you earned several issues ago, and by now the choice that caused it is
   * off the screen. It is added to the record and to nothing else — there is
   * no total, because a total would be a price, and a price would let you
   * trade this account against the other one.
   */
  function settle() {
    const due = pending.filter((p) => p.dueAt <= issue);
    pending = pending.filter((p) => p.dueAt > issue);
    for (const item of due) {
      const li = document.createElement('li');
      const what = document.createElement('span');
      what.textContent = item.text;
      const from = document.createElement('span');
      from.className = 'record-from';
      from.textContent = item.from;
      li.append(what, from);
      record.append(li);
      recordEmpty.hidden = true;
    }
  }

  function show() {
    const episode = EPISODES[index];
    issueNo.textContent = `Issue ${issue}`;
    issueWhere.textContent = `${episode.place} ${episode.year} · ${episode.lever}`;
    desk.textContent = episode.desk;
    cannotKnow.textContent = `What you cannot settle before the deadline: ${episode.unverifiable}`;

    voices.replaceChildren();
    episode.voices.forEach((voice, i) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'voice';

      const who = document.createElement('span');
      who.className = 'voice-who';
      who.textContent = voice.who;
      const says = document.createElement('span');
      says.className = 'voice-says';
      says.textContent = voice.says;
      const trust = document.createElement('span');
      trust.className = 'voice-note';
      trust.textContent = `For: ${voice.trust}`;
      const dt = document.createElement('span');
      dt.className = 'voice-note';
      dt.textContent = `Against: ${voice.doubt}`;

      button.append(who, says, trust, dt);
      button.addEventListener('click', () => believe(i));
      li.append(button);
      voices.append(li);
    });

    stepBelieve.hidden = false;
    stepPrint.hidden = true;
    stepResult.hidden = true;
  }

  function believe(which: number) {
    // Whom you believed is not scored. It cannot be: the episode does not know
    // who was right either, which is the honest part.
    voices.querySelectorAll('button').forEach((b, i) => {
      b.classList.toggle('chosen', i === which);
      b.disabled = true;
    });
    stepPrint.hidden = false;
  }

  function decide(choice: 'print' | 'hold') {
    const episode = EPISODES[index];
    const consequence = episode[choice];

    if (choice === 'print') {
      ran += 1;
      printed.textContent = String(ran);
    }

    pending.push({
      dueAt: issue + consequence.issues,
      text: consequence.later,
      from: `${choice === 'print' ? 'Printed' : 'Held'} · ${episode.place} ${episode.year}`,
    });

    resultNow.textContent = consequence.now;
    resultWait.textContent =
      'Something else follows from this, and it is not due yet. You will see it when it arrives.';
    stepPrint.hidden = true;
    stepResult.hidden = false;
  }

  function next() {
    index += 1;
    advance();
  }

  /**
   * One issue passes.
   *
   * If an episode is waiting it goes on the desk. If not, the paper still
   * comes out — that is what the quiet issues are — until nothing is owed.
   * Playing it without them showed why they are not decoration: the archive
   * is two episodes long and the first bill falls due in issue five, so the
   * delayed cost, the thing this game exists to test, never arrived once.
   */
  function advance() {
    issue += 1;
    settle();

    if (index < EPISODES.length) {
      issueBox.hidden = false;
      quietBox.hidden = true;
      show();
      return;
    }

    if (pending.length > 0) {
      issueBox.hidden = true;
      quietBox.hidden = false;
      quietNo.textContent = `Issue ${issue}`;
      const nextDue = Math.min(...pending.map((p) => p.dueAt)) - issue;
      quietOwed.textContent = `${pending.length} ${pending.length === 1 ? 'thing is' : 'things are'} still owed. The next falls due in ${nextDue} ${nextDue === 1 ? 'issue' : 'issues'}.`;
      return;
    }

    issueBox.hidden = true;
    quietBox.hidden = true;
    doneBox.hidden = false;
    doneText.textContent = `You ran ${ran} of ${EPISODES.length}, and it took ${issue} issues for the last of it to come back. The count is everything the owner can see. The record is the rest of it, and there is no rate at which one converts into the other — that is the argument, not a missing feature.`;
    donePending.textContent =
      'Every bill has now arrived. Notice that none of them landed in the issue that caused it.';
  }

  el<HTMLButtonElement>('do-print').addEventListener('click', () => decide('print'));
  el<HTMLButtonElement>('do-hold').addEventListener('click', () => decide('hold'));
  el<HTMLButtonElement>('next').addEventListener('click', next);
  el<HTMLButtonElement>('quiet-next').addEventListener('click', advance);
  el<HTMLButtonElement>('again').addEventListener('click', reset);

  show();
}

/**
 * Fresh seeds tried before the player gets the error screen.
 *
 * The sweep in `tests/integration/deal-sweep.test.ts` deals for every one of
 * 1000 seeds against the 36-episode pool, and the spec's floor is 900. Three
 * independent draws at a 10% miss rate is one failed load in a thousand.
 */
const SEED_ATTEMPTS = 3;

/**
 * A campaign, retried past an unlucky seed.
 *
 * `deal` is deterministic per seed, so a seed that cannot satisfy the pacing
 * rule cannot satisfy it on a second call either. A fresh seed can. Without
 * this a player would meet the error screen on a pool that deals fine, purely
 * because their first seed was one of the few that does not.
 *
 * A seed given in the URL is never retried: it was asked for by name, and
 * silently playing a different campaign than the one requested would make a
 * shared link mean nothing.
 */
function dealCampaign(pool: Playable[]): DealtCampaign {
  const requested = seedFromSearch(window.location.search);
  if (requested !== null) return deal(pool, requested);

  let lastError: unknown;
  for (let tries = 0; tries < SEED_ATTEMPTS; tries += 1) {
    try {
      return deal(pool, newSeed());
    } catch (error) {
      if (!(error instanceof DealError) || error.failure.code !== 'no-satisfying-deal') throw error;
      lastError = error;
    }
  }
  throw lastError;
}

async function boot(): Promise<void> {
  try {
    const pool = await loadEpisodes();
    if (pool.length === 0) {
      showOnly(emptyBox);
      return;
    }

    // Warnings for whoever is writing the pool, not for the player. They never
    // stop a campaign: a pool of two episodes is under every threshold here and
    // still plays, on the degraded path.
    for (const issue of validatePool(pool)) {
      console.warn('pool:', issue);
    }

    const campaign = dealCampaign(pool);
    showOnly(gameBox);
    start(campaign.episodes);
  } catch (error) {
    // The message is deliberately the same for every failure mode. A player
    // does not need to know whether it was a 500, a dead network, or a body
    // that would not parse; the console keeps the detail for whoever does.
    console.error(error);
    showOnly(errorBox);
  }
}

void boot();
