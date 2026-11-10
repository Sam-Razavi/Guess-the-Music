// Team bookkeeping shared by the team games (Gol ya Pooch, Pantomime).
// Teams are per game, not the music game's free-text team field: the host
// shuffles/moves people on the host page, and anyone who joins later is
// dropped into the smallest team so nobody is left out.

const { splitTeams } = require('./common');

const TEAM_IDS = ['red', 'blue', 'green', 'gold'];

function createTeams(count = 2) {
  return { ids: TEAM_IDS.slice(0, count), members: Object.fromEntries(TEAM_IDS.slice(0, count).map(id => [id, []])) };
}

function teamOfPlayer(teams, pid) {
  return teams.ids.find(t => teams.members[t].includes(pid)) || null;
}

function shuffleTeams(teams, playerIds) {
  const split = splitTeams(playerIds, teams.ids.length);
  teams.ids.forEach((t, i) => { teams.members[t] = split[i]; });
}

// Keep teams in step with the roster: drop players who no longer exist, and
// put anyone who's online but not on a team yet into the smallest team.
// Offline players keep their team (so a phone that drops out for a minute
// comes back to the same side) — the games just leave them out while away.
// Returns true if anything changed.
function syncTeams(teams, onlineIds, knownIds) {
  let changed = false;
  const known = new Set(knownIds || onlineIds);
  for (const t of teams.ids) {
    const before = teams.members[t].length;
    teams.members[t] = teams.members[t].filter(id => known.has(id));
    if (teams.members[t].length !== before) changed = true;
  }
  for (const id of onlineIds) {
    if (teamOfPlayer(teams, id)) continue;
    const smallest = teams.ids.reduce((a, b) => (teams.members[b].length < teams.members[a].length ? b : a));
    teams.members[smallest].push(id);
    changed = true;
  }
  return changed;
}

function movePlayer(teams, pid, toTeam) {
  if (!teams.ids.includes(toTeam)) return false;
  for (const t of teams.ids) teams.members[t] = teams.members[t].filter(id => id !== pid);
  teams.members[toTeam].push(pid);
  return true;
}

function setTeamCount(teams, count, playerIds) {
  const n = Math.min(TEAM_IDS.length, Math.max(2, count));
  if (n === teams.ids.length) return;
  const fresh = createTeams(n);
  teams.ids = fresh.ids;
  teams.members = fresh.members;
  shuffleTeams(teams, playerIds);
}

module.exports = { TEAM_IDS, createTeams, teamOfPlayer, shuffleTeams, syncTeams, movePlayer, setTeamCount };
