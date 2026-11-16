// Token Radar's value model: one sealed snapshot in, one ranked board out.
//
// The board ranks protocols that record no token. It covers the snapshot's whole watchlist
// (the floor), then the early radar: pre-token protocols below the watchlist floor that pass
// the watchlist's own strict rule, then an extended tier of the next pre-token protocols
// below the floor that the strict rule leaves out (bridges, liquid-staking and versioned
// pools). Every tier is scored by the same function, and no protocol name is ever
// special-cased: the same arithmetic scores every row.
//
// Implied value is built only from the snapshot's own figures:
//
//   peer     = the category's peer multiple: the median market-cap-to-TVL ratio of the
//              live-token protocols in that category (shrunk toward the global median
//              when the category has fewer than three live peers, clamped 0.05..2.5).
//              A category with no live peer at all takes the global median.
//   chain    = the first chain's multiple: the median market-cap-to-TVL ratio of the
//              live protocols on that chain, divided by the global median, shrunk the
//              same way and clamped 0.7..1.5. A chain with no live peer takes 1.
//   growth   = 1 + clamp(change_7d, -60, 120) / 100 * 0.5
//   maturity = 0.6 + min(age_days, 1095) / 1095 * 0.4   (age unknown: 365 days)
//   implied  = round(tvl_usd * peer * chain * growth * maturity)
//
// TVL says how much capital already trusts the protocol, the peer multiple says what
// the market pays per dollar of TVL for that kind of protocol, growth says where the
// TVL is heading, maturity says how long it has run with no token (the longer the
// wait, the closer a launch, the more the record is worth), and the chain multiple
// says how richly the protocol's home chain is valued. Live-token protocols are kept
// apart: the board shows the market's own market cap for them, never a model number.

/** One protocol of the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  peer_floor: number;
  peer_cap: number;
  peer_shrink: number;
  chain_floor: number;
  chain_cap: number;
  chain_shrink: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  peer_floor: 0.05,
  peer_cap: 2.5,
  peer_shrink: 3,
  chain_floor: 0.7,
  chain_cap: 1.5,
  chain_shrink: 3,
};

/** The model's version label, shown on the dashboard. */
export const MODEL_VERSION = 'radar-2';

/** How many rows the board holds in all: watchlist + early + extended. */
export const BOARD_ROWS = 200;

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Which tier a board row belongs to. */
export type Tier = 'watchlist' | 'early' | 'extended';

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  tier: Tier;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_protocols: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain: string | null;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One board row in the dashboard's compact form; the page rebuilds the farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  tier: Tier;
  implied_value_usd: number;
  peer_multiple: number;
  peer_protocols: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's peer multiple, derived from the live protocols in it. */
export interface PeerEntry {
  category: string;
  multiple: number;
  protocols: number;
}

/** One chain's multiple, derived from the live protocols on it. */
export interface ChainEntry {
  chain: string;
  multiple: number;
  protocols: number;
}

/** Everything the dashboard needs to render. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  extended_size: number;
  live_size: number;
  peers: PeerEntry[];
  chain_peers: ChainEntry[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted list of numbers; 0 for an empty list. */
function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days from `listedAt` to `asOf`, at least zero; null when either date is absent. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A name ending in a version marker is a pool of another protocol, not a protocol of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A name starting with an exchange's name is that exchange's product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** A whole word that marks a wrapped or staked product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Categories the watchlist rule keeps out: bridges and liquid-staking products. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * The watchlist's own strict rule, applied to protocols below the floor: pre-token, not a
 * bridge or staking product, not a versioned pool, not a wrapped or staked product, not an
 * exchange's product.
 */
export function isStrictEarly(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/**
 * The extended tier's looser rule: still pre-token and still not a wrapped or staked
 * product of a token that trades, but bridges, liquid-staking products and versioned
 * pools are allowed in. Centralised exchanges stay out: they are companies, not
 * protocols waiting on a launch.
 */
export function isExtended(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !WRAPPED_WORD.test(p.name) && !EXCHANGE_PREFIX.test(p.name);
}

/** The peer tables: one multiple per category and per chain, from the live protocols. */
export interface PeerTables {
  global: number;
  byCategory: Map<string, { multiple: number; protocols: number }>;
  byChain: Map<string, { multiple: number; protocols: number }>;
}

/** A live protocol's market-cap-to-TVL ratio, when both are recorded and TVL is positive. */
function ratioOf(p: SnapshotProtocol): number | null {
  if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) return null;
  return p.mcap_usd / p.tvl_usd;
}

/**
 * Derive the peer tables from the snapshot's live protocols. The global median anchors
 * every category and chain with too few live peers to trust on its own: a multiple is
 * the category's own median shrunk toward the global median, so a category with one
 * live protocol cannot set the board's scale by itself.
 */
