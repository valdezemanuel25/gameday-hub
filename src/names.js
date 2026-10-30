// Club-name and price helpers shared by the price sources (src/btts.js, src/pinn.js).
import { is as isName } from './forebetpage.js';

// ESPN abbreviates some clubs the feeds spell out ("Athletico-PR" against "Athletico Paranaense"); the full name is tried as well.
export const spell = n => String(n || '').replace(/\bPR\b/, 'Paranaense').replace(/\bMG\b/, 'Mineiro');
export const same = (a, b) => isName(a, b) || isName(spell(a), b) || isName(a, spell(b));
// A decimal price as American odds, or null when it is not a price.
export const americanOf = d => { const x = Number(d); return Number.isFinite(x) && x > 1 ? Math.round(x >= 2 ? (x - 1) * 100 : -100 / (x - 1)) : null; };
