// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, the filters, a per-protocol detail
// drawer carrying the model's own inputs and the farm plan, and the model
// explainer. No network: every byte on the page comes from data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) return;

  var state = {
    q: '',
    category: 'all',
    tier: 'all',
    tab: 'pre-token',
    sort: 'implied',
    dir: -1,
    selected: null,
  };

  // -- formatting -----------------------------------------------------------

  function esc(value) {
    var s = value === null || value === undefined ? '' : String(value);
    return s.replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }

  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // Two decimals with one trailing zero trimmed: 0.2969 -> "0.3", 1.5 -> "1.5".
  function mult(n) {
    return (Math.round(n * 10000) / 10000).toFixed(2).replace(/0$/, '');
  }

  // -- the model, recomputed on the page ------------------------------------
  //
  // The page re-derives a row from the snapshot figures and checks the number
  // board.json carries, so the page and the board are visibly the same
  // arithmetic. Peer and chain multiples arrive in the data, derived from the
  // live set.

  function impliedOf(row, model) {
    var growth = row.change_7d == null ? 0 : row.change_7d;
    growth = Math.min(model.growth_cap, Math.max(model.growth_floor, growth));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var ageDays = row.age_days == null ? model.unknown_age_days : row.age_days;
    var maturity =
      model.maturity_floor +
      (Math.min(Math.max(ageDays, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * row.chain_multiplier * growthMult * maturity));
  }

  // -- the farm plan, derived the same way board.json derives it ------------
  //
  // The category decides the action, TVL decides the capital, age decides the
  // hold. No name is special-cased, so the page's plan and the board's plan are
  // the same words.

  function chainOf(p) {
    return p.chains && p.chains.length ? p.chains[0] : 'its main chain';
  }

  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }

  function holdFor(ageDays) {
    if (ageDays == null) return 30;
    if (ageDays < 180) return 60;
    if (ageDays < 365) return 45;
    return 30;
  }

  function familyOf(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'lending';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('leveraged farm') >= 0) return 'liquidity';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 'yield';
    if (c.indexOf('bridge') >= 0) return 'bridge';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'staking';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0 || c.indexOf('synthetic') >= 0) return 'derivatives';
    if (c.indexOf('prediction') >= 0) return 'prediction';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0) return 'vault';
    if (c.indexOf('stable') >= 0 || c.indexOf('algo') >= 0) return 'stable';
    if (c.indexOf('rwa') >= 0 || c.indexOf('reserve') >= 0) return 'rwa';
    if (c.indexOf('insurance') >= 0) return 'insurance';
    if (c.indexOf('chain') >= 0) return 'chain';
    if (c.indexOf('launchpad') >= 0) return 'launchpad';
    if (c.indexOf('governance') >= 0) return 'governance';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'payments';
    return 'deposit';
  }

  function mainAction(p, capital, chain) {
    var name = p.name;
    switch (familyOf(p)) {
      case 'lending': return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the lending position open.';
      case 'liquidity': return 'Provide $' + capital + ' of liquidity to ' + name + "'s largest pool on " + chain + ' and keep the position open.';
      case 'yield': return 'Deposit $' + capital + ' of USDC into ' + name + "'s highest-TVL strategy on " + chain + ' and keep it staked.';
      case 'bridge': return 'Bridge $' + capital + ' of USDC into ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
      case 'staking': return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
      case 'derivatives': return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
      case 'prediction': return 'Fund ' + name + ' with $' + capital + ' and place one position on a market that closes within a month.';
      case 'vault': return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares.';
      case 'stable': return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
      case 'rwa': return 'Mint $' + capital + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it for the yield.';
      case 'insurance': return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
      case 'chain': return 'Bridge $' + capital + ' of USDC to ' + chain + " and use it in the chain's flagship app.";
      case 'launchpad': return 'Stake $' + capital + ' through ' + name + ' to qualify for its next launch allocation.';
      case 'governance': return 'Deposit $' + capital + ' into ' + name + ' on ' + chain + ' and vote on its next live proposal.';
      case 'payments': return 'Load $' + capital + ' onto ' + name + ' and make one real payment through it.';
      default: return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
    }
  }

  function secondAction(p, capital, chain) {
    var name = p.name;
    switch (familyOf(p)) {
      case 'lending': return 'Borrow about $' + Math.round(capital / 4) + ' against the deposit and repay it within the week, so the position shows both sides.';
      case 'liquidity': return "Stake the LP receipt in " + name + "'s rewards gauge on " + chain + ' instead of leaving it idle in the wallet.';
      case 'yield': return 'Move a quarter of the position into a second ' + name + ' strategy on ' + chain + ' to show a repeat deposit.';
      case 'bridge': return 'Bridge a small amount back, about $' + Math.round(capital / 5) + ', so the record shows volume in both directions.';
      case 'staking': return 'Delegate the receipt token to a second validator through ' + name + ' and leave both delegations in place.';
      case 'derivatives': return 'Close the first position, then open a second one half its size to show a second trade.';
      case 'prediction': return 'Place a second position on a different market, about $' + Math.round(capital / 5) + ', and let it settle.';
      case 'vault': return 'Deposit a second, smaller amount into a different ' + name + ' vault on ' + chain + '.';
      case 'stable': return 'Provide $' + Math.round(capital / 2) + ' of the stable asset as liquidity on ' + chain + ' for one week.';
      case 'rwa': return 'Check the accrued yield after a week and reinvest it into the same asset.';
      case 'insurance': return 'Extend the cover by one more period before the first one lapses.';
      case 'chain': return "Stake a small amount of the chain's native asset through its own staking page.";
      case 'launchpad': return 'Join the community sale or testnet task ' + name + ' lists for its next launch.';
      case 'governance': return 'Vote on a second proposal and leave a short comment in the forum thread.';
      case 'payments': return 'Make a second payment of a different size through ' + name + ' a week later.';
      default: return 'Make a second deposit, about $' + Math.round(capital / 2) + ', into a different pool of ' + name + ' on ' + chain + '.';
    }
  }

  function weeklyAction(p, capital, chain) {
    var name = p.name;
    var small = Math.round(capital / 5);
    switch (familyOf(p)) {
      case 'lending': return 'Repay about $' + small + ' of the borrow and borrow it back, so the position shows fresh lending activity each week.';
      case 'liquidity': return 'Add about $' + small + ' of liquidity to the same pool each week and stake the new LP receipt in the rewards gauge.';
      case 'yield': return "Claim the strategy's yield each week and redeposit it into the same " + name + ' strategy on ' + chain + '.';
      case 'bridge': return 'Bridge about $' + small + ' in either direction through ' + name + ' each week, so the record shows regular volume.';
      case 'staking': return 'Claim the staking rewards each week and restake them through ' + name + ', so the position compounds.';
      case 'derivatives': return 'Close and reopen a small hedged position on ' + name + ' each week, so the record shows repeated trades.';
      case 'prediction': return 'Place one small position on a new ' + name + ' market each week and let it settle.';
      case 'vault': return 'Deposit a small top-up, about $' + small + ', into the same ' + name + ' vault each week and keep the shares.';
      case 'stable': return 'Move a small amount of the stable asset in or out through ' + name + ' each week, so the position stays active.';
      case 'rwa': return 'Check the accrued yield on ' + name + ' each week and reinvest it into the same asset.';
      case 'insurance': return 'Check the ' + name + ' cover each week and top it up before it lapses.';
      case 'chain': return 'Use the ' + chain + ' flagship app once a week, a swap or a stake, so the wallet stays active on the chain.';
      case 'launchpad': return "Check " + name + "'s launch calendar each week and complete the task it lists for its next launch.";
      case 'governance': return 'Vote on each new ' + name + ' proposal the week it opens and leave a short comment in the forum thread.';
      case 'payments': return 'Make one small real payment through ' + name + ' each week.';
      default: return 'Make one qualifying action each week, such as a deposit or a swap into ' + name + ' on ' + chain + ', so the position stays active.';
    }
  }

  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdFor(p.age_days);
    var gas = capital >= 150 ? 8 : 4;
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: mainAction(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: secondAction(p, capital, chain), cost: 'about $' + Math.round(capital / 4) + ' moved and about $3 of gas', time: '10 minutes' },
      { text: weeklyAction(p, capital, chain), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
    ];
    return steps.map(function (s) {
      var out = s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.';
      if (out.length > 600) out = out.slice(0, 596) + '...';
      if (out.length < 20) out = out + " Hold the position and check the protocol's own page.";
      return out;
    });
  }

  // -- shareable state in the URL hash --------------------------------------

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('tier')) state.tier = params.get('tier');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }

  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.tier !== 'all') params.set('tier', state.tier);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // -- filtering and sorting -------------------------------------------------

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.tier !== 'all' && r.tier !== state.tier) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sortValue(row, key) {
    if (key === 'name') return row.name.toLowerCase();
    if (key === 'tvl') return row.tvl_usd;
    if (key === 'growth') return row.change_7d == null ? -Infinity : row.change_7d;
    if (key === 'age') return row.age_days == null ? Infinity : row.age_days;
    if (key === 'peer') return row.peer_multiple;
    return row.implied_value_usd;
  }

  function sortRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av = sortValue(a, key);
      var bv = sortValue(b, key);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // -- board table -----------------------------------------------------------

  function tierBadge(tier) {
    if (tier === 'watchlist') return '<span class="tier watch">watchlist</span>';
    if (tier === 'extended') return '<span class="tier ext">extended</span>';
    return '';
  }

  function boardRow(r, maxImplied) {
    var growth = r.change_7d == null ? 'n/a' : pct(r.change_7d);
    var growthClass = r.change_7d == null ? '' : r.change_7d >= 0 ? 'up' : 'down';
    var chains = r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain';
    var width = Math.max(3, Math.round((r.implied_value_usd / maxImplied) * 100));
    return '<tr data-slug="' + esc(r.slug) + '" data-selected="' + (state.selected === r.slug) + '" tabindex="0">' +
      '<td class="num">' + r.rank + '</td>' +
      '<td><div class="who"><b>' + esc(r.name) + tierBadge(r.tier) + '</b><span>' + esc(r.category || 'Other') + ' on ' + esc(chains) + '</span></div></td>' +
      '<td class="num">' + usd(r.tvl_usd) + '</td>' +
      '<td class="num ' + growthClass + '">' + growth + '</td>' +
      '<td class="num">' + ageLabel(r.age_days) + '</td>' +
      '<td class="num">' + mult(r.peer_multiple) + 'x</td>' +
      '<td><div class="value"><div class="meter" aria-hidden="true"><i style="width:' + width + '%"></i></div><span class="num">' + usd(r.implied_value_usd) + '</span></div></td>' +
      '<td><span class="badge">no token</span></td></tr>';
  }

  function sortHeader(key, label) {
    var arrow = state.sort === key ? (state.dir < 0 ? ' v' : ' ^') : '';
    return '<th scope="col"><button type="button" data-sort="' + key + '">' + label + esc(arrow) + '</button></th>';
  }

  function boardTable() {
    var list = sortRows(visibleRows());
    if (list.length === 0) {
      return '<div class="card"><div class="empty"><h2>No protocol matches that filter</h2>' +
        '<p>Clear the search or pick another category to see the board again.</p>' +
        '<button class="btn primary" type="button" data-clear="1">Clear filters</button></div></div>';
    }
    var head = '<tr>' + sortHeader('implied', 'Rank') + sortHeader('name', 'Protocol') + sortHeader('tvl', 'TVL') +
      sortHeader('growth', '7d') + sortHeader('age', 'Age') + sortHeader('peer', 'Peer') + sortHeader('implied', 'Implied value') +
      '<th scope="col">Token</th></tr>';
    var max = list[0].implied_value_usd || 1;
    return '<div class="card"><div class="scroll"><table><caption>Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.</caption>' +
      '<thead>' + head + '</thead><tbody>' + list.map(function (r) { return boardRow(r, max); }).join('') + '</tbody></table></div></div>';
  }

  // -- live-token table ------------------------------------------------------

  function liveTable() {
    var rows = DATA.live.map(function (r) {
      var chains = r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain';
      return '<tr><td class="num">live</td><td><div class="who"><b>' + esc(r.name) + '</b><span>' + esc(r.category || 'Other') + ' on ' + esc(chains) + '</span></div></td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d != null && r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + usd(r.mcap_usd) + '</td><td><span class="badge live">already trades</span></td></tr>';
    }).join('');
    return '<div class="card"><div class="scroll"><table><caption>Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.</caption>' +
      '<thead><tr><th scope="col">Status</th><th scope="col">Protocol</th><th scope="col">TVL</th><th scope="col">7d</th><th scope="col">Market cap</th><th scope="col">Token</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }

  // -- category leaders ------------------------------------------------------
  //
  // One card per category: the strongest pre-token protocol in it. A card is
  // a filter shortcut — selecting it shows that category on the board — so the
  // panel is the page's map of where the strongest launches sit. The rows
  // arrive ranked, so the first row of a category is its leader; the check
  // below keeps that true even if the order ever changes.

  function categoryLeaders() {
    var best = {};
    DATA.rows.forEach(function (r) {
      var key = r.category || 'Other';
      if (!best[key] || r.rank < best[key].rank) best[key] = r;
    });
    return Object.keys(best).map(function (key) { return best[key]; })
      .sort(function (a, b) { return a.rank - b.rank; });
  }

  function renderLeaders(section) {
    var grid = section.querySelector('#leader-grid');
    var count = section.querySelector('#leader-count');
    if (!grid) return;
    var leaders = categoryLeaders();
    if (count) count.textContent = '(' + leaders.length + ' categories)';
    grid.innerHTML = leaders.map(function (r) {
      var category = r.category || 'Other';
      var active = state.category === category;
      var tier = r.tier === 'watchlist' ? 'watchlist' : r.tier === 'early' ? 'early' : 'extended';
      return '<button type="button" class="leader-card' + (active ? ' active' : '') + '" data-leader="' + esc(category) + '" aria-pressed="' + active + '">' +
        '<span class="leader-rank">#' + r.rank + ' &middot; ' + esc(tier) + '</span>' +
        '<span class="leader-name">' + esc(r.name) + '</span>' +
        '<span class="leader-value">' + usd(r.implied_value_usd) + ' implied</span>' +
        '<span class="leader-cat">' + esc(category) + '</span></button>';
    }).join('');
  }

  // -- model explainer -------------------------------------------------------

  function calibrationPanel() {
    var c = DATA.calibration;
    if (!c) return '';
    return '<section class="card model calib"><h2>Validated, not guessed</h2>' +
      '<p>Every live-token protocol in the snapshot was scored as if it were pre-token, with its peer tables built from the other live protocols only, and the model\u2019s value compared with its actual market cap (' + c.live_protocols + ' live protocols). radar-3 missed by a log-RMSE of ' + c.radar3_rmse_tune + ' on the tune half and ' + c.radar3_rmse_holdout + ' on the held-out half, rank correlation ' + c.radar3_spearman_tune + ' / ' + c.radar3_spearman_holdout + '. radar-4 misses by ' + c.radar4_rmse_tune + ' / ' + c.radar4_rmse_holdout + ', rank correlation ' + c.radar4_spearman_tune + ' / ' + c.radar4_spearman_holdout + '. The noisy inputs were damped where the test said they were over-weighted: growth 0.65 to 0.30, maturity floor 0.50 to 0.70, peer shrink 5 to 8, chain clamp 0.8..1.3 to 0.7..1.2. A log-RMSE near 2 means a typical value is off by roughly an order of magnitude, so the model ranks launches; it does not price them.</p></section>';
  }

  function modelPanel() {
    var m = DATA.model;
    var peers = DATA.peers.slice(0, 12).map(function (p) {
      return '<tr><td>' + esc(p.category) + '</td><td class="num">' + mult(p.multiple) + 'x</td><td class="num">' + p.protocols + '</td></tr>';
    }).join('');
    return '<section class="card model"><h2>How implied value is computed</h2>' +
      '<p>Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.</p>' +
      '<div class="formula">implied = round( tvl_usd x peer(category) x chain(avg of all chains) x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )</div>' +
      '<p>TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The peer multiple is the geometric median market-cap-to-TVL ratio of the live-token protocols in that category, the median of the log ratios, exponentiated: ratios span orders of magnitude, so an arithmetic median is dragged by the fat tail. Ratios are winsorized to 0.02..5.0 before the median is taken, so one extreme outlier cannot move it, and the median is shrunk toward the global median in log space when a category has fewer than ' + m.peer_shrink + ' live peers, so one protocol cannot set a whole category\u2019s price. The chain multiple averages the same ratio over every chain the protocol names, relative to the global median, so a protocol on several chains is valued by all of them, not only its first. The early radar is every pre-token protocol below the watchlist floor under the watchlist\u2019s own strict rule; the extended tier adds the next pre-token protocols the strict rule leaves out, bridges, liquid-staking products and versioned pools among them.</p>' +
      '</section>' +
      '<section class="card model peers"><h2>Peer multiples, derived from the live set</h2>' +
      '<p>The twelve richest categories by peer multiple. Each multiple is the winsorized geometric median market cap per dollar of TVL among the live-token protocols in that category.</p>' +
      '<div class="scroll"><table><thead><tr><th scope="col">Category</th><th scope="col">Peer multiple</th><th scope="col">Live peers</th></tr></thead><tbody>' + peers + '</tbody></table></div></section>' +
      calibrationPanel() +
      '<p class="note">Implied value is this entry\u2019s own claim, never a price and never a prediction that a token will launch. A protocol on this board records no token in the snapshot; that is the record, not proof it has none.</p>';
  }

  // -- detail drawer ---------------------------------------------------------

  var dialog = document.createElement('dialog');
  dialog.className = 'drawer';
  dialog.id = 'detail';
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].slug === slug) { row = DATA.rows[i]; break; }
    }
    if (!row) return;
    state.selected = slug;
    writeHash();
    var recomputed = impliedOf(row, DATA.model);
    var agree = recomputed === row.implied_value_usd;
    var steps = farmSteps(row).map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return '<li><b>' + esc(action) + '</b><span class="cost">' + esc(tail) + '</span></li>';
    }).join('');
    var chains = row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain';
    var chainCount = row.chain_count == null ? 0 : row.chain_count;
    var chainLabel = chainCount === 0
      ? 'Chain multiple (no chain listed)'
      : 'Chain multiple (avg of ' + chainCount + ' chain' + (chainCount === 1 ? '' : 's') + ')';
    dialog.innerHTML =
      '<div class="drawer-head"><div><span class="kicker">Rank ' + row.rank + ' of ' + DATA.board_size + ' &middot; ' + esc(row.tier) + '</span>' +
      '<h2 id="detail-title">' + esc(row.name) + '</h2>' +
      '<p class="sub">' + esc(row.category || 'Other') + ' on ' + esc(chains) + '</p></div>' +
      '<button class="close-btn" type="button" data-close="1" aria-label="Close details">Close</button></div>' +
      '<section><h3>Implied value</h3><div class="math">' +
      '<div><span>TVL</span><b>' + usd(row.tvl_usd) + '</b></div>' +
      '<div><span>Seven-day growth</span><b>' + pct(row.change_7d) + '</b></div>' +
      '<div><span>Age with no token</span><b>' + ageLabel(row.age_days) + '</b></div>' +
      '<div><span>Peer multiple (' + esc(row.category || 'Other') + ', ' + row.peer_protocols + ' live peer' + (row.peer_protocols === 1 ? '' : 's') + ')</span><b>' + mult(row.peer_multiple) + 'x</b></div>' +
      '<div><span>' + esc(chainLabel) + '</span><b>' + mult(row.chain_multiplier) + 'x</b></div>' +
      '<div><span>Growth multiplier</span><b>' + mult(row.growth_multiplier) + 'x</b></div>' +
      '<div><span>Maturity multiplier</span><b>' + mult(row.maturity_multiplier) + 'x</b></div>' +
      '<div><span>Implied value</span><b>' + usd(row.implied_value_usd) + '</b></div></div>' +
      '<p class="fine">Model ' + esc(DATA.model_version) + ': the same function scores every protocol. The page recomputes this row as ' + usd(recomputed) +
      (agree ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.</p></section>' +
      '<section><h3>Farm plan</h3><ol class="steps">' + steps + '</ol></section>';
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // -- render ----------------------------------------------------------------

  function render() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var catOptions = '<option value="all">All categories</option>' + categories.map(function (c) {
      return '<option value="' + esc(c) + '"' + (c === state.category ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var shown = state.tab === 'pre-token' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols';
    var html =
      '<div class="wrap">' +
      '<header class="masthead"><div class="brand"><span class="sweep"></span><span class="brand-name">Token Radar</span></div>' +
      '<div class="masthead-meta"><span>Snapshot ' + esc(DATA.as_of) + '</span><span>DefiLlama protocol index</span><span>' + esc(DATA.model_version) + ' model</span></div></header>' +
      '<section class="intro"><div><h1>' + DATA.watchlist_size + ' watchlist protocols, ranked by implied value</h1>' +
      '<p>The watchlist is the floor: every protocol with at least <b>$' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL</b> and no token on record. The early radar adds <b>' + DATA.early_size + ' pre-token protocols</b> below that floor, and the extended tier adds <b>' + DATA.extended_size + ' more</b>. Implied value is a model, not a promise.</p></div>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b><span>Watchlist covered</span></div>' +
      '<div class="stat"><b>' + DATA.board_size + '</b><span>Pre-token rows scored</span></div>' +
      '<div class="stat"><b>' + DATA.early_size + '</b><span>Early rows below the floor</span></div>' +
      '<div class="stat"><b>' + DATA.live_size + '</b><span>Live-token protocols set aside</span></div>' +
      '</div></section>' +
      '<div class="controls">' +
      '<div class="field"><label for="q">Search</label><input type="search" id="q" placeholder="Search name, category or chain" value="' + esc(state.q) + '" aria-label="Search the board"></div>' +
      '<div class="field"><label for="category">Category</label><select id="category" aria-label="Filter by category">' + catOptions + '</select></div>' +
      '<div class="field"><label for="tier">Tier</label><select id="tier" aria-label="Filter by tier">' +
      '<option value="all"' + (state.tier === 'all' ? ' selected' : '') + '>All tiers</option>' +
      '<option value="watchlist"' + (state.tier === 'watchlist' ? ' selected' : '') + '>Watchlist</option>' +
      '<option value="early"' + (state.tier === 'early' ? ' selected' : '') + '>Early</option>' +
      '<option value="extended"' + (state.tier === 'extended' ? ' selected' : '') + '>Extended</option></select></div>' +
      '<div class="field"><span>Token status</span><div class="seg">' +
      '<button type="button" data-tab="pre-token" aria-pressed="' + (state.tab === 'pre-token') + '">Pre-token</button>' +
      '<button type="button" data-tab="live" aria-pressed="' + (state.tab === 'live') + '">Live token</button>' +
      '</div></div>' +
      '<span class="shown">' + shown + '</span></div>' +
      (state.tab === 'pre-token' ? boardTable() : liveTable()) +
      (state.tab === 'pre-token' ? modelPanel() : '') +
      '</div>';
    // The leaders panel is a static section in index.html; the board is
    // redrawn around it, so keep it and put it back above the board.
    var leadersEl = document.getElementById('leaders');
    app.innerHTML = html;
    app.setAttribute('aria-busy', 'false');
    if (leadersEl) {
      var wrap = app.querySelector('.wrap');
      var firstCard = wrap ? wrap.querySelector('.card') : null;
      if (wrap && firstCard) wrap.insertBefore(leadersEl, firstCard);
      else if (wrap) wrap.appendChild(leadersEl);
      renderLeaders(leadersEl);
    }
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
    window.__shotReady = true;
  }

  // -- events ----------------------------------------------------------------

  app.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'q') {
      state.q = e.target.value;
      var caret = e.target.selectionStart;
      writeHash();
      render();
      var q = document.getElementById('q');
      if (q) {
        q.focus();
        try { q.setSelectionRange(caret, caret); } catch (err) { /* older input types */ }
      }
    }
  });

  app.addEventListener('change', function (e) {
    if (!e.target) return;
    if (e.target.id === 'category') { state.category = e.target.value; writeHash(); render(); }
    if (e.target.id === 'tier') { state.tier = e.target.value; writeHash(); render(); }
  });

  app.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== app) {
      if (t.getAttribute) {
        if (t.getAttribute('data-tab')) { state.tab = t.getAttribute('data-tab'); render(); return; }
        if (t.getAttribute('data-leader')) {
          state.tab = 'pre-token';
          state.category = t.getAttribute('data-leader');
          writeHash();
          render();
          return;
        }
        if (t.getAttribute('data-sort')) {
          var key = t.getAttribute('data-sort');
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = -1; }
          render();
          return;
        }
        if (t.getAttribute('data-clear')) { state.q = ''; state.category = 'all'; state.tier = 'all'; writeHash(); render(); return; }
        if (t.getAttribute('data-close')) { dialog.close(); return; }
        if (t.getAttribute('data-slug')) { openDetail(t.getAttribute('data-slug')); return; }
      }
      t = t.parentNode;
    }
  });

  app.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.getAttribute && e.target.getAttribute('data-slug')) {
      e.preventDefault();
      openDetail(e.target.getAttribute('data-slug'));
    }
  });

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });

  readHash();
  render();
})();
