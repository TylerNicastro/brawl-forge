// ═══════════════════════════════════════════════════════════
//  STATS SYSTEM  — BrawlForge
//  Persists in localStorage as JSON blobs
// ═══════════════════════════════════════════════════════════

const STATS_KEY = 'brawlforge_stats_v1';
const SESSION_KEY = 'brawlforge_session_v1';

const StatsSystem = (() => {

  // Default global stats schema
  const defaultStats = () => ({
    version: 1,
    player: {
      name: 'Unknown',
      totalGames: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      totalKills: 0,
      totalDeaths: 0,
      totalDamageDealt: 0,
      totalDamageTaken: 0,
      totalTimePlayedSeconds: 0,
      longestWinStreak: 0,
      currentWinStreak: 0,
      favoriteCharacter: null,
      createdAt: Date.now(),
      lastPlayedAt: null,
    },
    characters: {},  // { characterId: charStats }
    maps: {},        // { mapId: mapStats }
    matches: [],     // last 50 match records
    achievements: [],
  });

  const defaultCharStats = () => ({
    gamesPlayed: 0,
    wins: 0,
    kills: 0,
    deaths: 0,
    damageDealt: 0,
    damageTaken: 0,
    abilityUseCounts: {}, // { abilityName: count }
    mostUsedAbility: null,
  });

  const defaultMapStats = () => ({
    gamesPlayed: 0,
    wins: 0,
  });

  // ─── LOAD / SAVE ───
  function load() {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      if (!raw) return defaultStats();
      return { ...defaultStats(), ...JSON.parse(raw) };
    } catch { return defaultStats(); }
  }

  function save(stats) {
    try {
      // Keep only last 50 matches
      if (stats.matches.length > 50) {
        stats.matches = stats.matches.slice(-50);
      }
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch (e) {
      console.warn('[Stats] Could not save:', e);
    }
  }

  function exportJSON() {
    const data = load();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `brawlforge_stats_${Date.now()}.json`;
    a.click();
  }

  // ─── SESSION (in-match tracking) ───
  let _session = null;

  function startSession({ playerName, characterId, mapId, opponentName, isHost }) {
    _session = {
      playerName,
      characterId,
      mapId,
      opponentName,
      isHost,
      startTime: Date.now(),
      kills: 0,
      deaths: 0,
      damageDealt: 0,
      damageTaken: 0,
      abilityUses: {},
      result: null, // 'win' | 'loss' | 'draw'
    };
  }

  function recordKill()   { if (_session) _session.kills++; }
  function recordDeath()  { if (_session) _session.deaths++; }
  function recordDamageDealt(amt) { if (_session) _session.damageDealt += amt; }
  function recordDamageTaken(amt) { if (_session) _session.damageTaken += amt; }
  function recordAbilityUse(name) {
    if (!_session) return;
    _session.abilityUses[name] = (_session.abilityUses[name] || 0) + 1;
  }

  function endSession(result) {
    if (!_session) return;
    _session.result = result;
    _session.duration = (Date.now() - _session.startTime) / 1000;

    const stats = load();
    const s = _session;

    // Global player stats
    stats.player.totalGames++;
    stats.player.lastPlayedAt = Date.now();
    stats.player.totalKills += s.kills;
    stats.player.totalDeaths += s.deaths;
    stats.player.totalDamageDealt += s.damageDealt;
    stats.player.totalDamageTaken += s.damageTaken;
    stats.player.totalTimePlayedSeconds += s.duration;

    if (result === 'win') {
      stats.player.wins++;
      stats.player.currentWinStreak++;
      if (stats.player.currentWinStreak > stats.player.longestWinStreak) {
        stats.player.longestWinStreak = stats.player.currentWinStreak;
      }
    } else if (result === 'loss') {
      stats.player.losses++;
      stats.player.currentWinStreak = 0;
    } else {
      stats.player.draws++;
    }

    // Character stats
    if (!stats.characters[s.characterId]) stats.characters[s.characterId] = defaultCharStats();
    const cs = stats.characters[s.characterId];
    cs.gamesPlayed++;
    if (result === 'win') cs.wins++;
    cs.kills += s.kills;
    cs.deaths += s.deaths;
    cs.damageDealt += s.damageDealt;
    cs.damageTaken += s.damageTaken;
    for (const [ability, count] of Object.entries(s.abilityUses)) {
      cs.abilityUseCounts[ability] = (cs.abilityUseCounts[ability] || 0) + count;
    }
    // Recalculate most used ability
    let maxUse = 0, maxAbility = null;
    for (const [a, c] of Object.entries(cs.abilityUseCounts)) {
      if (c > maxUse) { maxUse = c; maxAbility = a; }
    }
    cs.mostUsedAbility = maxAbility;

    // Map stats
    if (!stats.maps[s.mapId]) stats.maps[s.mapId] = defaultMapStats();
    stats.maps[s.mapId].gamesPlayed++;
    if (result === 'win') stats.maps[s.mapId].wins++;

    // Favorite character
    let mostPlayed = null, maxPlays = 0;
    for (const [cid, cs] of Object.entries(stats.characters)) {
      if (cs.gamesPlayed > maxPlays) { maxPlays = cs.gamesPlayed; mostPlayed = cid; }
    }
    stats.player.favoriteCharacter = mostPlayed;

    // Match history record
    stats.matches.push({
      ts: Date.now(),
      character: s.characterId,
      map: s.mapId,
      opponent: s.opponentName,
      result,
      kills: s.kills,
      deaths: s.deaths,
      damageDealt: Math.round(s.damageDealt),
      damageTaken: Math.round(s.damageTaken),
      duration: Math.round(s.duration),
    });

    // Check achievements
    checkAchievements(stats);

    save(stats);
    _session = null;

    return stats;
  }

  // ─── ACHIEVEMENTS ───
  const ACHIEVEMENT_DEFS = [
    { id: 'first_win',   name: 'First Blood',     desc: 'Win your first match.',    check: s => s.player.wins >= 1 },
    { id: 'win_10',      name: 'Veteran',          desc: 'Win 10 matches.',          check: s => s.player.wins >= 10 },
    { id: 'win_50',      name: 'Champion',         desc: 'Win 50 matches.',          check: s => s.player.wins >= 50 },
    { id: 'kills_100',   name: 'Centurion',        desc: 'Land 100 total kills.',    check: s => s.player.totalKills >= 100 },
    { id: 'streak_5',    name: 'On Fire',          desc: 'Win 5 in a row.',          check: s => s.player.longestWinStreak >= 5 },
    { id: 'damage_10k',  name: 'Destroyer',        desc: 'Deal 10,000 total damage.',check: s => s.player.totalDamageDealt >= 10000 },
    { id: 'play_5maps',  name: 'World Traveler',   desc: 'Play on 5 different maps.',check: s => Object.keys(s.maps).length >= 5 },
    { id: 'play_5chars', name: 'Jack of All',      desc: 'Play as 5 different characters.', check: s => Object.keys(s.characters).length >= 5 },
  ];

  function checkAchievements(stats) {
    for (const def of ACHIEVEMENT_DEFS) {
      if (!stats.achievements.includes(def.id) && def.check(stats)) {
        stats.achievements.push(def.id);
        // Achievement earned — UI can listen for this
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('achievement', { detail: def }));
        }, 500);
      }
    }
  }

  // ─── GETTERS ───
  function getPlayerName() {
    const s = load();
    return s.player.name;
  }

  function setPlayerName(name) {
    const s = load();
    s.player.name = name;
    save(s);
  }

  function getSummary() {
    const s = load();
    return {
      ...s.player,
      winRate: s.player.totalGames > 0
        ? ((s.player.wins / s.player.totalGames) * 100).toFixed(1)
        : '0.0',
      kdRatio: s.player.totalDeaths > 0
        ? (s.player.totalKills / s.player.totalDeaths).toFixed(2)
        : s.player.totalKills.toString(),
      achievements: s.achievements,
      achievementDefs: ACHIEVEMENT_DEFS,
    };
  }

  function getCharStats(id) {
    const s = load();
    return s.characters[id] || defaultCharStats();
  }

  function getRecentMatches(n = 10) {
    const s = load();
    return s.matches.slice(-n).reverse();
  }

  function resetStats() {
    localStorage.removeItem(STATS_KEY);
  }

  return {
    load, save, exportJSON,
    startSession, recordKill, recordDeath,
    recordDamageDealt, recordDamageTaken, recordAbilityUse,
    endSession,
    getPlayerName, setPlayerName,
    getSummary, getCharStats, getRecentMatches,
    resetStats,
    ACHIEVEMENT_DEFS,
  };
})();

window.StatsSystem = StatsSystem;
