# Token Radar

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/uyekt1987/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/uyekt1987/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar for protocols that record no token yet, built for the [make.fun token-radar-01 bounty](https://make.fun/bounty/token-radar-01). It ranks pre-token protocols by what their launch would be worth if their record stayed as it is — an implied value, never a prediction of whether or when a token is issued — and gives each protocol a plan to farm it.

## The board

200 rows, ranked by implied launch value:

- **40 watchlist** — every protocol on the snapshot's watchlist (TVL at or above the $50,000,000 floor, no token recorded)
- **138 early radar** — pre-token protocols below the floor that pass the watchlist's own strict rule
- **22 extended** — the next pre-token protocols by TVL

Rank 1 is Steakhouse Financial, implied $751.8M. Each row carries a 7-step farm plan.

## The model (radar-4)

```
implied = TVL × peer × chain × growth × maturity
```

- **peer** — the category's peer multiple: the GEOMETRIC median market-cap-to-TVL ratio of live-token protocols in the same category (the median of the log ratios, exponentiated — ratios span orders of magnitude, so an arithmetic median is dragged by the fat tail). Ratios are winsorized to 0.02–5.0 before the median is taken, the median is shrunk toward the global median in log space when fewer than eight peers, and the result is clamped 0.05–2.0 — so one live protocol cannot set a whole category's price
- **chain** — the average of the chain multiples of every chain the protocol names: each chain's multiple is the geometric median market-cap-to-TVL ratio of live protocols on that chain, divided by the global median (clamped 0.7–1.2)
- **growth** — `1 + clamp(change_7d, -70, 150) / 100 × 0.30`
- **maturity** — `0.7 + min(age_days, 730) / 730 × 0.5` (age unknown: 540 days)

TVL says how much capital already trusts the protocol, the peer multiple says what the market pays per dollar of TVL for that kind of protocol, growth says where the TVL is heading, maturity says how long it has run with no token, and the chain multiple says how richly its chains are valued. Live-token protocols are kept out of the board; they only set the peer and chain multiples.

### Validated, not guessed

The constants were tuned by leave-one-out validation on the snapshot's own 128 live-token protocols: each live protocol was scored as if it were pre-token, with its peer tables built from the other 127 live protocols only, and the model's value compared with its actual market cap. radar-3 missed by a log-RMSE of 2.26 (tune half) / 2.59 (held-out half), rank correlation 0.39 / 0.35. radar-4 misses by 2.18 / 2.49, rank correlation 0.43 / 0.38. The noisy inputs were damped where the test said they were over-weighted: growth 0.65 → 0.30, maturity floor 0.50 → 0.70, peer shrink 5 → 8, chain clamp 0.8–1.3 → 0.7–1.2. The honest limit: a log-RMSE near 2 means a typical value is off by roughly an order of magnitude, so the model ranks launches — it does not price them.

## The dashboard

`dashboard/` is a dark "radar room" page with the ranked board, a detail view for each protocol, and a filter. It renders from the dataset the program writes beside it (`data.js`).

## Run

`main.ts` at the root reads the sealed DefiLlama snapshot and writes the ranked board, the dashboard dataset, a copy of the dashboard and screenshots, and the judge's dossier. Node 22, standard library only, no network. Deterministic: the same snapshot bytes always write the same output bytes.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Outputs: `board.json` (the ranked board), `data.js` (the dashboard's dataset), `dashboard/`, `screenshots/`, `dossier.json`.

## Screenshots

`screenshots/` holds three views of the dashboard: the ranked board, a protocol detail, and the filtered board.
