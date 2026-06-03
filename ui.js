// ═══════════════════════════════════════════════════════════
//  UI CONTROLLER  — BrawlForge
// ═══════════════════════════════════════════════════════════

const UI = (() => {

  let currentScreen     = 'lobby';
  let selectedCharacter = null;
  let selectedMap       = null;
  let playerName        = 'Fighter';
  let trainingChar      = null;
  let trainingMap       = null;
  let botSlots          = [];   // array of { slot, characterId:'sandbag' } added by host

  const matchSettings = { stocks: 3, useTimer: true, timeLimit: 180 };

  // ─── INIT ───
  function init() {
    playerName = StatsSystem.getPlayerName() === 'Unknown'
      ? 'Fighter_' + Math.random().toString(36).slice(2,5).toUpperCase()
      : StatsSystem.getPlayerName();
    StatsSystem.setPlayerName(playerName);
    document.getElementById('player-name-input').value = playerName;

    _buildCharacterGrid();
    _buildMapGrid();
    _buildStatsPanel();
    _bindLobbyEvents();
    _bindRoomEvents();

    Network.on('roomCreated',  ({ roomInfo, roomId }) => _onRoomEntered(roomInfo, roomId, true));
    Network.on('roomJoined',   ({ roomInfo })         => _onRoomEntered(roomInfo, null, false));
    Network.on('roomUpdated',  ({ roomInfo })         => { _refreshRoomUI(roomInfo); _refreshSettingsDisplay(roomInfo); });
    Network.on('playerJoined', ({ player })           => toast(`${player.name} joined!`, 'success'));
    Network.on('playerLeft',   ({ player })           => toast(`${player.name} left.`, 'info'));
    Network.on('matchStart',   (config)               => Engine.startMatch(config));
    Network.on('lobbyUpdate',  ({ rooms })            => _refreshRoomList(rooms));
    Network.on('status',       ({ status, id })       => _updateStatusBar(status, id));
    Network.on('error',        ({ message })          => toast('Network error: ' + message, 'error'));
    Network.on('chat',         (msg)                  => _appendChat(msg));

    window.addEventListener('achievement', e => {
      toast(`🏆 Achievement: ${e.detail.name} — ${e.detail.desc}`, 'success');
    });

    SettingsUI.init();
    _connectPeer();
    showScreen('lobby');
  }

  async function _connectPeer() {
    _updateStatusBar('connecting');
    try {
      const id = await Network.init(playerName);
      _updateStatusBar('connected', id);
      Network.startLobbyListen();
      Network.requestLobbyRooms();
      setInterval(() => Network.requestLobbyRooms(), 4000);
    } catch (e) {
      _updateStatusBar('error');
      toast('Could not connect to network: ' + e.message, 'error');
    }
  }

  // ─── SCREENS ───
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + name);
    if (el) el.classList.add('active');
    currentScreen = name;
  }

  // ─── CHARACTER GRID  (never shows Sandbag — it's a bot, not a player character) ───
  function _buildCharacterGrid(containerId = 'char-grid-room') {
    const grid = document.getElementById(containerId);
    if (!grid) return;
    grid.innerHTML = '';
    for (const [id, def] of Object.entries(CHARACTER_REGISTRY)) {
      if (def.isSandbag) continue;   // ← excluded from player select
      const card = document.createElement('div');
      card.className = 'char-card' + (selectedCharacter === id ? ' selected' : '');
      card.dataset.charId = id;
      card.innerHTML = `
        <div class="char-avatar">${def.emoji}</div>
        <div class="char-name">${def.displayName}</div>
        <div class="char-type">${def.archetype}</div>
      `;
      card.addEventListener('click', () => _selectCharacter(id));
      grid.appendChild(card);
    }
  }

  function _selectCharacter(id) {
    selectedCharacter = id;
    document.querySelectorAll('.char-card').forEach(c => {
      c.classList.toggle('selected', c.dataset.charId === id);
    });
    Network.sendPlayerUpdate({ characterId: id });
  }

  // ─── MAP GRID ───
  function _buildMapGrid(containerId = 'map-grid-room') {
    const grid = document.getElementById(containerId);
    if (!grid) return;
    grid.innerHTML = '';
    for (const [id, def] of Object.entries(MAP_REGISTRY)) {
      const card = document.createElement('div');
      card.className = 'map-card' + (selectedMap === id ? ' selected' : '');
      card.dataset.mapId = id;
      card.innerHTML = `
        <div class="map-preview">${def.emoji}</div>
        <div class="map-name">${def.displayName}</div>
      `;
      card.addEventListener('click', () => _selectMap(id));
      grid.appendChild(card);
    }
  }

  function _selectMap(id) {
    selectedMap = id;
    document.querySelectorAll('.map-card').forEach(c => {
      c.classList.toggle('selected', c.dataset.mapId === id);
    });
    if (Network.getIsHost()) Network.sendMapSelect(id);
  }

  // ─── HIGHLIGHT HELPER ───
  function _highlightGridItem(gridId, cardSel, val, dataKey) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.querySelectorAll(cardSel).forEach(c => {
      c.classList.toggle('selected', c.dataset[dataKey] === val);
    });
  }

  // ─── BOT SLOTS (host only) ───
  function _refreshBotSlots(roomInfo) {
    const container = document.getElementById('bot-slots');
    if (!container) return;
    container.innerHTML = '';

    const humanCount = roomInfo?.players?.length ?? 1;
    const maxBots    = 4 - humanCount;

    // Render current bots
    botSlots.forEach((bot, idx) => {
      const row = document.createElement('div');
      row.className = 'bot-row';
      row.innerHTML = `
        <span class="bot-label">🥊 Sandbag Bot ${idx + 1}</span>
        <button class="btn btn-sm btn-secondary bot-remove" data-idx="${idx}">✕ Remove</button>
      `;
      container.appendChild(row);
    });

    // Add bot button (only if room has space)
    if (botSlots.length < maxBots) {
      const addBtn = document.createElement('button');
      addBtn.className = 'btn btn-sm btn-secondary';
      addBtn.style.marginTop = '6px';
      addBtn.textContent = '+ Add Sandbag Bot';
      addBtn.addEventListener('click', () => {
        botSlots.push({ characterId: 'sandbag' });
        _refreshBotSlots(Network.getRoomInfo());
      });
      container.appendChild(addBtn);
    }

    // Remove handlers
    container.querySelectorAll('.bot-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        botSlots.splice(parseInt(btn.dataset.idx), 1);
        _refreshBotSlots(Network.getRoomInfo());
      });
    });

    // Enable/disable start based on humans + bots
    _updateStartButton(roomInfo);
  }

  function _updateStartButton(roomInfo) {
    const startBtn = document.getElementById('btn-start-match');
    if (!startBtn || !Network.getIsHost()) return;

    const humanPlayers = roomInfo?.players ?? [];
    const totalPlayers = humanPlayers.length + botSlots.length;

    // All non-host humans must be ready; bots are always "ready"
    const notReady = humanPlayers.filter(p => !p.ready && p.peerId !== Network.getMyId());
    const hasMap   = !!roomInfo?.selectedMap;
    const hasChars = humanPlayers.every(p => !!p.characterId);

    startBtn.disabled = notReady.length > 0 || !hasMap || !hasChars || totalPlayers < 2;

    // Update hint text
    const hint = document.getElementById('start-hint');
    if (hint) {
      if (!hasMap)           hint.textContent = 'Select a stage to begin.';
      else if (!hasChars)    hint.textContent = 'All players must pick a character.';
      else if (notReady.length > 0) hint.textContent = `Waiting for ${notReady.map(p=>p.name).join(', ')} to ready up.`;
      else if (totalPlayers < 2)    hint.textContent = 'Need at least 2 fighters (add a bot or wait for players).';
      else                          hint.textContent = 'Ready to fight!';
    }
  }

  // ─── TRAINING MODE ───
  function _startTrainingMode(charId, mapId) {
    const myId = Network.getMyId() || 'local-player';
    Engine.startMatch({
      mapId,
      training: true,
      players: [
        { peerId: myId,            name: playerName, characterId: charId,    slot: 0 },
        { peerId: 'sandbag-dummy', name: 'Sandbag',  characterId: 'sandbag', slot: 1 },
      ],
      stocks: 99, timeLimit: 9999, useTimer: false,
    });
  }

  // ─── LOBBY EVENTS ───
  function _bindLobbyEvents() {
    document.getElementById('player-name-input')?.addEventListener('change', e => {
      playerName = e.target.value.trim() || playerName;
      StatsSystem.setPlayerName(playerName);
    });

    document.getElementById('btn-create-room')?.addEventListener('click', async () => {
      const name = document.getElementById('room-name-input')?.value.trim() || `${playerName}'s Room`;
      const pass = document.getElementById('room-pass-input')?.value || '';
      try { await Network.createRoom(name, pass); }
      catch (e) { toast(e.message, 'error'); }
    });

    document.getElementById('btn-join-direct')?.addEventListener('click', () => {
      const id = document.getElementById('join-id-input')?.value.trim();
      if (!id) { toast('Enter a room ID', 'error'); return; }
      _promptJoin(id);
    });

    document.getElementById('btn-refresh-rooms')?.addEventListener('click', () => {
      Network.requestLobbyRooms();
      toast('Refreshing rooms…', 'info');
    });

    document.getElementById('btn-view-stats')?.addEventListener('click',   () => _buildStatsPanel());
    document.getElementById('btn-export-stats')?.addEventListener('click', () => StatsSystem.exportJSON());

    // Training Mode
    document.getElementById('btn-training')?.addEventListener('click', () => {
      _buildCharacterGrid('char-grid-training');
      _buildMapGrid('map-grid-training');
      if (!trainingChar) trainingChar = Object.keys(CHARACTER_REGISTRY).find(k => !CHARACTER_REGISTRY[k].isSandbag);
      if (!trainingMap)  trainingMap  = Object.keys(MAP_REGISTRY)[0];
      _highlightGridItem('char-grid-training', '.char-card', trainingChar, 'charId');
      _highlightGridItem('map-grid-training',  '.map-card',  trainingMap,  'mapId');
      document.getElementById('training-modal').style.display = 'flex';
    });

    document.getElementById('training-cancel-btn')?.addEventListener('click', () => {
      document.getElementById('training-modal').style.display = 'none';
    });

    document.getElementById('training-start-btn')?.addEventListener('click', () => {
      if (!trainingChar) { toast('Pick a character!', 'error'); return; }
      if (!trainingMap)  { toast('Pick a stage!',     'error'); return; }
      document.getElementById('training-modal').style.display = 'none';
      _startTrainingMode(trainingChar, trainingMap);
    });

    document.getElementById('char-grid-training')?.addEventListener('click', e => {
      const card = e.target.closest('.char-card');
      if (card) {
        trainingChar = card.dataset.charId;
        _highlightGridItem('char-grid-training', '.char-card', trainingChar, 'charId');
      }
    });

    document.getElementById('map-grid-training')?.addEventListener('click', e => {
      const card = e.target.closest('.map-card');
      if (card) {
        trainingMap = card.dataset.mapId;
        _highlightGridItem('map-grid-training', '.map-card', trainingMap, 'mapId');
      }
    });
  }

  function _promptJoin(roomId, hasPassword) {
    if (hasPassword) {
      const modal = document.getElementById('password-modal');
      modal.style.display = 'flex';
      document.getElementById('modal-join-btn').onclick = async () => {
        const pass = document.getElementById('modal-pass-input').value;
        modal.style.display = 'none';
        try { await Network.joinRoom(roomId, pass); }
        catch (e) { toast(e.message, 'error'); }
      };
      document.getElementById('modal-cancel-btn').onclick = () => { modal.style.display = 'none'; };
    } else {
      Network.joinRoom(roomId, '').catch(e => toast(e.message, 'error'));
    }
  }

  function _refreshRoomList(rooms) {
    const list = document.getElementById('room-list');
    if (!list) return;
    if (!rooms.length) {
      list.innerHTML = '<div class="empty-state">No rooms found.<br>Create one or refresh!</div>';
      return;
    }
    list.innerHTML = '';
    for (const room of rooms) {
      const full = room.players >= room.maxPlayers;
      const item = document.createElement('div');
      item.className = 'room-item';
      item.innerHTML = `
        <div class="room-info">
          <div class="room-name">${room.hasPassword ? '<span class="room-lock">🔒</span>' : ''}${_esc(room.name)}</div>
          <div class="room-meta">Host: ${_esc(room.hostName)}</div>
        </div>
        <span class="players-badge${full ? ' full' : ''}">${room.players}/${room.maxPlayers}</span>
        <button class="btn btn-sm btn-secondary" ${full ? 'disabled' : ''}>Join</button>
      `;
      if (!full) item.querySelector('button').addEventListener('click', () => _promptJoin(room.roomId, room.hasPassword));
      list.appendChild(item);
    }
  }

  // ─── SETTINGS DISPLAY ───
  function _refreshSettingsDisplay(roomInfo) {
    const s = roomInfo?.settings;
    if (!s) return;
    const guestEl = document.getElementById('guest-settings-display');
    if (guestEl) {
      const timeStr = s.useTimer !== false ? (s.timeLimit >= 9999 ? '∞' : s.timeLimit + 's') : 'Off';
      guestEl.innerHTML = `Stocks: <b>${s.stocks ?? 3}</b> &nbsp;|&nbsp; Timer: <b>${timeStr}</b>`;
    }
    Object.assign(matchSettings, s);
  }

  // ─── ROOM ENTER ───
  function _onRoomEntered(roomInfo, roomId, isHost) {
    botSlots = [];  // reset bots when entering a room
    showScreen('room');
    _refreshRoomUI(roomInfo);

    if (!selectedCharacter) _selectCharacter(Object.keys(CHARACTER_REGISTRY).find(k => !CHARACTER_REGISTRY[k].isSandbag));
    if (!selectedMap && isHost) _selectMap(Object.keys(MAP_REGISTRY)[0]);

    _buildCharacterGrid('char-grid-room');
    _buildMapGrid('map-grid-room');

    const idEl = document.getElementById('room-id-display');
    if (idEl && roomId) {
      idEl.textContent = `Room ID: ${roomId}`;
      idEl.style.cursor = 'pointer';
      idEl.title = 'Click to copy';
      idEl.onclick = () => { navigator.clipboard.writeText(roomId); toast('Room ID copied!', 'success'); };
    }

    document.getElementById('room-title-display').textContent = roomInfo.name;
    document.getElementById('host-controls').style.display          = isHost ? '' : 'none';
    document.getElementById('match-settings').style.display         = isHost ? '' : 'none';
    document.getElementById('bot-slots-section').style.display      = isHost ? '' : 'none';
    document.getElementById('guest-settings-display').style.display = isHost ? 'none' : '';

    if (isHost) _refreshBotSlots(roomInfo);
  }

  // ─── ROOM EVENTS ───
  function _bindRoomEvents() {
    // Match settings
    document.getElementById('setting-stocks')?.addEventListener('click', e => {
      const btn = e.target.closest('.sbtn');
      if (!btn || !Network.getIsHost()) return;
      document.querySelectorAll('#setting-stocks .sbtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      matchSettings.stocks = parseInt(btn.dataset.val);
      Network.sendRoomSettings({ stocks: matchSettings.stocks });
    });

    document.getElementById('setting-timer')?.addEventListener('click', e => {
      const btn = e.target.closest('.sbtn');
      if (!btn || !Network.getIsHost()) return;
      document.querySelectorAll('#setting-timer .sbtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      matchSettings.useTimer = btn.dataset.val === '1';
      const tlRow = document.getElementById('timelimit-row');
      if (tlRow) tlRow.style.display = matchSettings.useTimer ? '' : 'none';
      Network.sendRoomSettings({ useTimer: matchSettings.useTimer });
    });

    document.getElementById('setting-timelimit')?.addEventListener('click', e => {
      const btn = e.target.closest('.sbtn');
      if (!btn || !Network.getIsHost()) return;
      document.querySelectorAll('#setting-timelimit .sbtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      matchSettings.timeLimit = parseInt(btn.dataset.val);
      Network.sendRoomSettings({ timeLimit: matchSettings.timeLimit });
    });

    // Ready toggle
    document.getElementById('btn-ready')?.addEventListener('click', () => {
      const roomInfo = Network.getRoomInfo();
      const me = roomInfo?.players.find(p => p.peerId === Network.getMyId());
      const newReady = !me?.ready;
      Network.sendPlayerReady(newReady);
      document.getElementById('btn-ready').textContent = newReady ? '⏸ Not Ready' : '✅ Ready';
    });

    // Start match
    document.getElementById('btn-start-match')?.addEventListener('click', () => {
      const roomInfo = Network.getRoomInfo();
      if (!roomInfo) return;

      // Validate humans
      for (const p of roomInfo.players) {
        if (!p.characterId) { toast(`${p.name} hasn't picked a character!`, 'error'); return; }
      }
      if (!roomInfo.selectedMap) { toast('Please select a map!', 'error'); return; }

      // Build full player list: humans first, then bots
      const humanPlayers = roomInfo.players.map((p, i) => ({
        peerId: p.peerId, name: p.name, characterId: p.characterId, slot: i,
      }));
      const botPlayers = botSlots.map((bot, i) => ({
        peerId: `bot-${i}`,
        name:   `Sandbag ${i + 1}`,
        characterId: 'sandbag',
        slot: humanPlayers.length + i,
        isBot: true,
      }));
      const allPlayers = [...humanPlayers, ...botPlayers];

      if (allPlayers.length < 2) { toast('Need at least 2 fighters. Add a bot or wait for players.', 'error'); return; }

      const s = roomInfo.settings || matchSettings;
      Network.sendStartMatch({
        mapId: roomInfo.selectedMap,
        players: allPlayers,
        stocks:    s.stocks    ?? 3,
        timeLimit: s.useTimer  ? (s.timeLimit ?? 180) : 9999,
        useTimer:  s.useTimer  ?? true,
        hasBots:   botPlayers.length > 0,
      });
    });

    // Leave
    document.getElementById('btn-leave-room')?.addEventListener('click', () => {
      Network.leaveRoom();
      showScreen('lobby');
    });

    // Chat
    document.getElementById('chat-send-btn')?.addEventListener('click', _sendChat);
    document.getElementById('chat-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') _sendChat(); });
  }

  function _refreshRoomUI(roomInfo) {
    if (!roomInfo) return;

    for (let i = 0; i < 4; i++) {
      const slotEl = document.getElementById(`player-slot-${i}`);
      if (!slotEl) continue;
      const player = roomInfo.players[i];
      const isMe   = player?.peerId === Network.getMyId();
      if (player) {
        slotEl.className = 'player-slot filled' + (isMe ? ' me' : '') + (player.ready ? ' ready' : '');
        const charDef = player.characterId ? CHARACTER_REGISTRY[player.characterId] : null;
        slotEl.innerHTML = `
          <div class="slot-num">P${i+1}</div>
          <div class="slot-player-name">${_esc(player.name)} ${isMe ? '(you)' : ''}</div>
          <div class="slot-char-name">${charDef ? charDef.emoji + ' ' + charDef.displayName : '—'}</div>
          ${player.ready ? '<span class="slot-ready-badge">READY</span>' : ''}
          ${roomInfo.hostId === player.peerId ? '<span class="tag tag-host" style="margin-top:4px">HOST</span>' : ''}
        `;
      } else {
        slotEl.className = 'player-slot';
        slotEl.innerHTML = `<div class="slot-num">P${i+1}</div><div class="slot-empty-txt">Waiting…</div>`;
      }
    }

    if (roomInfo.selectedMap) {
      document.querySelectorAll('.map-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.mapId === roomInfo.selectedMap);
      });
      selectedMap = roomInfo.selectedMap;
    }

    if (Network.getIsHost()) {
      _refreshBotSlots(roomInfo);
    } else {
      _updateStartButton(roomInfo);
    }

    _refreshSettingsDisplay(roomInfo);
  }

  // ─── CHAT ───
  function _sendChat() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    Network.sendChat(text);
    input.value = '';
  }

  function _appendChat({ from, name, text }) {
    const log = document.getElementById('chat-log');
    if (!log) return;
    const isMe = from === Network.getMyId();
    const div  = document.createElement('div');
    div.style.cssText = `font-size:12px;padding:3px 0;color:${isMe ? '#aaddff' : '#cccccc'};font-family:var(--font-mono)`;
    div.innerHTML = `<span style="color:${isMe ? '#4488ff' : '#888'}">${_esc(name || 'Player')}:</span> ${_esc(text)}`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  // ─── STATUS BAR ───
  function _updateStatusBar(status, id) {
    const dot  = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    if (!dot || !text) return;
    dot.className = 'status-dot ' + status;
    if      (status === 'connected')    text.textContent = `Connected — ID: ${id}`;
    else if (status === 'connecting')   text.textContent = 'Connecting…';
    else if (status === 'disconnected') text.textContent = 'Disconnected';
    else                                text.textContent = 'Connection error';
  }

  // ─── STATS PANEL ───
  function _buildStatsPanel() {
    const el = document.getElementById('stats-panel');
    if (!el) return;
    const s = StatsSystem.getSummary();
    el.innerHTML = `
      <div class="stat-row"><span class="stat-label">GAMES PLAYED</span><span class="stat-val">${s.totalGames}</span></div>
      <div class="stat-row"><span class="stat-label">WIN RATE</span><span class="stat-val">${s.winRate}%</span></div>
      <div class="stat-row"><span class="stat-label">W / L / D</span><span class="stat-val">${s.wins} / ${s.losses} / ${s.draws}</span></div>
      <div class="stat-row"><span class="stat-label">K/D RATIO</span><span class="stat-val">${s.kdRatio}</span></div>
      <div class="stat-row"><span class="stat-label">TOTAL KILLS</span><span class="stat-val">${s.totalKills}</span></div>
      <div class="stat-row"><span class="stat-label">BEST STREAK</span><span class="stat-val">${s.longestWinStreak}</span></div>
      <div class="stat-row"><span class="stat-label">DAMAGE DEALT</span><span class="stat-val">${Math.round(s.totalDamageDealt).toLocaleString()}</span></div>
      <div class="stat-row"><span class="stat-label">ACHIEVEMENTS</span><span class="stat-val">${s.achievements.length}/${s.achievementDefs.length}</span></div>
      ${s.favoriteCharacter ? `<div class="stat-row"><span class="stat-label">MAIN</span><span class="stat-val">${CHARACTER_REGISTRY[s.favoriteCharacter]?.emoji ?? ''} ${CHARACTER_REGISTRY[s.favoriteCharacter]?.displayName ?? s.favoriteCharacter}</span></div>` : ''}
    `;
  }

  // ─── MATCH RESULT ───
  function showMatchResult({ winner, result, localPlayer, players }) {
    const overlay = document.getElementById('result-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    const title = document.getElementById('result-title');
    const sub   = document.getElementById('result-sub');
    if (title) {
      if      (result === 'win')  { title.textContent = 'VICTORY!'; title.style.background = 'linear-gradient(135deg,#22c55e,#86efac)'; }
      else if (result === 'loss') { title.textContent = 'DEFEAT';   title.style.background = 'linear-gradient(135deg,#ef4444,#fca5a5)'; }
      else                        { title.textContent = 'DRAW';     title.style.background = 'linear-gradient(135deg,#ffb800,#fde68a)'; }
      title.style.webkitBackgroundClip = 'text';
      title.style.webkitTextFillColor  = 'transparent';
    }
    if (sub) sub.textContent = winner ? winner.playerName + ' wins!' : "It's a draw!";
  }

  // ─── TOAST ───
  function toast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function _esc(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { init, showScreen, toast, showMatchResult };
})();

window.UI = UI;
window.toast = UI.toast;
