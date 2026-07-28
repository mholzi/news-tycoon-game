import './tokens.css';
import './game.css';
import { loadEpisodes, type Playable } from './feed';
import {
  deal,
  DealError,
  decadeOf,
  newSeed,
  seedFromSearch,
  validatePool,
  type DealtCampaign,
} from './deal';
import {
  accrue,
  applyBill,
  choosePrice,
  enterDecade,
  formatCopies,
  formatPrice,
  formatTakings,
  pricesFor,
  startLedger,
  type Ledger,
  type PriceChoice,
} from './ledger';

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
  const copiesFigure = el('copies');
  const priceFigure = el('price');
  const takingsFigure = el('takings');
  const ledgerNote = el('ledger-note');
  const priceMenu = el('price-menu');

  /**
   * A consequence that has been incurred and is waiting for its issue.
   *
   * `lever` is null for a held story. That is the one field that decides whether
   * the owner's account can see a decision at all, so it is set in exactly one
   * place, in `decide`, and read in exactly one place, in `settle`.
   *
   * `place` and `year` belong to the episode that CAUSED the bill, not to the
   * issue it lands in. By then that episode is several issues off the screen,
   * which is the point of naming it.
   */
  interface Pending {
    dueAt: number;
    text: string;
    from: string;
    lever: string | null;
    place: string;
    year: number;
  }

  let index = 0;
  let issue = 1;
  let ran = 0;
  let pending: Pending[] = [];
  let lastDecade: number | null = null;
  let decidedThisIssue = false;
  let pricedThisDecade = false;
  const warned = new Set<number>();
  const warnedLevers = new Set<string>();
  let ledger: Ledger = startLedger(decadeOf(EPISODES[0].year), warned);

  function renderLedger() {
    copiesFigure.textContent = formatCopies(ledger.copies);
    priceFigure.textContent = formatPrice(ledger.pricePence);
    takingsFigure.textContent = formatTakings(ledger.takingsPence);
  }

  function reset() {
    index = 0;
    issue = 1;
    ran = 0;
    pending = [];
    lastDecade = null;
    decidedThisIssue = false;
    pricedThisDecade = false;
    warned.clear();
    warnedLevers.clear();
    ledger = startLedger(decadeOf(EPISODES[0].year), warned);
    printed.textContent = '0';
    ledgerNote.textContent = '';
    priceMenu.hidden = true;
    record.replaceChildren();
    recordEmpty.hidden = false;
    doneBox.hidden = true;
    quietBox.hidden = true;
    issueBox.hidden = false;
    renderLedger();
    show();
  }

  /**
   * Anything owed by this issue lands now.
   *
   * This is the whole argument in four lines: the entry that appears is the
   * one you earned several issues ago, and by now the choice that caused it is
   * off the screen. It is added to the record, and — since the owner's account
   * became a total — to the money as well, but only for a story that was
   * printed. A held story carries `lever: null` and moves nothing here, so a
   * week you held something reads on the left exactly like a week there was
   * nothing to hold.
   */
  function settle() {
    const due = pending.filter((p) => p.dueAt <= issue);
    pending = pending.filter((p) => p.dueAt > issue);

    // Clamped rather than guarded. The earlier null check charged nothing on that
    // path while the record loop below still printed the consequence, so a bill
    // could appear in one account and vanish from the other. On an episode issue
    // this is that episode's decade; on a quiet issue it is the last episode
    // dealt. `runLedger` computes it the same way, so neither loop has a branch
    // the other lacks.
    const landingDecade = decadeOf(EPISODES[Math.min(index, EPISODES.length - 1)].year);
    const notes: string[] = [];
    for (const item of due) {
      applyBill(ledger, item.lever, landingDecade, warned, warnedLevers);
      // Access shows itself in the copies figure; only a cash bill needs a line.
      if (item.lever === 'money' || item.lever === 'law') {
        notes.push(`The bill for ${item.place} ${item.year} came out of the takings.`);
      }
    }
    ledgerNote.textContent = notes.join(' ');
    renderLedger();

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
    const decade = decadeOf(episode.year);

    // A new decade sets the standard price whether or not the player touches the
    // menu, so ignoring it means the price of the decade you are now in and not
    // one carried over from the last one.
    decidedThisIssue = false;
    if (decade !== lastDecade) {
      enterDecade(ledger, decade, warned);
      lastDecade = decade;
      pricedThisDecade = false;
      priceMenu.hidden = false;
      labelPriceButtons(decade);
      renderLedger();
    } else {
      // The decade's one choice is over, whether it was taken or ignored. Left
      // false here, a click dispatched at the hidden menu on any later issue of
      // the same decade would still apply a multiplier, landing on a ledger
      // `runLedger` cannot reproduce because it reads one choice per decade.
      pricedThisDecade = true;
      priceMenu.hidden = true;
    }

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
      lever: choice === 'print' ? episode.lever : null,
      place: episode.place,
      year: episode.year,
    });

    // The week's takings, once, now that the outcome is fixed. After this the
    // price menu is closed for the issue: a choice arriving later would be
    // rewriting a week that has already been sold.
    accrue(ledger, choice === 'print');
    decidedThisIssue = true;
    priceMenu.hidden = true;
    renderLedger();

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

    // No story on the desk, but the paper still comes out and still sells.
    accrue(ledger, false);
    renderLedger();

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
    doneText.textContent = `You ran ${ran} of ${EPISODES.length}, and it took ${issue} issues for the last of it to come back. The takings are everything the owner can see. The record is the rest of it, and there is still no rate at which one converts into the other — that is the argument, not a missing feature.`;
    donePending.textContent =
      'Every bill has now arrived. Notice that none of them landed in the issue that caused it.';
  }

  /** The menu says what each price does, so nobody has to reason about a curve. */
  function labelPriceButtons(decade: number) {
    const prices = pricesFor(decade, warned);
    el('price-cheap').textContent = `${prices.cheap}p — more readers`;
    el('price-standard').textContent = `${prices.standard}p — as you were`;
    el('price-dear').textContent = `${prices.dear}p — fewer readers`;
  }

  function pick(choice: PriceChoice) {
    // Guarded rather than merely hidden. Two ways a late click could corrupt the
    // ledger: after the week is sold it would rewrite banked takings, and a
    // second pick in the same decade would apply the multiplier twice, producing
    // a state `runLedger` cannot reproduce because it consumes exactly one
    // choice per decade. Hiding the menu is presentation; this is the invariant.
    if (decidedThisIssue || pricedThisDecade || lastDecade === null) return;
    pricedThisDecade = true;
    choosePrice(ledger, lastDecade, choice, warned);
    priceMenu.hidden = true;
    renderLedger();
  }

  el<HTMLButtonElement>('price-cheap').addEventListener('click', () => pick('cheap'));
  el<HTMLButtonElement>('price-standard').addEventListener('click', () => pick('standard'));
  el<HTMLButtonElement>('price-dear').addEventListener('click', () => pick('dear'));
  el<HTMLButtonElement>('do-print').addEventListener('click', () => decide('print'));
  el<HTMLButtonElement>('do-hold').addEventListener('click', () => decide('hold'));
  el<HTMLButtonElement>('next').addEventListener('click', next);
  el<HTMLButtonElement>('quiet-next').addEventListener('click', advance);
  el<HTMLButtonElement>('again').addEventListener('click', reset);

  // The markup ships the three figures empty, so nothing can go stale against
  // `START_COPIES` or the price table. This is where they first get a value.
  renderLedger();
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
