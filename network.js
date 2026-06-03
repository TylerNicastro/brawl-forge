// ═══════════════════════════════════════════════════════════
//  NETWORK LAYER  — BrawlForge
// ═══════════════════════════════════════════════════════════

const Network = (() => {
  let peer = null;
  let connections = [];
  let isHost = false;
  let myId = null;
  let roomInfo = null;

  let lobbyChannel = null;
  let knownRooms = {};

  const handlers = {};
  const PEERJS_CONFIG = {
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ]
    }
  };

  // ─── ONE-ROOM-AT-A-TIME SESSION LOCK ───
  // Stored in localStorage so it persists across page reloads on same origin.
  // Key = peerId stored on first connect. Cleared on leaveRoom/destroy.
  const SESSION_KEY = 'brawlforge_session_v1';

  function _claimSession(peerId) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ peerId, ts: Date.now() }));
  }
  function _releaseSession() {
    localStorage.removeItem(SESSION_KEY);
  }
  function _isAlreadyInRoom() {
    // Returns true if a session exists and is recent (< 30 min), not our own ID
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      const { peerId, ts } = JSON.parse(raw);
      if (Date.now() - ts > 30 * 60 * 1000) { _releaseSession(); return false; }
      return peerId !== myId; // same browser/tab = same myId, so it's us
    } catch { return false; }
  }

  async function hashPassword(pass) {
    if (!pass) return '';
    const enc = new TextEncoder().encode(pass);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('').slice(0,16);
  }

  function encodeRoomId(name, passwordHash, hostPeerId) {
    return btoa(JSON.stringify({ n: name, h: passwordHash, p: hostPeerId })).replace(/=/g,'');
  }
  function decodeRoomId(id) {
    try {
      const padded = id + '=='.slice((id.length % 4) || 4);
      return JSON.parse(atob(padded));
    } catch { return null; }
  }

  // ─── INIT ───
  function init(playerName) {
    return new Promise((resolve, reject) => {
      if (peer && !peer.destroyed) { resolve(myId); return; }
      const safeId = 'bf-' + playerName.replace(/[^a-z0-9]/gi,'').toLowerCase().slice(0,10) + '-' + Math.random().toString(36).slice(2,6);
      peer = new Peer(safeId, PEERJS_CONFIG);
      peer.on('open', id => {
        myId = id;
        _claimSession(id); // mark this tab as the active session
        emit('status', { status: 'connected', id });
        resolve(id);
      });
      peer.on('connection', conn => _handleIncomingConnection(conn));
      peer.on('error', err => {
        console.error('[Net] Peer error:', err);
        emit('error', { message: err.message, type: err.type });
        if (err.type === 'unavailable-id') {
          const randId = 'bf-' + Math.random().toString(36).slice(2,10);
          peer = new Peer(randId, PEERJS_CONFIG);
          peer.on('open', id => { myId = id; _claimSession(id); resolve(id); });
          peer.on('connection', conn => _handleIncomingConnection(conn));
          peer.on('error', e => reject(e));
        }
      });
      peer.on('disconnected', () => emit('status', { status: 'disconnected' }));
    });
  }

  // ─── CREATE ROOM ───
  async function createRoom(roomName, password) {
    if (roomInfo) throw new Error('You are already in a room. Leave first.');
    const passwordHash = await hashPassword(password);
    const roomId = encodeRoomId(roomName, passwordHash, myId);
    isHost = true;
    roomInfo = {
      id: roomId, name: roomName, passwordHash,
      hostId: myId,
      players: [{
        peerId: myId,
        name: StatsSystem.getPlayerName(),
        characterId: null, ready: false, slot: 0,
      }],
      selectedMap: null,
      maxPlayers: 4,
      settings: { stocks: 3, timeLimit: 180, useTimer: true },
    };
    _startLobbyBroadcast();
    emit('roomCreated', { roomInfo, roomId });
    return { roomInfo, roomId };
  }

  // ─── JOIN ROOM ───
  async function joinRoom(roomId, password) {
    if (roomInfo) throw new Error('You are already in a room. Leave first.');
    const decoded = decodeRoomId(roomId);
    if (!decoded) throw new Error('Invalid room ID');
    const hash = await hashPassword(password);
    if (decoded.h && decoded.h !== hash) throw new Error('Incorrect password');
    const hostPeerId = decoded.p;
    if (hostPeerId === myId) throw new Error('Cannot join your own room');

    const conn = peer.connect(hostPeerId, { label: 'brawlforge', serialization: 'json', reliable: true });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timed out')), 10000);
      conn.on('open', () => {
        clearTimeout(timeout);
        _registerConnection(conn);
        _send(conn, { type: 'JOIN_REQUEST', payload: { name: StatsSystem.getPlayerName(), peerId: myId, roomId } });
        resolve(conn);
      });
      conn.on('error', e => { clearTimeout(timeout); reject(e); });
    });
  }

  function _handleIncomingConnection(conn) {
    conn.on('open', () => _registerConnection(conn));
  }

  function _registerConnection(conn) {
    connections.push(conn);
    conn.on('data', data => _handleMessage(conn, data));
    conn.on('close', () => {
      connections = connections.filter(c => c !== conn);
      if (roomInfo) {
        const left = roomInfo.players.find(p => p.peerId === conn.peer);
        if (left) {
          roomInfo.players = roomInfo.players.filter(p => p.peerId !== conn.peer);
          emit('playerLeft', { player: left, roomInfo });
          if (isHost) _broadcastRoom();
        }
      }
    });
    conn.on('error', e => console.error('[Net] Conn error:', e));
  }

  // ─── MESSAGE HANDLING ───
  let _seq = 0;
  function _send(conn, msg) {
    if (conn.open) conn.send({ ...msg, seq: _seq++, ts: Date.now() });
  }
  function _broadcast(msg, excludePeerId = null) {
    for (const conn of connections) {
      if (conn.peer !== excludePeerId) _send(conn, msg);
    }
  }

  function _handleMessage(conn, msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'JOIN_REQUEST':
        if (isHost) _handleJoinRequest(conn, msg.payload);
        break;
      case 'JOIN_REJECTED':
        emit('error', { message: msg.payload.reason });
        conn.close();
        break;
      case 'ROOM_STATE':
        roomInfo = msg.payload.roomInfo;
        isHost = false;
        emit('roomJoined', { roomInfo });
        break;
      case 'PLAYER_UPDATE':
        if (roomInfo) {
          const idx = roomInfo.players.findIndex(p => p.peerId === msg.payload.peerId);
          if (idx !== -1) roomInfo.players[idx] = { ...roomInfo.players[idx], ...msg.payload };
          else roomInfo.players.push(msg.payload);
          emit('roomUpdated', { roomInfo });
        }
        if (isHost) _broadcastRoom(conn.peer);
        break;
      case 'PLAYER_READY':
        if (roomInfo) {
          const p = roomInfo.players.find(pl => pl.peerId === msg.payload.peerId);
          if (p) p.ready = msg.payload.ready;
          emit('roomUpdated', { roomInfo });
        }
        if (isHost) _broadcast(msg, conn.peer);
        break;
      case 'MAP_SELECT':
        if (isHost) { roomInfo.selectedMap = msg.payload.mapId; _broadcastRoom(); }
        else { roomInfo.selectedMap = msg.payload.mapId; emit('roomUpdated', { roomInfo }); }
        break;
      case 'ROOM_SETTINGS':
        if (isHost) {
          roomInfo.settings = { ...roomInfo.settings, ...msg.payload };
          _broadcastRoom();
        } else {
          if (roomInfo) roomInfo.settings = { ...roomInfo.settings, ...msg.payload };
          emit('roomUpdated', { roomInfo });
        }
        break;
      case 'START_MATCH':
        emit('matchStart', msg.payload);
        break;
      case 'GAME_INPUT':
        emit('remoteInput', { peerId: conn.peer, input: msg.payload });
        if (isHost) _broadcast(msg, conn.peer);
        break;
      case 'HIT_EVENT':
        emit('remoteHit', { peerId: conn.peer, ...msg.payload });
        if (isHost) _broadcast(msg, conn.peer);
        break;
      case 'PLAYER_DIED':
        emit('remoteDeath', { peerId: conn.peer, ...msg.payload });
        if (isHost) _broadcast(msg, conn.peer);
        break;
      case 'MATCH_END':
        emit('matchEnd', msg.payload);
        break;
      case 'CHAT':
        emit('chat', { from: conn.peer, ...msg.payload });
        if (isHost) _broadcast(msg, conn.peer);
        break;
      case 'PING':
        _send(conn, { type: 'PONG', payload: { ts: msg.payload.ts } });
        break;
      case 'PONG':
        emit('ping', { peerId: conn.peer, latency: Date.now() - msg.payload.ts });
        break;
      default:
        console.warn('[Net] Unknown msg type:', msg.type);
    }
  }

  function _handleJoinRequest(conn, payload) {
    if (!roomInfo) return;
    // One-room-per-peer check: reject if peer already in room
    if (roomInfo.players.find(p => p.peerId === payload.peerId)) {
      _send(conn, { type: 'JOIN_REJECTED', payload: { reason: 'You are already in this room.' } });
      conn.close(); return;
    }
    if (roomInfo.players.length >= roomInfo.maxPlayers) {
      _send(conn, { type: 'JOIN_REJECTED', payload: { reason: 'Room is full' } });
      conn.close(); return;
    }
    const slot = roomInfo.players.length;
    const newPlayer = { peerId: payload.peerId, name: payload.name, characterId: null, ready: false, slot };
    roomInfo.players.push(newPlayer);
    _send(conn, { type: 'ROOM_STATE', payload: { roomInfo } });
    _broadcastRoom(payload.peerId);
    emit('playerJoined', { player: newPlayer, roomInfo });
  }

  function _broadcastRoom(excludePeerId = null) {
    if (!isHost) return;
    _broadcast({ type: 'ROOM_STATE', payload: { roomInfo } }, excludePeerId);
    emit('roomUpdated', { roomInfo });
  }

  // ─── SEND HELPERS ───
  function sendPlayerUpdate(data) {
    const msg = { type: 'PLAYER_UPDATE', payload: { peerId: myId, ...data } };
    if (roomInfo) { const p = roomInfo.players.find(pl => pl.peerId === myId); if (p) Object.assign(p, data); }
    if (isHost) { _broadcast(msg); emit('roomUpdated', { roomInfo }); }
    else if (connections.length) _broadcast(msg);
  }
  function sendPlayerReady(ready) {
    const msg = { type: 'PLAYER_READY', payload: { peerId: myId, ready } };
    if (roomInfo) { const p = roomInfo.players.find(pl => pl.peerId === myId); if (p) p.ready = ready; }
    _broadcast(msg);
    emit('roomUpdated', { roomInfo });
  }
  function sendMapSelect(mapId) {
    if (roomInfo) roomInfo.selectedMap = mapId;
    _broadcast({ type: 'MAP_SELECT', payload: { mapId } });
    emit('roomUpdated', { roomInfo });
  }
  function sendRoomSettings(settings) {
    if (!isHost) return;
    roomInfo.settings = { ...roomInfo.settings, ...settings };
    _broadcastRoom();
  }
  function sendStartMatch(matchConfig) {
    _broadcast({ type: 'START_MATCH', payload: matchConfig });
    emit('matchStart', matchConfig);
  }
  function sendGameInput(input)  { _broadcast({ type: 'GAME_INPUT',  payload: input }); }
  function sendHitEvent(data)    { _broadcast({ type: 'HIT_EVENT',   payload: data  }); }
  function sendDeathEvent(data)  { _broadcast({ type: 'PLAYER_DIED', payload: data  }); }
  function sendMatchEnd(data)    { _broadcast({ type: 'MATCH_END',   payload: data  }); emit('matchEnd', data); }
  function sendChat(text) {
    const msg = { type: 'CHAT', payload: { name: StatsSystem.getPlayerName(), text, ts: Date.now() } };
    _broadcast(msg);
    emit('chat', { from: myId, name: StatsSystem.getPlayerName(), text });
  }
  function pingAll() { _broadcast({ type: 'PING', payload: { ts: Date.now() } }); }

  // ─── LOBBY BROADCAST ───
  const LOBBY_CHANNEL = 'brawlforge_lobby';
  function _startLobbyBroadcast() {
    if (!window.BroadcastChannel) return;
    if (!lobbyChannel) { lobbyChannel = new BroadcastChannel(LOBBY_CHANNEL); lobbyChannel.onmessage = _handleLobbyBroadcast; }
    _broadcastLobby();
    const interval = setInterval(() => {
      if (!isHost || !roomInfo) { clearInterval(interval); return; }
      _broadcastLobby();
    }, 3000);
  }
  function _broadcastLobby() {
    if (!isHost || !roomInfo || !lobbyChannel) return;
    lobbyChannel.postMessage({ type: 'ROOM_ANNOUNCE', payload: {
      roomId: roomInfo.id, name: roomInfo.name,
      hasPassword: !!roomInfo.passwordHash,
      players: roomInfo.players.length, maxPlayers: roomInfo.maxPlayers,
      hostId: myId, hostName: StatsSystem.getPlayerName(), ts: Date.now(),
    }});
  }
  function startLobbyListen() {
    if (!window.BroadcastChannel) return;
    if (!lobbyChannel) { lobbyChannel = new BroadcastChannel(LOBBY_CHANNEL); lobbyChannel.onmessage = _handleLobbyBroadcast; }
  }
  function _handleLobbyBroadcast(event) {
    if (!event.data) return;
    if (event.data.type === 'ROOM_ANNOUNCE') {
      const room = event.data.payload;
      if (room.hostId === myId) return;
      knownRooms[room.roomId] = { ...room, seenAt: Date.now() };
      emit('lobbyUpdate', { rooms: getLobbyRooms() });
    }
  }
  function getLobbyRooms() {
    const now = Date.now();
    for (const [id, room] of Object.entries(knownRooms)) { if (now - room.seenAt > 10000) delete knownRooms[id]; }
    return Object.values(knownRooms);
  }
  function requestLobbyRooms() { emit('lobbyUpdate', { rooms: getLobbyRooms() }); }

  // ─── EVENTS ───
  function on(event, h)  { if (!handlers[event]) handlers[event] = []; handlers[event].push(h); }
  function off(event, h) { if (handlers[event]) handlers[event] = handlers[event].filter(x => x !== h); }
  function emit(event, data) { if (handlers[event]) handlers[event].forEach(h => h(data)); }

  function getMyId()       { return myId; }
  function getIsHost()     { return isHost; }
  function getRoomInfo()   { return roomInfo; }
  function getMyPeerId()   { return myId; }
  function getConnections(){ return connections; }

  function leaveRoom() {
    for (const conn of connections) conn.close();
    connections = [];
    const wasHost = isHost;
    isHost = false;
    if (wasHost && lobbyChannel && roomInfo) {
      lobbyChannel.postMessage({ type: 'ROOM_GONE', payload: { roomId: roomInfo.id } });
    }
    roomInfo = null;
    emit('leftRoom', {});
  }
  function destroy() {
    leaveRoom();
    _releaseSession();
    if (peer) { peer.destroy(); peer = null; }
    if (lobbyChannel) { lobbyChannel.close(); lobbyChannel = null; }
  }

  return {
    init, createRoom, joinRoom,
    sendPlayerUpdate, sendPlayerReady, sendMapSelect, sendRoomSettings,
    sendStartMatch, sendGameInput, sendHitEvent, sendDeathEvent, sendMatchEnd, sendChat, pingAll,
    startLobbyListen, getLobbyRooms, requestLobbyRooms,
    leaveRoom, destroy,
    getMyId, getIsHost, getRoomInfo, getMyPeerId, getConnections,
    on, off, decodeRoomId,
  };
})();

window.Network = Network;