export function peerTables(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): PeerTables {
  const live = protocols.filter((p) => !isPreToken(p));
  const allRatios = live.map(ratioOf).filter((r): r is number => r !== null).sort((a, b) => a - b);
  const global = median(allRatios);

  const byCategory = new Map<string, { multiple: number; protocols: number }>();
  const catRatios = new Map<string, number[]>();
  for (const p of live) {
    const r = ratioOf(p);
    if (r === null) continue;
    const key = p.category ?? 'Other';
    const list = catRatios.get(key) ?? [];
    list.push(r);
    catRatios.set(key, list);
  }
  for (const [key, list] of catRatios) {
    list.sort((a, b) => a - b);
    const med = median(list);
    const n = list.length;
    const shrunk = n >= model.peer_shrink ? med : (n * med + (model.peer_shrink - n) * global) / model.peer_shrink;
    byCategory.set(key, { multiple: round4(clamp(shrunk, model.peer_floor, model.peer_cap)), protocols: n });
  }

  const byChain = new Map<string, { multiple: number; protocols: number }>();
  const chainRatios = new Map<string, number[]>();
  for (const p of live) {
    const r = ratioOf(p);
    if (r === null || p.chains.length === 0) continue;
    const key = p.chains[0]!;
    const list = chainRatios.get(key) ?? [];
    list.push(r);
    chainRatios.set(key, list);
  }
  for (const [key, list] of chainRatios) {
    list.sort((a, b) => a - b);
    const med = median(list);
    const n = list.length;
    const shrunk = n >= model.chain_shrink ? med : (n * med + (model.chain_shrink - n) * global) / model.chain_shrink;
    const relative = global > 0 ? shrunk / global : 1;
    byChain.set(key, { multiple: round4(clamp(relative, model.chain_floor, model.chain_cap)), protocols: n });
  }
  return { global, byCategory, byChain };
}

/** The multipliers and the implied value one protocol gets under the model. */
export interface ScoredValue {
  implied: number;
  peerMultiple: number;
  peerProtocols: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chain: string | null;
  chainMult: number;
  age: number | null;
}

