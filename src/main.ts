import './tokens.css';
import './game.css';
import { loadEpisodes, type Playable } from './feed';
import { formatCopies, formatPrice, formatTakings } from './ledger';
import { playDay, SOURCE_STEPS_TO_LEAD, startPaper, validatePool, type Action } from './paper';
import {
  STORY_SHELF_DAYS,
  STRINGER_PENCE,
  TIP_CHECK_DAYS,
  WIRE_PENCE_PER_DAY,
} from './sources';

/**
 * The screen, and nothing else.
 *
 * Every figure on it comes out of `playDay`. There is no arithmetic in this
 * file, deliberately: the calibration in the issue is only trustworthy because
 * one model produces the numbers the tests assert, the simulator prints and the
 * player reads.
 *
 * A day is planned and then printed. Clicking builds a list of actions and
 * changes nothing; `Print it` plays them all at once, in the order given, which
 * is the same order `runCampaign` uses.
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

/** What the desk calls each kind of story. Never more than this about a tip. */
const SOURCE_LABELS: Record<string, string> = {
  investigation: 'your own',
  wire: 'from the wire',
  planted: 'somebody wants this out',
  stringer: 'bought in',
  tip: 'a tip',
  advertorial: 'the advertiser',
  follow: 'everyone has it',
};

