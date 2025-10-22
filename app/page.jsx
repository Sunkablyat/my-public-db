'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// ---------- helpers ----------
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const percent = (wins, games) => (games > 0 ? ((wins / games) * 100).toFixed(2) : '0.00');

// ---------- page ----------
export default function BasketballApp() {
  const [players, setPlayers] = useState([]);
  const [name, setName] = useState('');

  const [teamCount, setTeamCount] = useState(2);
  const [team1, setTeam1] = useState([]);
  const [team2, setTeam2] = useState([]);
  const [team3, setTeam3] = useState([]);
  const [subs, setSubs] = useState([]);
  const [matchIndex, setMatchIndex] = useState(1);
  const [score1, setScore1] = useState(0);
  const [score2, setScore2] = useState(0);

  const [customMinutes, setCustomMinutes] = useState(10);
  const [timer, setTimer] = useState(600);
  const [running, setRunning] = useState(false);
  const [intervalId, setIntervalId] = useState(null);

  const [notification, setNotification] = useState('');

  const [sortColumn, setSortColumn] = useState('wins');
  const [sortDirection, setSortDirection] = useState('desc');
  const [editing, setEditing] = useState({ id: null, field: null, value: '' });

  // NEW: toggle whether we create a sub when odd number of players (2-team mode)
  const [allowSub, setAllowSub] = useState(true);

  // NEW: weighted (weighstone) toggle and big counter toggle
  const [weightedMode, setWeightedMode] = useState(false);
  const [bigCounterMode, setBigCounterMode] = useState(false);

  // NEW: max difference for weighstones (default 0 per your request)
  const [maxDiff, setMaxDiff] = useState(0);

  useEffect(() => { loadPlayers(); }, []);

  async function loadPlayers() {
    const { data, error } = await supabase.from('players').select('*');
    if (error) { alert('Error loading players: ' + error.message); return; }
    setPlayers(sortList(data));
  }

  function sortList(list) {
    const sorted = [...list].sort((a, b) => {
      const lossesA = (a.games || 0) - (a.wins || 0);
      const lossesB = (b.games || 0) - (b.wins || 0);
      let aVal, bVal;
      switch (sortColumn) {
        case 'name': aVal = (a.name || '').toLowerCase(); bVal = (b.name || '').toLowerCase(); break;
        case 'wins': aVal = a.wins || 0; bVal = b.wins || 0; break;
        case 'losses': aVal = lossesA; bVal = lossesB; break;
        case 'games': aVal = a.games || 0; bVal = b.games || 0; break;
        case 'winrate': aVal = a.games ? a.wins / a.games : 0; bVal = b.games ? b.wins / b.games : 0; break;
        default: aVal = 0; bVal = 0;
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }

  function toggleSort(column) {
    const newDir = sortColumn === column ? (sortDirection === 'asc' ? 'desc' : 'asc') : 'desc';
    setSortColumn(column);
    setSortDirection(newDir);
    setPlayers(prev => sortList(prev));
  }

  async function addPlayer(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const { error } = await supabase.from('players').insert([{ name: trimmed, is_present: false, wins: 0, games: 0 }]);
    if (error) { alert('Error adding player: ' + error.message); return; }
    setName('');
    loadPlayers();
  }

  async function togglePresence(id, current) {
    await supabase.from('players').update({ is_present: !current }).eq('id', id);
    loadPlayers();
  }

  async function removePlayer(id) {
    if (!confirm('Remove this player permanently?')) return;
    await supabase.from('players').delete().eq('id', id);
    loadPlayers();
  }

  async function resetStats(id) {
    if (!confirm('Reset wins and games for this player?')) return;
    await supabase.from('players').update({ wins: 0, games: 0 }).eq('id', id);
    loadPlayers();
  }

  async function saveEdit() {
    const value = parseInt(editing.value, 10);
    if (Number.isNaN(value) || value < 0) { setEditing({ id: null, field: null, value: '' }); return; }
    await supabase.from('players').update({ [editing.field]: value }).eq('id', editing.id);
    setEditing({ id: null, field: null, value: '' });
    loadPlayers();
  }

  // -------------------------
  // Modified randomizeTeams()
  // -------------------------
  function randomizeTeams() {
    // pool = players who are present (selected)
    const present = players.filter(p => p.is_present);
    if (!present.length) {
      // nothing selected
      setTeam1([]); setTeam2([]); setTeam3([]); setSubs([]);
      return;
    }

    // If weighted mode ON, compute weights 1..X for selected players
    // Ties in winrate get same weight (equal rank).
    // Highest gets X, next gets X-1, etc.
    const selectedCount = present.length;
    const weights = new Map();

    if (weightedMode) {
      // compute winrate safely (wins/games), treat games==0 as 0 winrate
      const withRates = present.map(p => {
        const rate = p.games ? (p.wins || 0) / p.games : 0;
        return { ...p, rate };
      });
      // sort descending by rate
      withRates.sort((a, b) => b.rate - a.rate);

      // assign rank groups: same rate => same rank
      let currentRank = 1;
      let lastRate = null;
      for (let i = 0; i < withRates.length; i++) {
        const p = withRates[i];
        if (lastRate === null) {
          // first
        } else {
          if (p.rate < lastRate) {
            currentRank = i + 1;
          } else {
            // same rate => same rank (currentRank unchanged)
          }
        }
        lastRate = p.rate;
        // weight is: selectedCount - (rank - 1) so top rank gets selectedCount
        const w = selectedCount - (currentRank - 1);
        weights.set(p.id, w);
      }
      // For safety, ensure every present player has a weight
      for (const p of present) {
        if (!weights.has(p.id)) weights.set(p.id, 1);
      }
    } else {
      // not weighted: everyone weight 1
      for (const p of present) weights.set(p.id, 1);
    }

    // Now do team assignment
    // Special handling for 2-team mode with bigCounter and weight balancing
    if (teamCount === 2) {
      // Constants and helpers
      const BIG_NAMES = ['Lan', 'Alex', 'Sitar', 'Lukas'];

      // start shuffled pool to avoid stable ordering
      const pool = shuffle(present.slice());

      // If bigCounterMode is ON, separate big players and normal players.
      // If bigCounterMode is OFF, treat all players as normals (i.e., no special handling).
      let bigPlayers = [];
      let normalPlayers = pool;
      if (bigCounterMode) {
        bigPlayers = pool.filter(p => BIG_NAMES.includes(p.name));
        normalPlayers = pool.filter(p => !BIG_NAMES.includes(p.name));
      } else {
        bigPlayers = [];
        normalPlayers = pool.slice(); // everything is normal
      }

      // We'll construct two teams trying to:
      // 1) balance big counts if bigCounterMode ON (difference ≤ 1)
      // 2) balance total weights (difference ≤ maxDiff)
      // 3) keep team sizes balanced (1 player difference max, or sub if allowSub)

      // Start with empty teams
      let t1 = [];
      let t2 = [];

      // If bigCounterMode, assign bigs first to enforce ≤1 difference
      if (bigCounterMode && bigPlayers.length > 0) {
        const shuffledBigs = shuffle(bigPlayers.slice());
        // Start by placing alternating so it's random but balanced
        for (let i = 0; i < shuffledBigs.length; i++) {
          if (i % 2 === 0) t1.push(shuffledBigs[i]);
          else t2.push(shuffledBigs[i]);
        }
        // After this initial distribution, if counts differ by more than 1, adjust (unlikely)
        while (Math.abs(t1.filter(x => BIG_NAMES.includes(x.name)).length - t2.filter(x => BIG_NAMES.includes(x.name)).length) > 1) {
          if (t1.filter(x => BIG_NAMES.includes(x.name)).length > t2.filter(x => BIG_NAMES.includes(x.name)).length) {
            const moveIdx = t1.findIndex(x => BIG_NAMES.includes(x.name));
            if (moveIdx >= 0) t2.push(...t1.splice(moveIdx, 1));
            else break;
          } else {
            const moveIdx = t2.findIndex(x => BIG_NAMES.includes(x.name));
            if (moveIdx >= 0) t1.push(...t2.splice(moveIdx, 1));
            else break;
          }
        }
      }

      // Now assign normal players trying to balance weights and sizes
      // Compute current team weights
      const teamWeight = (arr) => arr.reduce((acc, p) => acc + (weights.get(p.id) || 1), 0);
      let w1 = teamWeight(t1);
      let w2 = teamWeight(t2);

      // Desired team sizes (before subs)
      const desiredSizeA = Math.ceil(pool.length / 2);
      const desiredSizeB = Math.floor(pool.length / 2);

      // shuffle normalPlayers for randomness, then sort by weight descending to place heavier ones first (helps balancing)
      let normals = shuffle(normalPlayers.slice());
      normals.sort((a, b) => (weights.get(b.id) || 1) - (weights.get(a.id) || 1));

      for (const p of normals) {
        // if one team already filled to desired size, push to other
        if (t1.length >= desiredSizeA && t2.length < desiredSizeB) {
          t2.push(p);
          w2 += (weights.get(p.id) || 1);
          continue;
        }
        if (t2.length >= desiredSizeA && t1.length < desiredSizeB) {
          t1.push(p);
          w1 += (weights.get(p.id) || 1);
          continue;
        }

        // Choose the team which currently has lower weight OR smaller size if weights equal
        if ((w1 + 0) <= (w2 + 0)) {
          t1.push(p);
          w1 += (weights.get(p.id) || 1);
        } else {
          t2.push(p);
          w2 += (weights.get(p.id) || 1);
        }
      }

      // After assignment, check weight difference and try to swap to reduce if > maxDiff
      let diff = Math.abs(w1 - w2);
      // Use the UI-controlled maxDiff state (default 0)
      const maxAllowed = Number.isFinite(maxDiff) ? Math.max(0, Math.floor(maxDiff)) : 0;

      if (diff > maxAllowed) {
        // attempt a limited number of swaps to reduce difference
        // build arrays of candidates sorted by weight
        let attempts = 0;
        while (diff > maxAllowed && attempts < 300) {
          attempts++;
          // attempt to find a pair (a from heavier team, b from lighter team) to swap that improves diff
          let improved = false;
          if (w1 > w2) {
            // heavier team = t1
            // try all pairs (a in t1, b in t2) and pick one that reduces diff
            outer1:
            for (let i = 0; i < t1.length; i++) {
              for (let j = 0; j < t2.length; j++) {
                const a = t1[i], b = t2[j];
                const newW1 = w1 - (weights.get(a.id) || 1) + (weights.get(b.id) || 1);
                const newW2 = w2 - (weights.get(b.id) || 1) + (weights.get(a.id) || 1);
                if (Math.abs(newW1 - newW2) < diff) {
                  // perform swap
                  t1.splice(i, 1, b);
                  t2.splice(j, 1, a);
                  w1 = newW1; w2 = newW2; diff = Math.abs(w1 - w2);
                  improved = true;
                  break outer1;
                }
              }
            }
          } else {
            // heavier team = t2
            outer2:
            for (let i = 0; i < t2.length; i++) {
              for (let j = 0; j < t1.length; j++) {
                const a = t2[i], b = t1[j];
                const newW2 = w2 - (weights.get(a.id) || 1) + (weights.get(b.id) || 1);
                const newW1 = w1 - (weights.get(b.id) || 1) + (weights.get(a.id) || 1);
                if (Math.abs(newW1 - newW2) < diff) {
                  // perform swap
                  t2.splice(i, 1, b);
                  t1.splice(j, 1, a);
                  w1 = newW1; w2 = newW2; diff = Math.abs(w1 - w2);
                  improved = true;
                  break outer2;
                }
              }
            }
          }
          if (!improved) break;
        }
      }

      // Finally, if total players odd and allowSub true, pop one from the larger team to subs
      let s = [];
      const total = t1.length + t2.length;
      if (total % 2 !== 0 && allowSub) {
        if (t1.length > t2.length) s = [t1.pop()];
        else s = [t2.pop()];
      }

      setTeam1(t1);
      setTeam2(t2);
      setTeam3([]);
      setSubs(s);
      setScore1(0);
      setScore2(0);
      setMatchIndex(1);
      return;
    }

    // 3 teams unchanged:
    const shuffled = shuffle(present.slice());
    const t1 = [], t2 = [], t3 = [];
    shuffled.forEach((p, i) => {
      if (i % 3 === 0) t1.push(p);
      else if (i % 3 === 1) t2.push(p);
      else t3.push(p);
    });
    setTeam1(t1); setTeam2(t2); setTeam3(t3); setSubs([]);
    setScore1(0); setScore2(0); setMatchIndex(1);
  }
  // -------------------------
  // end randomizeTeams()
  // -------------------------

  function clearTeams() {
    setTeam1([]); setTeam2([]); setTeam3([]); setSubs([]);
    setScore1(0); setScore2(0); setMatchIndex(1);
  }

  function removePlayerFromTeams(id) {
    setTeam1(prev => prev.filter(p => p.id !== id));
    setTeam2(prev => prev.filter(p => p.id !== id));
    setTeam3(prev => prev.filter(p => p.id !== id));
    setSubs(prev => prev.filter(p => p.id !== id));
  }

  function currentMatchTeams() {
    if (team3.length > 0) {
      if (matchIndex === 1) return [team1, team2];
      if (matchIndex === 2) return [team1, team3];
      if (matchIndex === 3) return [team2, team3];
    }
    return [team1, team2];
  }

  async function declareWinner(teamNumber) {
    if (!confirm(`Declare Team ${teamNumber} the winner?`)) return;
    const [A, B] = currentMatchTeams();
    const winners = teamNumber === 1 ? A : B;
    const losers = teamNumber === 1 ? B : A;
    for (const p of [...winners, ...losers]) {
      const { data } = await supabase.from('players').select('games,wins').eq('id', p.id).single();
      const g = (data?.games || 0) + 1;
      const w = (data?.wins || 0) + (winners.find(x => x.id === p.id) ? 1 : 0);
      await supabase.from('players').update({ games: g, wins: w }).eq('id', p.id);
    }
    setNotification(`✅ Team ${teamNumber} Wins!`);
    setTimeout(() => setNotification(''), 3000);
    setScore1(0); setScore2(0);
    if (team3.length > 0 && matchIndex < 3) setMatchIndex(m => m + 1);
    loadPlayers();
  }

  function startTimer() {
    if (intervalId) return;
    setRunning(true);
    const id = setInterval(() => setTimer(prev => (prev > 0 ? prev - 1 : 0)), 1000);
    setIntervalId(id);
  }
  function pauseTimer() { if (intervalId) clearInterval(intervalId); setIntervalId(null); setRunning(false); }
  function resetTimer() { pauseTimer(); setTimer(Math.max(0, (customMinutes || 0) * 60)); }

  const [currentTeamA, currentTeamB] = currentMatchTeams();

  return (
    <main style={{
      maxWidth: 1200, margin: '0 auto', padding: 0, fontFamily: 'sans-serif',
      backgroundColor: 'var(--bg)', color: 'var(--text)'
    }}>
      <style>{`
        :root { --bg: white; --text: black; --border: #ccc; --card: #f5f5f5; }
        @media (prefers-color-scheme: dark) {
          :root { --bg: #121212; --text: #f5f5f5; --border: #444; --card: #1e1e1e; }
        }
      `}</style>

      {notification && <div style={{
        background: '#4caf50', color: 'white', padding: 10, borderRadius: 6,
        marginBottom: 10, textAlign: 'center', fontWeight: 'bold'
      }}>{notification}</div>}

      {/* Players Section */}
      <section style={{ marginBottom: 20 }}>
        <h2>Players</h2>
        <form onSubmit={addPlayer} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="New player" style={{ flex: 1, padding: 8 }} />
          <button type="submit">Add</button>
        </form>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          {players.map(p => (
            <div
              key={p.id}
              onClick={() => togglePresence(p.id, p.is_present)}
              style={{
                background: p.is_present ? '#0077ffff' : 'var(--card)',
                color: p.is_present ? 'black' : 'white',
                padding: '8px 12px', borderRadius: 6,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer'
              }}
            >
              <span>{p.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); removePlayer(p.id); }}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#d11a2a' }}
              >
                ❌
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Leaderboard Section */}
      <section style={{ marginBottom: 20 }}>
        <h2>Leaderboard</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#ff9900ff' }}>
            <tr>
              {[
                { key: 'name', label: 'PLAYER' },
                { key: 'wins', label: 'WINS' },
                { key: 'losses', label: 'LOSSES' },
                { key: 'games', label: 'GAMES' },
                { key: 'winrate', label: 'WINRATE' }
              ].map(col => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  style={{ cursor: 'pointer', padding: 6, textAlign: col.key === 'name' ? 'left' : 'center' }}
                >
                  {col.label} {sortColumn === col.key ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                </th>
              ))}
              <th>RESET</th>
            </tr>
          </thead>
          <tbody>
            {players.map(p => {
              const g = p.games || 0, w = p.wins || 0, l = g - w;
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td
                    onClick={() => setEditing({ id: p.id, field: 'wins', value: String(w) })}
                    style={{ textAlign: 'center', cursor: 'pointer' }}
                  >
                    {editing.id === p.id && editing.field === 'wins' ? (
                      <input autoFocus value={editing.value}
                        onChange={e => setEditing({ ...editing, value: e.target.value })}
                        onBlur={saveEdit}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing({ id: null, field: null, value: '' }); }}
                        style={{ width: 50, textAlign: 'center' }} />
                    ) : w}
                  </td>
                  <td style={{ textAlign: 'center' }}>{l}</td>
                  <td
                    onClick={() => setEditing({ id: p.id, field: 'games', value: String(g) })}
                    style={{ textAlign: 'center', cursor: 'pointer' }}
                  >
                    {editing.id === p.id && editing.field === 'games' ? (
                      <input autoFocus value={editing.value}
                        onChange={e => setEditing({ ...editing, value: e.target.value })}
                        onBlur={saveEdit}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing({ id: null, field: null, value: '' }); }}
                        style={{ width: 50, textAlign: 'center' }} />
                    ) : g}
                  </td>
                  <td style={{ textAlign: 'center' }}>{percent(w, g)}%</td>
                  <td style={{ textAlign: 'center' }}>
                    <button onClick={() => resetStats(p.id)}>↻</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Team Randomizer Section */}
      <section style={{ marginBottom: 30 }}>
        <h2>Team Randomizer</h2>
        <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
          <button onClick={() => setTeamCount(2)} style={{ flex: 1, minHeight: 50, background: teamCount === 2 ? '#2196f3' : '#ddd', color: teamCount === 2 ? 'white' : 'black' }}>2 Teams</button>
          <button onClick={() => setTeamCount(3)} style={{ flex: 1, minHeight: 50, background: teamCount === 3 ? '#2196f3' : '#ddd', color: teamCount === 3 ? 'white' : 'black' }}>3 Teams</button>

          {/* Randomize & Clear stay right after team selection per your requested order */}
          <button onClick={randomizeTeams} style={{ minWidth: 120, minHeight: 50 }}>Randomize</button>
          <button onClick={clearTeams} style={{ minWidth: 120, minHeight: 50, background: '#f28b82', color: 'white' }}>Clear Teams</button>

          {/* Weighstone (weighted) toggle button (added) */}
          <button
            onClick={() => setWeightedMode(v => !v)}
            style={{
              minWidth: 140,
              minHeight: 50,
              borderRadius: 8,
              padding: '0 12px',
              background: weightedMode ? '#4caf50' : '#9e9e9e',
              color: 'white',
              fontWeight: 'bold'
            }}
            title="Use winrate-based weights when randomizing (Weighstone)"
          >
            Weighstone: {weightedMode ? 'ON' : 'OFF'}
          </button>

          {/* NEW: small numeric input next to Weighstone to control max diff (default 0) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number"
              min="0"
              max="20"
              value={maxDiff}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setMaxDiff(Number.isNaN(v) ? 0 : v);
              }}
              style={{
                width: 64,
                height: 40,
                textAlign: 'center',
                borderRadius: 6,
                border: '1px solid #bbb',
                fontWeight: 'bold',
                appearance: 'textfield',
                MozAppearance: 'textfield'
              }}
              title="Max weighstone difference (only when Weighstone is ON). Default 0."
            />
          </div>

          {/* Big counter toggle button (added) */}
          <button
            onClick={() => setBigCounterMode(v => !v)}
            style={{
              minWidth: 140,
              minHeight: 50,
              borderRadius: 8,
              padding: '0 12px',
              background: bigCounterMode ? '#4caf50' : '#9e9e9e',
              color: 'white',
              fontWeight: 'bold'
            }}
            title="Balance big players (Lan/Alex/Sitar/Lukas) between teams"
          >
            Big Counter: {bigCounterMode ? 'ON' : 'OFF'}
          </button>

          {/* Sub toggle (kept where it was) */}
          <button
            onClick={() => setAllowSub(v => !v)}
            style={{
              minWidth: 140,
              minHeight: 50,
              borderRadius: 8,
              padding: '0 12px',
              background: allowSub ? '#4caf50' : '#9e9e9e',
              color: 'white',
              fontWeight: 'bold'
            }}
            title="When odd number of players"
          >
            Sub when odd: {allowSub ? 'ON' : 'OFF'}
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
          {[{ label: 'Team 1', list: team1 }, { label: 'Team 2', list: team2 }, { label: 'Team 3', list: team3, hide: teamCount !== 3 }, { label: 'Subs', list: subs, sub: true }]
            .map((t, i) => !t.hide && t.list.length > 0 && (
              <div key={i} style={{ flex: 1, minWidth: 220, background: t.sub ? '#fff3cd' : '#add8e6', color: 'black', padding: 10, borderRadius: 8 }}>
                <h3>{t.label}</h3>
                {t.list.map(p => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>
                      <button
                        onClick={() => {
                          if (teamCount !== 2) return; // only in 2-team mode
                          if (team1.find(x => x.id === p.id)) {
                            setTeam1(prev => prev.filter(x => x.id !== p.id));
                            setTeam2(prev => [...prev, p]);
                          } else if (team2.find(x => x.id === p.id)) {
                            setTeam2(prev => prev.filter(x => x.id !== p.id));
                            setTeam1(prev => [...prev, p]);
                          }
                        }}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', marginRight: 6 }}
                        title="Swap to other team"
                      >🔄</button>
                      {p.name}
                    </span>
                    <button onClick={() => removePlayerFromTeams(p.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>❌</button>
                  </div>
                ))}

              </div>
            ))}
        </div>
      </section>

      {/* Scrollable Scoreboard */}
      <div style={{
        marginTop: 0, background: 'var(--card)', borderTop: '0px solid var(--border)',
        padding: 0, borderRadius: 0
      }}>
        <h3 style={{ textAlign: 'center', margin: 0 }}>Scoreboard {team3.length > 0 && `(Match ${matchIndex}/3)`}</h3>

        <div style={{ textAlign: 'center', marginTop: 6 }}>
          <div style={{ fontSize: 38, fontWeight: 'bold' }}>{Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 6 }}>
            <button onClick={startTimer} disabled={running}>Start</button>
            <button onClick={pauseTimer} disabled={!running}>Pause</button>
            <button onClick={resetTimer}>Reset</button>
            <label style={{ marginLeft: 8 }}>
              <input type="number" value={customMinutes} onChange={e => setCustomMinutes(parseInt(e.target.value || '0', 10))} onBlur={resetTimer} style={{ width: 60 }} /> min
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {[{ team: currentTeamA, score: score1, setScore: setScore1, label: 'Team 1' }, { team: currentTeamB, score: score2, setScore: setScore2, label: 'Team 2' }].map((t, idx) => (
            <div key={idx} style={{ flex: 1, background: '#000000ff', padding: 10, borderRadius: 6 }}>
              <h4 style={{ textAlign: 'center' , fontSize: 20 }}>
                {t.team.length > 0 ? t.team.map(p => p.name).join(', ') : t.label} — {t.score}
              </h4>

              {/* Left = big score, Right = +1/-1 stacked */}
              <div style={{ display: 'flex' }}>
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '100px 0',
                    fontSize: 64,
                    fontWeight: 'bold',
                    color: 'white'
                  }}
                >
                  {t.score}
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <button
                    onClick={() => t.setScore(t.score + 1)}
                    style={{ flex: 1, padding: '50px 0', background: '#4caf50', color: 'white', fontSize: 22 }}
                  >
                    +1
                  </button>
                  <button
                    onClick={() => t.setScore(Math.max(0, t.score - 1))}
                    style={{ flex: 1, padding: '50px 0', background: '#f44336', color: 'white', fontSize: 22 }}
                  >
                    -1
                  </button>
                </div>
              </div>

              <button style={{ marginTop: 6, width: '100%' }} onClick={() => declareWinner(idx + 1)}>Declare Winner</button>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
