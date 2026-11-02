// Club-name and price helpers shared by the price sources (src/btts.js, src/pinn.js).
import { is as isName } from './forebetpage.js';

// ESPN abbreviates some clubs the feeds spell out ("Athletico-PR" against "Athletico Paranaense"); the full name is tried as well.
export const spell = n => String(n || '').replace(/\bPR\b/, 'Paranaense').replace(/\bMG\b/, 'Mineiro');
// German umlauts written out ("Nuernberg", "Osnabrueck") and reserve sides as "II" or "B" ("Real Sociedad II" / "Real Sociedad B"):
// both names are rewritten the same way and tried again (Nov 2, 2026: 2. Bundesliga and La Liga 2 names on Pinnacle).
const flat = n => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ue/gi, 'u').replace(/oe/gi, 'o').replace(/ae/gi, 'a').replace(/\bII\b/g, 'B');
export const same = (a, b) => isName(a, b) || isName(spell(a), b) || isName(a, spell(b)) || isName(flat(a), flat(b));
// A decimal price as American odds, or null when it is not a price.
export const americanOf = d => { const x = Number(d); return Number.isFinite(x) && x > 1 ? Math.round(x >= 2 ? (x - 1) * 100 : -100 / (x - 1)) : null; };