function start(pool: Playable[]): void {
  const cash = el('cash');
  const copies = el('copies');
  const price = el('price');
  const reporters = el('reporters');
  const day = el('day');
  const ledger = el<HTMLOListElement>('ledger');
  const ledgerEmpty = el('ledger-empty');
  const available = el<HTMLUListElement>('available');
  const availableEmpty = el('available-empty');
  const sources = el<HTMLUListElement>('sources');
  const planned = el('planned');
  const desk = el('desk');
  const overBox = el('over');
  const overText = el('over-text');
  const wire = el('wire');
  const buyStringer = el('buy-stringer');

  /** Headlines for anything currently on the desk, so the plan can name them. */
  let headlines = new Map<string, string>();

  let state = startPaper();
  let plan: Action[] = [];

  function describe(action: Action): string {
    switch (action.kind) {
      case 'publish':
        return `lead with ${headlines.get(action.id) ?? action.id}`;
      case 'cultivate':
        return `work ${action.sourceId}`;
      case 'hire':
        return 'hire a reporter';
      case 'fire':
        return 'let a reporter go';
      case 'subscribe':
        return 'take the wire';
      case 'unsubscribe':
        return 'drop the wire';
      case 'buy-stringer':
        return 'buy a story';
      case 'check':
        return `check ${action.id}`;
    }
  }

  function render(): void {
    cash.textContent = formatTakings(state.cashPence);
    copies.textContent = formatCopies(state.copies);
    price.textContent = formatPrice(state.pricePence);
    // A reporter checking a tip is as busy as one on a story.
    reporters.textContent = `${
      state.reporters - state.running.length - state.checking.length
    }/${state.reporters}`;
    wire.textContent = state.subscribed
      ? `Drop the wire (£${(WIRE_PENCE_PER_DAY / 100).toFixed(2)} a day)`
      : `Take the wire (£${(WIRE_PENCE_PER_DAY / 100).toFixed(2)} a day)`;
    buyStringer.textContent = `Buy a story (£${(STRINGER_PENCE / 100).toFixed(2)})`;
    day.textContent = `Day ${state.day}`;

    ledger.replaceChildren();
    for (const entry of state.ledger.slice(0, 40)) {
      const li = document.createElement('li');
      const what = document.createElement('span');
      what.textContent = entry.text;
      const figure = document.createElement('span');
      figure.className = 'record-from';
      figure.textContent =
        entry.pence === 0 ? `Day ${entry.day}` : `Day ${entry.day} · ${formatTakings(entry.pence)}`;
      li.append(what, figure);
      ledger.append(li);
    }
    ledgerEmpty.hidden = state.ledger.length > 0;

    available.replaceChildren();
    headlines = new Map(state.available.map((s) => [s.id, s.headline]));
    for (const story of state.available) {
      const li = document.createElement('li');
      li.className = 'article';
      li.dataset.source = story.source;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'voice publish';
      button.dataset.id = story.id;

      const who = document.createElement('span');
      who.className = 'voice-who';
      // Nothing here may betray whether an unchecked tip is true: not the
      // growth, not the consequence, not the answer. Only what it is and who
      // brought it.
      who.textContent = story.unverified ? 'unchecked' : SOURCE_LABELS[story.source];
      const says = document.createElement('span');
      says.className = 'voice-says';
      says.textContent = story.headline;

      button.append(who, says);
      button.addEventListener('click', () => {
        plan.push({ kind: 'publish', id: story.id });
        render();
      });
      li.append(button);

      // Offered only on the days it can actually report. `playDay` refuses a
      // check that would outlive its tip; the button has to agree with it, or
      // the screen invites a move the rules reject.
      if (story.unverified && state.day + TIP_CHECK_DAYS < story.offeredOn + STORY_SHELF_DAYS) {
        const check = document.createElement('button');
        check.type = 'button';
        check.className = 'cta check';
        check.dataset.id = story.id;
        check.textContent = 'Check it';
        check.addEventListener('click', () => {
          plan.push({ kind: 'check', id: story.id });
          render();
        });
        li.append(check);
      }

      available.append(li);
    }
    availableEmpty.hidden = state.available.length > 0;

    sources.replaceChildren();
    for (const source of state.sources) {
      const li = document.createElement('li');
      li.className = 'source';
      li.dataset.source = source.id;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'voice cultivate';

      const who = document.createElement('span');
      who.className = 'voice-who';
      who.textContent = source.id;
      const says = document.createElement('span');
      says.className = 'voice-says';
      says.textContent = `${source.steps}/${SOURCE_STEPS_TO_LEAD} towards a lead`;

      button.append(who, says);
      button.addEventListener('click', () => {
        plan.push({ kind: 'cultivate', sourceId: source.id });
        render();
      });
      li.append(button);
      sources.append(li);
    }

    planned.textContent =
      plan.length === 0
        ? 'Nothing planned for tomorrow.'
        : `Tomorrow: ${plan.map(describe).join(', ')}. (Tap to clear.)`;

    desk.hidden = state.over;
    overBox.hidden = !state.over;
    if (state.over) {
      overText.textContent = `You ran ${state.published.length} ${
        state.published.length === 1 ? 'story' : 'stories'
      } in ${state.day} days, and then the wages went out and nothing came back. The bill that closed you was earned some time ago.`;
    }
  }

  // A plan is a list of intentions, so it has to be possible to change your
  // mind. Without this the only way out of a misclick was to play the day.
  planned.addEventListener('click', () => {
    plan = [];
    render();
  });

  el<HTMLButtonElement>('wire').addEventListener('click', () => {
    plan.push({ kind: state.subscribed ? 'unsubscribe' : 'subscribe' });
    render();
  });
  el<HTMLButtonElement>('buy-stringer').addEventListener('click', () => {
    plan.push({ kind: 'buy-stringer' });
    render();
  });
  el<HTMLButtonElement>('hire').addEventListener('click', () => {
    plan.push({ kind: 'hire' });
    render();
  });
  el<HTMLButtonElement>('fire').addEventListener('click', () => {
    plan.push({ kind: 'fire' });
    render();
  });
  const nextDay = el<HTMLButtonElement>('next-day');
  nextDay.addEventListener('click', () => {
    // Guarded: a double click used to burn a second day on an empty plan.
    nextDay.disabled = true;
    state = playDay(state, pool, plan);
    plan = [];
    if (!state.over) state = { ...state, day: state.day + 1 };
    render();
    nextDay.disabled = false;
  });
  el<HTMLButtonElement>('again').addEventListener('click', () => {
    state = startPaper();
    plan = [];
    render();
  });

  render();
}

async function boot(): Promise<void> {
  try {
    const pool = await loadEpisodes();
    if (pool.length === 0) {
      showOnly(emptyBox);
      return;
    }

    // A bad pool is a refusal, not a warning.
    //
    // These used to go to the console and the game started anyway. An unknown
    // lever charges nothing, so a feed that renamed its levers would have turned
    // the only cost in the game into a no-op and left it unlosable, with the
    // sole trace a console line no player will ever read. The feed is served
    // from another origin and can change without us.
    const issues = validatePool(pool);
    if (issues.length > 0) {
      for (const issue of issues) console.warn('pool:', issue);
      showOnly(errorBox);
      return;
    }

    showOnly(gameBox);
    start(pool);
  } catch (error) {
    // One message for every failure mode. A player does not need to know
    // whether it was a 500, a dead network, or a body that would not parse.
    console.error(error);
    showOnly(errorBox);
  }
}

void boot();
