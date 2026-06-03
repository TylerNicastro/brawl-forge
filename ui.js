// ═══════════════════════════════════════════════════════════
//  UI CONTROLLER  — BrawlForge
//  Manages all screens: lobby, room, game, results
// ═══════════════════════════════════════════════════════════

const UI = (() => {

  let currentScreen = 'lobby';
  let selectedCharacter = null;
  let selectedMap = null;
  let playerName = 'Fighter';

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

    // Network events
    Network.on('roomCreated', ({ roomInfo, roomId }) => _onRoomEntered(roomInfo, roomId, true));
    Network.on('roomJoined',  ({ roomInfo }) => _onRoomEntered(roomInfo, null, false));
    Network.on('roomUpdated', ({ roomInfo }) => _refreshRoomUI(roomInfo));
    Network.on('playerJoined', ({ player }) => toast(`${player.name} joined!`, 'success'));
    Network.on('playerLeft',  ({ player }) => toast(`${player.name} left.`, 'info'));
    Network.on('matchStart',  (config) => Engine.startMatch(config));
    Network.on('lobbyUpdate', ({ rooms }) => _refreshRoomList(rooms));
    Network.on('status', ({ status, id }) => _updateStatusBar(status, id));
    Network.on('error', ({ message }) => toast('Network error: ' + message, 'error'));
    Network.on('chat', (msg) => _appendChat(msg));

    // Achievement toasts
    window.addEventListener('achievement', e => {
      toast(`🏆 Achievement: ${e.detail.name} — ${e.detail.desc}`, 'success');
    });

    // Init settings / keybinding UI
    SettingsUI.init();

    // Connect to PeerJS
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
      // Refresh room list every 4s
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

  // ─── CHARACTER GRID ───
  function _buildCharacterGrid(containerId = 'char-grid-room') {
    const grid = document.getElementById(containerId);
    if (!grid) return;
    grid.innerHTML = '';

    for (const [id, def] of Object.entries(CHARACTER_REGISTRY)) {
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
    _refreshReadyState();
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
    if (Network.getIsHost()) {
      Network.sendMapSelect(id);
    }
  }

  // ─── LOBBY EVENTS ───
  function _bindLobbyEvents() {
    // Name
    document.getElementById('player-name-input')?.addEventListener('change', e => {
      playerName = e.target.value.trim() || playerName;
      StatsSystem.setPlayerName(playerName);
    });

    // Create room
    document.getElementById('btn-create-room')?.addEventListener('click', async () => {
      const name = document.getElementById('room-name-input')?.value.trim() || `${playerName}'s Room`;
      const pass = document.getElementById('room-pass-input')?.value || '';
      try {
        await Network.createRoom(name, pass);
      } catch (e) { toast(e.message, 'error'); }
    });

    // Direct join by ID
    document.getElementById('btn-join-direct')?.addEventListener('click', async () => {
      const id = document.getElementById('join-id-input')?.value.trim();
      if (!id) { toast('Enter a room ID', 'error'); return; }
      _promptJoin(id);
    });

    // Refresh
    document.getElementById('btn-refresh-rooms')?.addEventListener('click', () => {
      Network.requestLobbyRooms();
      toast('Refreshing rooms…', 'info');
    });

    // Stats tab
    document.getElementById('btn-view-stats')?.addEventListener('click', () => _buildStatsPanel());
    document.getElementById('btn-export-stats')?.addEventListener('click', () => StatsSystem.exportJSON());
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
    if (rooms.length === 0) {
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
      if (!full) {
        item.querySelector('button').addEventListener('click', () => _promptJoin(room.roomId, room.hasPassword));
      }
      list.appendChild(item);
    }
  }

  // ─── ROOM ───
  function _onRoomEntered(roomInfo, roomId, isHost) {
    showScreen('room');
    _refreshRoomUI(roomInfo);

    // Select defaults
    if (!selectedCharacter) _selectCharacter(Object.keys(CHARACTER_REGISTRY)[0]);
    if (!selectedMap && isHost) _selectMap(Object.keys(MAP_REGISTRY)[0]);

    // Build room-specific grids
    _buildCharacterGrid('char-grid-room');
    _buildMapGrid('map-grid-room');

    const idEl = document.getElementById('room-id-display');
    if (idEl && roomId) {
      idEl.textContent = `Room ID: ${roomId}`;
      idEl.style.cursor = 'pointer';
      idEl.title = 'Click to copy';
      idEl.onclick = () => {
        navigator.clipboard.writeText(roomId);
        toast('Room ID copied!', 'success');
      };
    }

    document.getElementById('room-title-display').textContent = roomInfo.name;

    const isHostEl = document.getElementById('host-controls');
    if (isHostEl) isHostEl.style.display = isHost ? '' : 'none';
  }

  function _bindRoomEvents() {
    // Ready toggle
    document.getElementById('btn-ready')?.addEventListener('click', () => {
      const roomInfo = Network.getRoomInfo();
      const me = roomInfo?.players.find(p => p.peerId === Network.getMyId());
      const newReady = !me?.ready;
      Network.sendPlayerReady(newReady);
      document.getElementById('btn-ready').textContent = newReady ? '⏸ Not Ready' : '✅ Ready';
    });

    // Start match (host only)
    document.getElementById('btn-start-match')?.addEventListener('click', () => {
      const roomInfo = Network.getRoomInfo();
      if (!roomInfo) return;

      // Check all players have characters
      for (const p of roomInfo.players) {
        if (!p.characterId) { toast(`${p.name} hasn't picked a character!`, 'error'); return; }
      }
      if (!roomInfo.selectedMap) { toast('Please select a map!', 'error'); return; }

      // Check all ready (excluding host who can force start)
      const notReady = roomInfo.players.filter(p => !p.ready && p.peerId !== Network.getMyId());
      if (notReady.length > 0) {
        toast('Not all players are ready!', 'error'); return;
      }

      const config = {
        mapId: roomInfo.selectedMap,
        players: roomInfo.players.map((p, i) => ({
          peerId: p.peerId,
          name: p.name,
          characterId: p.characterId,
          slot: i,
        })),
        stocks: 3,
        timeLimit: 180,
      };
      Network.sendStartMatch(config);
    });

    // Leave room
    document.getElementById('btn-leave-room')?.addEventListener('click', () => {
      Network.leaveRoom();
      showScreen('lobby');
    });

    // Chat
    document.getElementById('chat-send-btn')?.addEventListener('click', _sendChat);
    document.getElementById('chat-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') _sendChat();
    });
  }

  function _refreshRoomUI(roomInfo) {
    if (!roomInfo) return;

    // Player slots
    for (let i = 0; i < 4; i++) {
      const slotEl = document.getElementById(`player-slot-${i}`);
      if (!slotEl) continue;
      const player = roomInfo.players[i];
      const isMe = player?.peerId === Network.getMyId();

      if (player) {
        slotEl.className = 'player-slot filled' + (isMe ? ' me' : '') + (player.ready ? ' ready' : '');
        const charDef = player.characterId ? CHARACTER_REGISTRY[player.characterId] : null;
        slotEl.innerHTML = `
          <div class="slot-num">P${i+1}</div>
          <div class="slot-player-name">${_esc(player.name)} ${isMe ? '(you)' : ''}</div>
          <div class="slot-char-name">${charDef ? charDef.emoji + ' ' + charDef.displayName : '—'}</div>
          ${player.ready ? '<span class="slot-ready-badge">READY</span>' : ''}
          ${i === 0 && roomInfo.hostId === player.peerId ? '<span class="tag tag-host" style="margin-top:4px">HOST</span>' : ''}
        `;
      } else {
        slotEl.className = 'player-slot';
        slotEl.innerHTML = `<div class="slot-num">P${i+1}</div><div class="slot-empty-txt">Waiting…</div>`;
      }
    }

    // Map display
    if (roomInfo.selectedMap) {
      document.querySelectorAll('.map-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.mapId === roomInfo.selectedMap);
      });
      selectedMap = roomInfo.selectedMap;
    }

    // Host start button
    const startBtn = document.getElementById('btn-start-match');
    if (startBtn) {
      const allReady = roomInfo.players.filter(p => p.peerId !== Network.getMyId()).every(p => p.ready);
      startBtn.disabled = !allReady || roomInfo.players.length < 2;
    }
  }

  function _refreshReadyState() {
    // After character select, check if we can mark ready
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
    const div = document.createElement('div');
    div.style.cssText = `font-size:12px;padding:3px 0;color:${isMe ? '#aaddff' : '#cccccc'};font-family:var(--font-mono)`;
    div.innerHTML = `<span style="color:${isMe ? '#4488ff' : '#888'}">${_esc(name || 'Player')}:</span> ${_esc(text)}`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  // ─── STATUS BAR ───
  function _updateStatusBar(status, id) {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    if (!dot || !text) return;
    dot.className = 'status-dot ' + status;
    if (status === 'connected') text.textContent = `Connected — ID: ${id}`;
    else if (status === 'connecting') text.textContent = 'Connecting…';
    else if (status === 'disconnected') text.textContent = 'Disconnected';
    else text.textContent = 'Connection error';
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
      if (result === 'win') { title.textContent = 'VICTORY!'; title.style.background = 'linear-gradient(135deg,#22c55e,#86efac)'; }
      else if (result === 'loss') { title.textContent = 'DEFEAT'; title.style.background = 'linear-gradient(135deg,#ef4444,#fca5a5)'; }
      else { title.textContent = 'DRAW'; title.style.background = 'linear-gradient(135deg,#ffb800,#fde68a)'; }
      title.style.webkitBackgroundClip = 'text';
      title.style.webkitTextFillColor = 'transparent';
    }
    if (sub && winner) {
      sub.textContent = winner.playerName + ' wins!';
    } else if (sub) {
      sub.textContent = "It's a draw!";
    }
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

  // ─── UTILS ───
  function _esc(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return {
    init, showScreen, toast, showMatchResult,
  };
})();

window.UI = UI;
// Expose toast globally for convenience
window.toast = UI.toast;
