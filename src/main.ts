import './tokens.css';
import './game.css';
import { loadEpisodes, type Playable } from './feed';
import { clear, load, reconcile, save } from './save';
import { formatCopies, formatPrice, formatTakings } from './ledger';
import {
  dateline,
  endingHeading,
  endingText,
  PAPER_NAME,
  playDay,
  SOURCE_STEPS_TO_LEAD,
  startPaper,
  validatePool,
  type Action,
} from './paper';
import {
  PUBLISH_RULES,
  reference,
  STORY_SHELF_DAYS,
  STRINGER_PENCE,
  TIP_CHECK_DAYS,
  WIRE_PENCE_PER_DAY,
  type StorySource,
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

/**
 * What the desk calls each kind of story. Never more than this about a tip.
 *
 * Keyed by `StorySource` rather than `string` on purpose: an eighth source
 * would otherwise compile clean and print the word `undefined` into the one
 * slot that is supposed to say what a story is.
 */
const SOURCE_LABELS: Record<StorySource, string> = {
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
  const clearPlan = el<HTMLButtonElement>('clear-plan');
  const tomorrow = el<HTMLOListElement>('tomorrow');
  const tomorrowEmpty = el('tomorrow-empty');
  const tomorrowSlots = el('tomorrow-slots');
  const mast = el('mast');
  const mastName = el('mast-name');
  const datelineEl = el('dateline');
  const fold = el('fold');
  const desk = el('desk');
  const stepTomorrow = el('step-tomorrow');
  const deskEyebrow = el('desk-eyebrow');
  const overBox = el('over');
  const overHeading = el('over-heading');
  const overText = el('over-text');
  const wire = el<HTMLButtonElement>('wire');
  const buyStringer = el<HTMLButtonElement>('buy-stringer');

  /** Headlines for anything currently on the desk, so the plan can name them. */
  let headlines = new Map<string, string>();
  let unverifiedIds = new Set<string>();

  /*
   * A restored campaign, settled against the archive as it is now: an episode
   * that has left the pool since the save was written would otherwise sit in
   * `leads` for ever, unofferable and unexplained.
   */
  let state = reconcile(load() ?? startPaper(), pool);
  let plan: Action[] = [];

  function describe(action: Action): string {
    switch (action.kind) {
      // Not "lead with" any more: an issue holds several, and only the first is
      // the lead. The panel below says which is which; this line just lists them.
      case 'publish':
        return `run ${headlines.get(action.id) ?? action.id}`;
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
        return `check ${headlines.get(action.id) ?? action.id}`;
    }
  }

  /**
   * Reporters still free once the plan is taken into account.
   *
   * The committed figure alone let the player queue a day that half-executed:
   * three checks against one spare hand, with the refusal only arriving after
   * `Print it`.
   *
   * Counting queued actions is not the same as counting the ones `playDay`
   * accepts, and the first version got that wrong in both directions: it
   * ignored a queued hire and fire, and it charged a reporter for a second go
   * at a source `playDay` refuses for nothing. What it must count is the spend
   * the rules will actually allow.
   */
  function newsroomAfterPlan(): { free: number; heads: number } {
    // A second go at the same source is refused and costs nothing, so sources
    // are counted once however many times they were tapped.
    const worked = new Set<string>();
    const published = new Set<string>();
    let spent = 0;
    let heads = state.reporters;
    for (const action of plan) {
      if (action.kind === 'hire') heads += 1;
      if (action.kind === 'fire') heads -= 1;
      if (action.kind === 'check') spent += 1;
      if (action.kind === 'cultivate' && !worked.has(action.sourceId)) {
        worked.add(action.sourceId);
        spent += 1;
      }
      // Writing costs a reporter now, on the same budget as the rest — but which
      // stories cost one is read from `PUBLISH_RULES`, not restated here. The
      // first version restated it and immediately disagreed with the rules: it
      // charged for a second advertorial that `playDay` refuses for free, and
      // greyed out a cultivate the rules would have accepted.
      if (action.kind === 'publish') {
        const story = state.available.find((s) => s.id === action.id);
        const rule = story === undefined ? undefined : PUBLISH_RULES[story.source];
        const alreadyIn = rule?.oncePerIssue === true && published.has(action.id);
        if (rule?.costsReporter === true && !alreadyIn) spent += 1;
        if (rule !== undefined) published.add(action.id);
      }
    }
    return { free: heads - state.running.length - state.checking.length - spent, heads };
  }

  const freeAfterPlan = (): number => newsroomAfterPlan().free;

  /** Whether the wire will be on tomorrow, given what is already queued. */
  function wireAfterPlan(): boolean {
    let on = state.subscribed;
    for (const action of plan) {
      if (action.kind === 'subscribe') on = true;
      if (action.kind === 'unsubscribe') on = false;
    }
    return on;
  }

  function render(): void {
    // First, not last. If a later line throws on some future DOM change, the
    // state that produced it is already on disk, which is the state a bug
    // report needs.
    save(state);
    cash.textContent = formatTakings(state.cashPence);
    copies.textContent = formatCopies(state.copies);
    price.textContent = formatPrice(state.pricePence);
    // A reporter checking a tip is as busy as one on a story, and so is one the
    // plan has already spoken for.
    // Both halves read from the plan, or a queued hire would show as 2/3 —
    // a spare hand counted in the numerator and missing from the total.
    const newsroom = newsroomAfterPlan();
    reporters.textContent = `${Math.max(0, newsroom.free)}/${newsroom.heads}`;
    // Labelled from what the plan will do, not from what has been printed. The
    // committed state alone made the button contradict the click that had just
    // queued a change: press Take the wire, and it still read Take the wire.
    const wireOn = wireAfterPlan();
    wire.textContent = wireOn
      ? `Drop the wire (${formatTakings(WIRE_PENCE_PER_DAY)} a day)`
      : `Take the wire (${formatTakings(WIRE_PENCE_PER_DAY)} a day)`;
    buyStringer.textContent = `Buy a story (${formatTakings(STRINGER_PENCE)})`;
    day.textContent = `Day ${state.day}`;

    // The masthead. Written every render rather than once at boot: the dateline
    // carries the day, and `Start again` puts the campaign back to day 1
    // without reloading the page.
    mastName.textContent = PAPER_NAME;
    datelineEl.textContent = dateline(state.day);

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
    // The slot is built from ids alone, so whether a story was ever checked has
    // to travel here separately. Without it the front page cannot show that
    // what you are about to print is not solid.
    unverifiedIds = new Set(state.available.filter((s) => s.unverified).map((s) => s.id));
    for (const story of state.available) {
      const li = document.createElement('li');
      li.className = 'article';
      li.dataset.source = story.source;
      // Drawn differently, but identically for a true tip and a false one.
      li.dataset.unverified = String(story.unverified);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'voice publish';
      button.dataset.id = story.id;

      // Inside the button, before everything else, on purpose: it joins the
      // button's accessible name, so two publish buttons that would otherwise
      // read identically are told apart by a screen reader.
      const ref = document.createElement('span');
      ref.className = 'voice-ref';
      ref.textContent = reference(story.id);

      const who = document.createElement('span');
      who.className = 'voice-who';
      // Nothing here may betray whether an unchecked tip is true: not the
      // growth, not the consequence, not the answer. Only what it is and who
      // brought it. The reference above says which story, never how solid.
      who.textContent = story.unverified ? 'unchecked' : SOURCE_LABELS[story.source];
      const says = document.createElement('span');
      says.className = 'voice-says';
      says.textContent = story.headline;

      button.append(ref, who, says);
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
        // Priced like the two buttons beside it. A check spends the same scarce
        // thing an investigation does, and saying so only after `Print it` —
        // via "Nobody spare to check it." — is telling the player too late.
        check.textContent = `Check it (${TIP_CHECK_DAYS} days, one reporter)`;
        // Every check button otherwise reads the same, so the accessible name
        // has to name the tip. The headline says nothing about whether it
        // stands up, so this gives away no more than the card already does.
        check.setAttribute('aria-label', `Check: ${story.headline}`);
        // Already under check counts too, not just already queued. A tip stays
        // `unverified` for the two days a reporter is on it, so without this
        // the button came back the next morning, enabled, for work already in
        // hand — and `playDay` answered "Already looking into it."
        const running = state.checking.some((c) => c.id === story.id);
        const queued = plan.some((a) => a.kind === 'check' && a.id === story.id);
        check.disabled = running || queued || freeAfterPlan() <= 0;
        check.addEventListener('click', () => {
          plan.push({ kind: 'check', id: story.id });
          render();
        });
        li.append(check);
      }

      available.append(li);
    }
    availableEmpty.hidden = state.available.length > 0;

    // Tomorrow's issue, in the order the plan will run it: the first publish
    // leads, the rest are the inside. Removing is by plan index, not by id —
    // four queued wire items are four identical actions.
    tomorrow.replaceChildren();
    const queued = plan
      .map((action, index) => ({ action, index }))
      .filter((entry) => entry.action.kind === 'publish');
    for (const [slot, entry] of queued.entries()) {
      const id = (entry.action as { id: string }).id;
      const li = document.createElement('li');
      li.className = 'tomorrow-slot';
      li.dataset.role = slot === 0 ? 'lead' : 'inside';
      li.dataset.index = String(entry.index);
      // `false` rather than absent when the story has left `available` — the
      // same case the headline fallback below already has to handle.
      li.dataset.unverified = String(unverifiedIds.has(id));

      const ref = document.createElement('span');
      ref.className = 'voice-ref';
      ref.textContent = reference(id);

      const who = document.createElement('span');
      who.className = 'voice-who';
      who.textContent = slot === 0 ? 'leads' : 'inside';
      const says = document.createElement('span');
      says.className = 'voice-says';
      says.textContent = headlines.get(id) ?? id;

      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'cta remove';
      drop.textContent = 'Take it out';
      drop.setAttribute('aria-label', `Take out: ${headlines.get(id) ?? id}`);
      // Removal reads the index off the element, so the attribute the test and
      // the handler use is the same one. Written-but-unread invites a later
      // render to stop setting it without anything going red.
      drop.addEventListener('click', () => {
        plan.splice(Number(li.dataset.index), 1);
        render();
      });

      li.append(ref, who, says, drop);
      tomorrow.append(li);
    }
    tomorrowEmpty.hidden = queued.length > 0;
    tomorrowSlots.textContent = String(Math.max(0, freeAfterPlan()));

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
        : `Tomorrow: ${plan.map(describe).join(', ')}.`;
    clearPlan.hidden = plan.length === 0;

    // Was the ending already on screen before this render? Read before anything
    // below moves it.
    //
    // No current path can make this false while `state.over` is true: every
    // other control lives inside `#desk`, which is hidden the moment the
    // campaign ends, and `Start again` clears `over` before it renders. It is
    // here so that adding a control OUTSIDE the desk cannot silently start
    // stealing focus back on every click.
    const endingWasHidden = overBox.hidden;

    /*
     * Four elements now, not one.
     *
     * `#step-tomorrow` used to live inside `#desk` and disappeared with it. It
     * sits above the fold now, so hiding only the desk would leave tomorrow's
     * front page on screen behind the ending panel — a paper still being made
     * up for a campaign that is over. The masthead and the fold go with it for
     * the same reason: they are furniture for a page that is no longer there.
     */
    desk.hidden = state.over;
    stepTomorrow.hidden = state.over;
    mast.hidden = state.over;
    fold.hidden = state.over;
    if (state.over) {
      overHeading.textContent = endingHeading(state);
      overText.textContent = endingText(state);
    }
    // Revealed last, after its contents are written, so the panel is never on
    // screen in a state this function has not finished filling in.
    overBox.hidden = !state.over;

    // The same render hides the desk, and with it the button that was just
    // clicked, so focus would otherwise land on `<body>` and a screen reader
    // would announce nothing at all — win or lose. Moving it to the heading
    // makes the ending the reading position.
    if (state.over && endingWasHidden) overHeading.focus();
  }

  // A plan is a list of intentions, so it has to be possible to change your
  // mind. Without this the only way out of a misclick was to play the day.
  clearPlan.addEventListener('click', () => {
    plan = [];
    render();
  });

  wire.addEventListener('click', () => {
    // At most one wire action is ever queued, and none at all when the plan
    // would land back where it started. Pushing the opposite each time instead
    // left "take the wire, drop the wire" in tomorrow's plan — two ledger lines
    // for a day on which nothing about the wire changed.
    const want = !wireAfterPlan();
    plan = plan.filter((a) => a.kind !== 'subscribe' && a.kind !== 'unsubscribe');
    if (want !== state.subscribed) plan.push({ kind: want ? 'subscribe' : 'unsubscribe' });
    render();
  });
  buyStringer.addEventListener('click', () => {
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
    // Strictly redundant — the render below saves the fresh campaign over the
    // old one — but "throw this away" should be written as throwing it away,
    // not left as a consequence of render ordering that a refactor can quietly
    // remove.
    clear();
    state = startPaper();
    plan = [];
    render();
    // The mirror of the ending's focus move. This render hides `#over` and with
    // it the button just clicked, so without this focus falls to `<body>` and a
    // screen reader announces nothing about the paper that just opened.
    deskEyebrow.focus();
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