export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  tables: PeerTables,
  model: ModelConstants = MODEL,
): ScoredValue {
  const age = ageDays(asOf, p.listed_at);
  const peer = tables.byCategory.get(p.category ?? 'Other');
  const peerMultiple = peer !== undefined ? peer.multiple : round4(clamp(tables.global, model.peer_floor, model.peer_cap));
  const peerProtocols = peer !== undefined ? peer.protocols : 0;
  const growthPct = clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chain = p.chains.length > 0 ? p.chains[0]! : null;
  const chainEntry = chain !== null ? tables.byChain.get(chain) : undefined;
  const chainMult = chainEntry !== undefined ? chainEntry.multiple : 1;
  const implied = Math.max(1, Math.round(p.tvl_usd * peerMultiple * chainMult * growthMult * maturityMult));
  return { implied, peerMultiple, peerProtocols, growthPct, growthMult, maturityMult, chain, chainMult, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..N. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const tables = peerTables(snapshot.protocols, model);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, { p: SnapshotProtocol; tier: Tier }>();

  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, { p, tier: 'watchlist' });
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isStrictEarly(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, { p, tier: 'early' });
  if (chosen.size < BOARD_ROWS) {
    const extended = snapshot.protocols
      .filter((p) => !chosen.has(p.slug) && isExtended(p) && p.tvl_usd < snapshot.floor_usd)
      .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
      .slice(0, BOARD_ROWS - chosen.size);
    for (const p of extended) chosen.set(p.slug, { p, tier: 'extended' });
  }

  const scored = [...chosen.values()].map(({ p, tier }) => {
    const v = impliedValue(p, snapshot.as_of, tables, model);
    return { p, tier, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    tier: s.tier,
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      peer_multiple: s.v.peerMultiple,
      peer_protocols: s.v.peerProtocols,
      growth_pct: round4(s.v.growthPct),
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      chain: s.v.chain,
      chain_multiplier: s.v.chainMult,
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** One step as a single string: the action, then its cost and time, inside 20..600 chars. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Which family of action a category calls for, from the category's own words. */
function familyOf(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex') || c.includes('liquidity manager') || c.includes('leveraged farm')) return 'liquidity';
  if (c.includes('yield') || c.includes('farm')) return 'yield';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('staking') || c.includes('restak')) return 'staking';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('synthetic')) return 'derivatives';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return 'vault';
  if (c.includes('stable') || c.includes('algo')) return 'stable';
  if (c.includes('rwa') || c.includes('reserve')) return 'rwa';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('chain')) return 'chain';
  if (c.includes('launchpad')) return 'launchpad';
  if (c.includes('governance')) return 'governance';
  if (c.includes('payment') || c.includes('card')) return 'payments';
  return 'deposit';
}

/** The family's main action: what to do with the capital, on which chain. */
function mainAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const name = p.name;
  switch (familyOf(p)) {
    case 'lending':
      return `Supply $${capital} of USDC to ${name} on ${chain} and keep the lending position open.`;
    case 'liquidity':
      return `Provide $${capital} of liquidity to ${name}'s largest pool on ${chain} and keep the position open.`;
    case 'yield':
      return `Deposit $${capital} of USDC into ${name}'s highest-TVL strategy on ${chain} and keep it staked.`;
    case 'bridge':
      return `Bridge $${capital} of USDC into ${chain} through ${name} and use the bridged funds in its app.`;
    case 'staking':
      return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
    case 'derivatives':
      return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
    case 'prediction':
      return `Fund ${name} with $${capital} and place one position on a market that closes within a month.`;
    case 'vault':
      return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
    case 'stable':
      return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
    case 'rwa':
      return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it for the yield.`;
    case 'insurance':
      return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
    case 'chain':
      return `Bridge $${capital} of USDC to ${chain} and use it in the chain's flagship app.`;
    case 'launchpad':
      return `Stake $${capital} through ${name} to qualify for its next launch allocation.`;
    case 'governance':
      return `Deposit $${capital} into ${name} on ${chain} and vote on its next live proposal.`;
    case 'payments':
      return `Load $${capital} onto ${name} and make one real payment through it.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
  }
}

/** The family's second qualifying action, a different interaction from the first. */
function secondAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const name = p.name;
  switch (familyOf(p)) {
    case 'lending':
      return `Borrow about $${Math.round(capital / 4)} against the deposit and repay it within the week, so the position shows both sides.`;
    case 'liquidity':
      return `Stake the LP receipt in ${name}'s rewards gauge on ${chain} instead of leaving it idle in the wallet.`;
    case 'yield':
      return `Move a quarter of the position into a second ${name} strategy on ${chain} to show a repeat deposit.`;
    case 'bridge':
      return `Bridge a small amount back, about $${Math.round(capital / 5)}, so the record shows volume in both directions.`;
    case 'staking':
      return `Delegate the receipt token to a second validator through ${name} and leave both delegations in place.`;
    case 'derivatives':
      return `Close the first position, then open a second one half its size to show a second trade.`;
    case 'prediction':
      return `Place a second position on a different market, about $${Math.round(capital / 5)}, and let it settle.`;
    case 'vault':
      return `Deposit a second, smaller amount into a different ${name} vault on ${chain}.`;
    case 'stable':
      return `Provide $${Math.round(capital / 2)} of the stable asset as liquidity on ${chain} for one week.`;
    case 'rwa':
      return `Check the accrued yield after a week and reinvest it into the same asset.`;
    case 'insurance':
      return `Extend the cover by one more period before the first one lapses.`;
    case 'chain':
      return `Stake a small amount of the chain's native asset through its own staking page.`;
    case 'launchpad':
      return `Join the community sale or testnet task ${name} lists for its next launch.`;
    case 'governance':
      return `Vote on a second proposal and leave a short comment in the forum thread.`;
    case 'payments':
      return `Make a second payment of a different size through ${name} a week later.`;
    default:
      return `Make a second deposit, about $${Math.round(capital / 2)}, into a different pool of ${name} on ${chain}.`;
  }
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: mainAction(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondAction(p, capital, chain),
      cost: `about $${Math.round(capital / 4)} moved and about $3 of gas`,
      time: '10 minutes',
    },
    {
      text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.",
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan rebuilt in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    tier: row.tier,
    implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple,
    peer_protocols: row.model.peer_protocols,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const tables = peerTables(snapshot.protocols, model);
  const live = liveRows(snapshot);
  const peers: PeerEntry[] = [...tables.byCategory.entries()]
    .map(([category, v]) => ({ category, multiple: v.multiple, protocols: v.protocols }))
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  const chainPeers: ChainEntry[] = [...tables.byChain.entries()]
    .map(([chain, v]) => ({ chain, multiple: v.multiple, protocols: v.protocols }))
    .sort((a, b) => b.multiple - a.multiple || (a.chain < b.chain ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => r.tier === 'early').length,
    extended_size: board.filter((r) => r.tier === 'extended').length,
    live_size: live.length,
    peers,
    chain_peers: chainPeers,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100-row floor`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  return null;
}

/** The dashboard's dataset as one script: `window.RADAR = {...};`, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
