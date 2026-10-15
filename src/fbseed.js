// Forebet 1/X/2 percentages and predicted scores for the Europa League games of Oct 15, 2026, read from
// forebet.com's league page at about 10:30 AM Central, before the first kickoff (11:45 AM). Entered by hand,
// never read by any model. rows = [home, away, home %, draw %, away %, predicted score, Over 2.5 %, both-teams-score Yes %].
// (Over and Yes read from Forebet's Under/Over and Both-to-score tables; checked against the first rows on screen.)
export default {
  '2026-10-15': {
    capturedAt: '2026-10-15T15:30:00Z',
    rows: [
      ['AZ Alkmaar', 'Hapoel Beer Sheva', 43, 36, 21, '1-0', 34, 48],
      ['Union Saint-Gilloise', 'Real Sociedad', 39, 28, 33, '2-1', 58, 55],
      ['União Torreense', 'Sunderland', 32, 26, 42, '1-3', 59, 55],
      ['Lech Poznań', 'Bayer Leverkusen', 32, 26, 42, '1-3', 71, 71],
      ['Lyon', 'Crystal Palace', 48, 27, 25, '3-1', 57, 58],
      ['Sparta Praha', 'Lillestrøm SK', 40, 35, 25, '2-0', 50, 44],
      ['Celje', 'Omonia Nicosia', 24, 25, 51, '0-2', 42, 46],
      ['RB Salzburg', 'Milan', 30, 32, 38, '1-2', 58, 61],
      ['Dinamo Zagreb', 'Anderlecht', 29, 25, 46, '0-2', 43, 45],
      ['Olympique Marseille', 'Olympiacos', 41, 28, 31, '1-0', 38, 39],
      ['Celta Vigo', 'Juventus', 20, 36, 44, '0-1', 49, 44],
      ['Bournemouth', 'Sturm Graz', 42, 30, 28, '1-0', 49, 48],
      ['Rennes', 'OFI Creta', 52, 19, 29, '3-0', 59, 40],
      ['Jagiellonia', 'Ararat-Armenia', 38, 33, 29, '2-1', 61, 69],
      ['SL Benfica', 'Celtic', 55, 25, 20, '3-0', 54, 46],
      ['Hoffenheim', 'Beşiktaş', 33, 31, 36, '0-1', 50, 46],
      ['Ferencváros', 'Viktoria Plzeň', 36, 37, 27, '0-0', 46, 49],
      ['Nijmegen', 'Levski Sofia', 21, 45, 34, '1-1', 39, 67],
    ],
  },
};
