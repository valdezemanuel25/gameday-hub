// Clubs seen in the Champions League / Europa League files, and the spellings ESPN uses for them.
// name = the name used in the cup history (v4cupseed.js).  group = domestic league slug (when the Hub keeps that
// league's history) or a country code.  dom = [league slug, ESPN name in that league].  also = other spellings.
const D = (slug, rows) => rows.map(([name, dom, ...also]) => ({ name, group: slug, dom: [slug, dom], also }));
const O = (group, rows) => rows.map(([name, ...also]) => ({ name, group, dom: null, also }));
export const CLUBS = [
  ...D('eng.1', [['Arsenal', 'Arsenal'], ['Aston Villa', 'Aston Villa'], ['Bournemouth', 'AFC Bournemouth', 'Bournemouth'], ['Chelsea', 'Chelsea'], ['Crystal Palace', 'Crystal Palace'], ['Liverpool', 'Liverpool'], ['Man City', 'Manchester City'], ['Man Utd', 'Manchester United', 'Manchester Utd'], ['Newcastle', 'Newcastle United'], ["Nott'm Forest", 'Nottingham Forest'], ['Sunderland', 'Sunderland'], ['Tottenham', 'Tottenham Hotspur', 'Spurs']]),
  ...D('esp.1', [['Athletic Club', 'Athletic Club', 'Athletic Bilbao'], ['Atleti', 'Atlético Madrid', 'Atletico Madrid', 'Atletico de Madrid'], ['Barcelona', 'Barcelona', 'FC Barcelona'], ['Celta', 'Celta Vigo', 'Celta de Vigo'], ['Girona', 'Girona'], ['Real Betis', 'Real Betis', 'Betis', 'Real Betis Seville'], ['Real Madrid', 'Real Madrid'], ['Real Sociedad', 'Real Sociedad'], ['Villarreal', 'Villarreal']]),
  ...D('ger.1', [['B. Dortmund', 'Borussia Dortmund', 'Dortmund'], ['Bayern München', 'Bayern Munich', 'Bayern Munchen', 'Bayern'], ['Frankfurt', 'Eintracht Frankfurt'], ['Freiburg', 'SC Freiburg'], ['Hoffenheim', 'TSG Hoffenheim'], ['Leipzig', 'RB Leipzig'], ['Leverkusen', 'Bayer Leverkusen'], ['Stuttgart', 'VfB Stuttgart']]),
  ...D('ita.1', [['Atalanta', 'Atalanta'], ['Bologna', 'Bologna'], ['Como', 'Como', 'Como 1907'], ['Inter', 'Internazionale', 'Inter Milan'], ['Juventus', 'Juventus'], ['Lazio', 'Lazio'], ['Milan', 'AC Milan'], ['Napoli', 'Napoli'], ['Roma', 'AS Roma']]),
  ...D('fra.1', [['Brest', 'Brest'], ['Lens', 'Lens'], ['Lille', 'Lille'], ['Lyon', 'Lyon', 'Olympique Lyonnais'], ['Marseille', 'Marseille', 'Olympique Marseille'], ['Monaco', 'AS Monaco'], ['Nice', 'Nice'], ['Paris', 'Paris Saint-Germain', 'Paris SG', 'PSG'], ['Rennes', 'Stade Rennais', 'Rennes']]),
  ...D('ned.1', [['AZ Alkmaar', 'AZ Alkmaar', 'AZ'], ['Ajax', 'Ajax Amsterdam', 'Ajax'], ['Feyenoord', 'Feyenoord Rotterdam', 'Feyenoord'], ['Go Ahead Eagles', 'Go Ahead Eagles'], ['N.E.C.', 'NEC Nijmegen', 'NEC'], ['PSV', 'PSV Eindhoven', 'PSV'], ['Twente', 'FC Twente', 'Twente'], ['Utrecht', 'FC Utrecht', 'Utrecht']]),
  ...O('BEL', [['Anderlecht'], ['Club Brugge', 'Club Brugge KV'], ['Genk', 'KRC Genk'], ['Union SG', 'Union St.-Gilloise', 'Union Saint-Gilloise']]),
  ...O('POR', [['Benfica', 'SL Benfica'], ['Braga', 'SC Braga'], ['Porto', 'FC Porto'], ['Sporting CP', 'Sporting Lisbon', 'Sporting Lisboa'], ['Torreense', 'SCU Torreense']]),
  ...O('TUR', [['Besiktas', 'Beşiktaş'], ['Fenerbahçe', 'Fenerbahce', 'Fenerbahce Istanbul'], ['Galatasaray', 'Galatasaray Istanbul']]),
  ...O('GRE', [['AEK Athens', 'AEK Athens FC', 'AEK'], ['OFI Crete', 'OFI'], ['Olympiacos', 'Olympiakos', 'Olympiacos Piraeus'], ['PAOK', 'PAOK Salonika', 'PAOK Thessaloniki'], ['Panathinaikos', 'Panathinaikos Athens']]),
  ...O('AUT', [['LASK', 'LASK Linz'], ['Salzburg', 'RB Salzburg', 'Red Bull Salzburg', 'FC Salzburg'], ['Sturm Graz', 'SK Sturm Graz']]),
  ...O('SCO', [['Celtic', 'Celtic FC'], ['Rangers', 'Rangers FC', 'Glasgow Rangers']]),
  ...O('NOR', [['Bodø/Glimt', 'Bodo/Glimt', 'Bodoe/Glimt', 'Bodo Glimt', 'FK Bodo/Glimt'], ['Brann', 'SK Brann'], ['Lillestrøm', 'Lillestrom', 'Lillestroem'], ['Viking', 'Viking FK']]),
  ...O('SUI', [['Basel', 'FC Basel'], ['Young Boys', 'BSC Young Boys']]),
  ...O('DEN', [['Copenhagen', 'F.C. København', 'FC Copenhagen', 'FC Kobenhavn', 'FC Kopenhagen'], ['Midtjylland', 'FC Midtjylland']]),
  ...O('SWE', [['Elfsborg', 'IF Elfsborg'], ['Malmö', 'Malmo FF', 'Malmö FF', 'Malmo']]),
  ...O('CZE', [['Slavia Praha', 'Slavia Prague'], ['Sparta Praha', 'Sparta Prague'], ['Viktoria Plzen', 'Viktoria Plzeň', 'Viktoria Pilsen', 'FC Viktoria Plzen']]),
  ...O('SVK', [['S. Bratislava', 'Slovan Bratislava', 'SK Slovan Bratislava', 'ŠK Slovan Bratislava']]),
  ...O('UKR', [['Dynamo Kyiv', 'Dynamo Kiev', 'Dinamo Kyiv'], ['Shakhtar', 'Shakhtar Donetsk', 'FC Shakhtar Donetsk']]),
  ...O('SRB', [['Crvena Zvezda', 'Red Star Belgrade', 'Crvena Zvezda Belgrade']]),
  ...O('CRO', [['GNK Dinamo', 'Dinamo Zagreb', 'GNK Dinamo Zagreb']]),
  ...O('HUN', [['Ferencváros', 'Ferencvaros', 'Ferencvarosi TC']]),
  ...O('POL', [['Jagiellonia', 'Jagiellonia Bialystok', 'Jagiellonia Białystok'], ['Lech Poznan', 'Lech Poznań']]),
  ...O('ROU', [['FCSB', 'FCSB Bucharest', 'Steaua Bucharest']]),
  ...O('BUL', [['Ludogorets', 'Ludogorets Razgrad'], ['Levski Sofia', 'PFC Levski Sofia']]),
  ...O('ISR', [['H. Beer-Sheva', "Hapoel Be'er", "Hapoel Be'er Sheva", 'Hapoel Beer Sheva'], ['M. Tel-Aviv', 'Maccabi Tel Aviv', 'Maccabi Tel-Aviv']]),
  ...O('CYP', [['Omonia', 'Omonia Nicosia'], ['Pafos', 'Pafos FC']]),
  ...O('KAZ', [['Kairat Almaty', 'Kairat']]),
  ...O('AZE', [['Qarabag', 'FK Qarabag', 'Qarabağ', 'Karabakh'], ['Sabah', 'Sabah FC', 'Sabah Masazir']]),
  ...O('ARM', [['Ararat-Armenia', 'Ararat Armenia']]),
  ...O('SVN', [['Celje', 'NK Celje']]),
  ...O('LVA', [['RFS', 'FK RFS', 'Riga FS']]),
];
