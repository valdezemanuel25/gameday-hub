// bet365 early payout: goal order from ESPN, the biggest lead each side had, and how picks and tracked bets are paid.
import { goalSeq, maxLead, earlyPaid, EARLY } from '../src/early.js';
import { goalPlays } from '../src/data.js';
import { leadFromSummary } from '../src/nhl.js';
import { settle, epOpen } from '../src/bets.js';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${c ? '' : x}`); };

ok('rules: soccer 2 goals, NHL 3', EARLY.soccer === 2 && EARLY.nhl === 3);
// soccer: 2-0 up, ends 2-2 (ESPN details out of order, sorted by the clock)
const det = [{ scoringPlay: true, team: { id: '9' }, clock: { value: 3000 } }, { scoringPlay: true, team: { id: '5' }, clock: { value: 600 } }, { scoringPlay: true, team: { id: '5' }, clock: { value: 1800 } },
  { type: { text: 'Yellow Card' }, team: { id: '9' }, clock: { value: 2000 } }, { scoringPlay: true, team: { id: '9' }, clock: { value: 5000 } }];
const seq = goalSeq(goalPlays(det), '5', '9', 2, 2);
ok('soccer: goals sorted by the clock, cards left out', seq && seq.join('') === 'hhaa', JSON.stringify(seq));
ok('soccer: home led by 2 at one point', JSON.stringify(maxLead(seq)) === '[2,0]');
ok('2 up then drew: paid early', earlyPaid('H', false, [2, 0]) === true);
ok('never 2 up and lost: not paid', earlyPaid('H', false, [1, 1]) === false);
ok('away pick reads the away lead', earlyPaid('A', false, [0, 2]) === true && earlyPaid('A', false, [2, 1]) === false);
ok('a draw, Over or both-score pick is not a moneyline: no answer', earlyPaid('D', false, [2, 0]) === null && earlyPaid('O', false, [2, 0]) === null);
ok('no goal times: no answer, even for a win (so the record only counts known games)', earlyPaid('H', true, null) === null);
ok('NHL needs 3', earlyPaid('H', false, [2, 0], 'nhl') === false && earlyPaid('H', false, [3, 0], 'nhl') === true);
// own goals: ESPN may name the scorer's team; only the reading that adds up to the final is kept
const og = goalPlays([{ scoringPlay: true, team: { id: '5' }, clock: { value: 100 } }, { scoringPlay: true, ownGoal: true, team: { id: '9' }, clock: { value: 200 } }]);
ok('own goal named for the scorer\'s team is credited to the other side when that matches the final', goalSeq(og, '5', '9', 2, 0).join('') === 'hh');
ok('own goal already credited to the team that benefits is kept', goalSeq(og, '5', '9', 1, 1).join('') === 'ha');
ok('goals that do not add up to the final: unknown', goalSeq(goalPlays(det), '5', '9', 3, 2) === null);
ok('penalty shootout left out', goalSeq(goalPlays([{ scoringPlay: true, team: { id: '5' }, clock: { value: 100 } }, { scoringPlay: true, shootout: true, team: { id: '9' } }]), '5', '9', 1, 0).join('') === 'h');
ok('no details from ESPN: null', goalPlays(undefined) === null && maxLead(goalSeq(null, '5', '9', 1, 0)) === null);
// hockey summary: 3-0 up, lost 4-3 in a shootout (the shootout winner's goal is in the final score)
const sum = { header: { competitions: [{ competitors: [{ homeAway: 'home', team: { id: '1' } }, { homeAway: 'away', team: { id: '2' } }] }] },
  plays: [{ scoringPlay: true, team: { id: '1' }, period: { number: 1 } }, { scoringPlay: true, team: { id: '1' }, period: { number: 1 } }, { scoringPlay: true, team: { id: '1' }, period: { number: 2 } },
    { scoringPlay: false, team: { id: '2' } }, { scoringPlay: true, team: { id: '2' }, period: { number: 2 } }, { scoringPlay: true, team: { id: '2' }, period: { number: 3 } }, { scoringPlay: true, team: { id: '2' }, period: { number: 3 } },
    { scoringPlay: true, team: { id: '2' }, period: { number: 5 }, shootoutPlay: true }] };
const hl = leadFromSummary(sum, { h: 3, a: 4, last: 'SO' });
ok('hockey: 3-0 lead found, shootout goal left out', JSON.stringify(hl) === '[3,0]', JSON.stringify(hl));
ok('hockey: home pick that lost in the shootout is paid early', earlyPaid('H', false, hl, 'nhl') === true);
ok('hockey: summary that does not add up is unknown', leadFromSummary(sum, { h: 5, a: 4, last: 'REG' }) === null);
// tracked bets: a 2-leg parlay whose missed leg went 2 up
const cards = new Map([['2026-10-30|bra.1|1', { final: { h: 2, a: 2, lead: [2, 0] } }], ['2026-10-30|bra.1|2', { final: { h: 1, a: 0, lead: [1, 0] } }]]);
const leg = (id, market, sel) => ({ date: '2026-10-30', league: 'bra.1', id, market, sel });
const bet = { status: 'pending', legs: [leg('1', 'win', 'H'), leg('2', 'win', 'H')] };
settle(bet, cards);
ok('bet: missed as normal, paid with early payout', bet.status === 'miss' && bet.ep === 'hit' && bet.legs[0].ep === true && bet.legs[1].ep === true, JSON.stringify(bet));
const b2 = { status: 'pending', legs: [leg('1', 'btts', 'N'), leg('2', 'win', 'H')] };
settle(b2, cards);
ok('bet: a missed leg that is not a moneyline still loses', b2.status === 'miss' && b2.ep === 'miss');
const b3 = { status: 'pending', legs: [leg('3', 'win', 'H')] };
const c3 = new Map([['2026-10-30|bra.1|3', { final: { h: 0, a: 1 } }]]);
settle(b3, c3);
ok('bet: no goal times yet: early result waits, the bet stays open for it', b3.status === 'miss' && b3.ep === undefined && epOpen(b3));
c3.get('2026-10-30|bra.1|3').final.lead = [0, 1]; settle(b3, c3);
ok('bet: goal times arrive later and settle it', b3.ep === 'miss' && !epOpen(b3));
console.log(fails ? `\n${fails} FAILED` : '\nAll early-payout checks passed'); process.exit(fails ? 1 : 0);
