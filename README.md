# News Tycoon

## What this is

A game about the trade every editor makes and nobody solves: you cannot verify
the story in time, the bill for printing it arrives long after you have
forgotten the decision that caused it, and the account it lands in has no price
on it.

One issue at a time. Decide who to believe, decide whether to print, and then
keep publishing while the consequence you earned works its way towards you.
There is a number for the stories you ran, because that is what an owner can
see. There is no number for the rest of it, because a number would be a price,
and a price would let you trade one account against the other. That absence is
the argument, not a missing feature.

It is rough on purpose. The delays are a first guess rather than a finding.

## Where the data comes from

Every episode is a real moment where press and power negotiated, researched and
written up at
[news-tycoon.vercel.app](https://news-tycoon.vercel.app/), then published as a
machine-readable feed the game fetches at runtime:

    https://news-tycoon.vercel.app/play.json

That feed is the archive **with the answer taken out**. The site also publishes
`/episodes.json`, which carries `outcome` — how the story actually went — and
`sources`. The game does not read it and must not: a decision whose answer sits
in the payload is a quiz, and the one thing this game argues is that you decide
without knowing.

The split is enforced on both sides. The site builds `play.json` field by field
rather than spreading the episode, so a new field cannot leak by accident, and
this repository has a test that fails if the word `outcome` ever appears in the
built output.

`src/feed.ts` fetches, validates, and flattens. The validation is real runtime
checking rather than a type assertion, because the feed lives on another origin
and can change without this repository noticing.

## Running it

    npm ci
    npm run dev

Point it somewhere else with `VITE_FEED_URL` if you want to play against a
local copy of the archive.

## Tests

    npm run build     # dist/ must exist before the tests that read it
    npm test          # vitest, then playwright

`npm test` runs everything, including one test that hits the live feed to check
the site has not changed the contract. CI runs that one separately and lets it
fail without failing the build.

## Licence

MIT.
