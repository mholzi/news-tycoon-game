import './tokens.css';
import './game.css';
import { loadEpisodes, type Playable } from './feed';
import { formatCopies, formatPrice, formatTakings } from './ledger';
import { playDay, startPaper, validatePool, type Action } from './paper';

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

  const titles = new Map(pool.map((e) => [e.slug, `${e.title} · ${e.place} ${e.year}`]));

  let state = startPaper();
  let plan: Action[] = [];

  function describe(action: Action): string {
    switch (action.kind) {
      case 'publish':
        return `lead with ${titles.get(action.slug) ?? action.slug}`;
      case 'cultivate':
        return `work ${action.sourceId}`;
      case 'hire':
        return 'hire a reporter';
      case 'fire':
        return 'let a reporter go';
    }
  }

  function render(): void {
    cash.textContent = formatTakings(state.cashPence);
    copies.textContent = formatCopies(state.copies);
    price.textContent = formatPrice(state.pricePence);
    reporters.textContent = `${state.reporters - state.running.length}/${state.reporters}`;
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
    for (const slug of state.available) {
      const li = document.createElement('li');
      li.className = 'article';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'voice publish';
      button.dataset.slug = slug;

      const who = document.createElement('span');
      who.className = 'voice-who';
      who.textContent = 'ready to run';
      const says = document.createElement('span');
      says.className = 'voice-says';
      says.textContent = titles.get(slug) ?? slug;

      button.append(who, says);
      button.addEventListener('click', () => {
        plan.push({ kind: 'publish', slug });
        render();
      });
      li.append(button);
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
      says.textContent = `${source.steps}/4 towards a lead`;

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
        : `Tomorrow: ${plan.map(describe).join(', ')}.`;

    desk.hidden = state.over;
    overBox.hidden = !state.over;
    if (state.over) {
      overText.textContent = `You ran ${state.published.length} ${
        state.published.length === 1 ? 'story' : 'stories'
      } in ${state.day} days, and then the wages went out and nothing came back. The bill that closed you was earned some time ago.`;
    }
  }

  el<HTMLButtonElement>('hire').addEventListener('click', () => {
    plan.push({ kind: 'hire' });
    render();
  });
  el<HTMLButtonElement>('fire').addEventListener('click', () => {
    plan.push({ kind: 'fire' });
    render();
  });
  el<HTMLButtonElement>('next-day').addEventListener('click', () => {
    state = playDay(state, pool, plan);
    plan = [];
    if (!state.over) state = { ...state, day: state.day + 1 };
    render();
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

    // Warnings for whoever is writing the pool, not for the player.
    for (const issue of validatePool(pool)) {
      console.warn('pool:', issue);
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
