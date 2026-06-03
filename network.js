// ═══════════════════════════════════════════════════════════
//  NETWORK LAYER  — BrawlForge
//  PeerJS (WebRTC) P2P for GitHub Pages compatibility.
//  Rooms are simulated: host shares a Room ID that encodes
//  room name + password hash. Peers connect directly.
//
//  Message protocol: { type, payload, seq, ts }
// ═══════════════════════════════════════════════════════════

const Network = (() => {
  let peer = null;
  let connections = [];   // DataChannel connections
  let isHost = false;
  let myId = null;
  let roomInfo = null;    // { name, passwordHash, hostId, players: [] }

  // Lobby broadcast uses BroadcastChannel for same-machine testing
  // Real multiplayer uses PeerJS data channels
  let broadcastChannel = null;

  const handlers = {};
  const PEERJS_CONFIG = {
    // Using PeerJS cloud — free, works on GitHub Pages
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ]
    }
  };

  // Simple hash for password (not security-grade, just room gating)
  async function hashPassword(pass) {
    if (!pass) return '';
    const enc = new TextEncoder().encode(pass);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('').slice(0,16);
  }

  // Encode room ID: base64 of {name, hash, hostPeerId}
  function encodeRoomId(name, passwordHash, hostPeerId) {
    const obj = { n: name, h: passwordHash, p: hostPeerId };
    return btoa(JSON.stringify(obj)).replace(/=/g,'');
  }

  function decodeRoomId(id) {
    try {
      // Pad base64
      const padded = id + '=='.slice((id.length % 4) || 4);
      return JSON.parse(atob(padded));
    } catch { return null; }
  }

  // ─── INIT ───
  function init(playerName) {
    return new Promise((resolve, reject) => {
      if (peer && !peer.destroyed) {
        resolve(myId);
        return;
      }
      // Create peer with readable ID
      const safeId = 'bf-' + playerName.replace(/[^a-z0-9]/gi,'').toLowerCase().slice(0,10) + '-' + Math.random().toString(36).slice(2,6);
      peer = new Peer(safeId, PEERJS_CONFIG);

      peer.on('open', id => {
        myId = id;
        emit('status', { status: 'connected', id });
        resolve(id);
      });

      peer.on('connection', conn => _handleIncomingConnection(conn));
      peer.on('error', err => {
        console.error('[Net] Peer error:', err);
        emit('error', { message: err.message, type: err.type });
        // If ID taken, retry with random
        if (err.type === 'unavailable-id') {
          const randId = 'bf-' + Math.random().toString(36).slice(2,10);
          peer = new Peer(randId, PEERJS_CONFIG);
          peer.on('open', id => { myId = id; resolve(id); });
          peer.on('connection', conn => _handleIncomingConnection(conn));
          peer.on('error', e => reject(e));
        }
      });
      peer.on('disconnected', () => emit('status', { status: 'disconnected' }));
    });
  }

  // ─── HOST a room ───
  async function createRoom(roomName, password) {
    const passwordHash = await hashPassword(password);
    const roomId = encodeRoomId(roomName, passwordHash, myId);

    isHost = true;
    roomInfo = {
      id: roomId,
      name: roomName,
      passwordHash,
      hostId: myId,
      players: [{
        peerId: myId,
        name: StatsSystem.getPlayerName(),
        characterId: null,
        ready: false,
        slot: 0,
      }],
      selectedMap: null,
      maxPlayers: 4,
    };

    // Broadcast room to lobby (same-origin tabs for LAN play)
    _startLobbyBroadcast();

    emit('roomCreated', { roomInfo, roomId });
    return { roomInfo, roomId };
  }

  // ─── JOIN by room ID ───
  async function joinRoom(roomId, password) {
    const decoded = decodeRoomId(roomId);
    if (!decoded) throw new Error('Invalid room ID');

    // Verify password
    const hash = await hashPassword(password);
    if (decoded.h && decoded.h !== hash) {
      throw new Error('Incorrect password');
    }

    const hostPeerId = decoded.p;
    if (hostPeerId === myId) throw new Error('Cannot join your own room');

    const conn = peer.connect(hostPeerId, {
      label: 'brawlforge',
      serialization: 'json',
      reliable: true,
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timed out')), 10000);

      conn.on('open', () => {
        clearTimeout(timeout);
        _registerConnection(conn);
        // Send join request
        _send(conn, {
          type: 'JOIN_REQUEST',
          payload: {
            name: StatsSystem.getPlayerName(),
            peerId: myId,
            roomId,
          }
        });
        resolve(conn);
      });
      conn.on('error', e => { clearTimeout(timeout); reject(e); });
    });
  }

  // ─── HANDLE INCOMING CONNECTION (host side) ───
  function _handleIncomingConnection(conn) {
    conn.on('open', () => {
      _registerConnection(conn);
    });
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
    if (conn.open) {
      conn.send({ ...msg, seq: _seq++, ts: Date.now() });
    }
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
        if (!isHost) return;
        _handleJoinRequest(conn, msg.payload);
        break;

      case 'ROOM_STATE':
        // Guest receives full room state from host
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
        if (isHost) _broadcastRoom(conn.peer); // relay to others
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
        if (isHost) {
          roomInfo.selectedMap = msg.payload.mapId;
          _broadcastRoom();
        } else {
          roomInfo.selectedMap = msg.payload.mapId;
          emit('roomUpdated', { roomInfo });
        }
        break;

      case 'START_MATCH':
        emit('matchStart', msg.payload);
        break;

      case 'GAME_INPUT':
        emit('remoteInput', { peerId: conn.peer, input: msg.payload });
        if (isHost) _broadcast(msg, conn.peer); // relay
        break;

      case 'GAME_STATE':
        emit('gameState', msg.payload);
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
    if (roomInfo.players.length >= roomInfo.maxPlayers) {
      _send(conn, { type: 'JOIN_REJECTED', payload: { reason: 'Room is full' } });
      conn.close();
      return;
    }

    const slot = roomInfo.players.length;
    const newPlayer = {
      peerId: payload.peerId,
      name: payload.name,
      characterId: null,
      ready: false,
      slot,
    };
    roomInfo.players.push(newPlayer);

    // Send full room state to new player
    _send(conn, { type: 'ROOM_STATE', payload: { roomInfo } });

    // Broadcast updated room to everyone else
    _broadcastRoom(payload.peerId);

    emit('playerJoined', { player: newPlayer, roomInfo });
  }

  function _broadcastRoom(excludePeerId = null) {
    if (!isHost) return;
    _broadcast({ type: 'ROOM_STATE', payload: { roomInfo } }, excludePeerId);
    emit('roomUpdated', { roomInfo });
  }

  // ─── PUBLIC SEND HELPERS ───
  function sendPlayerUpdate(data) {
    const msg = { type: 'PLAYER_UPDATE', payload: { peerId: myId, ...data } };
    // Update local
    if (roomInfo) {
      const p = roomInfo.players.find(pl => pl.peerId === myId);
      if (p) Object.assign(p, data);
    }
    if (isHost) { _broadcast(msg); emit('roomUpdated', { roomInfo }); }
    else if (connections.length) _broadcast(msg);
  }

  function sendPlayerReady(ready) {
    const msg = { type: 'PLAYER_READY', payload: { peerId: myId, ready } };
    if (roomInfo) {
      const p = roomInfo.players.find(pl => pl.peerId === myId);
      if (p) p.ready = ready;
    }
    _broadcast(msg);
    emit('roomUpdated', { roomInfo });
  }

  function sendMapSelect(mapId) {
    if (roomInfo) roomInfo.selectedMap = mapId;
    _broadcast({ type: 'MAP_SELECT', payload: { mapId } });
    emit('roomUpdated', { roomInfo });
  }

  function sendStartMatch(matchConfig) {
    _broadcast({ type: 'START_MATCH', payload: matchConfig });
    emit('matchStart', matchConfig);
  }

  function sendGameInput(input) {
    _broadcast({ type: 'GAME_INPUT', payload: input });
  }

  function sendHitEvent(data) {
    _broadcast({ type: 'HIT_EVENT', payload: data });
  }

  function sendDeathEvent(data) {
    _broadcast({ type: 'PLAYER_DIED', payload: data });
  }

  function sendMatchEnd(data) {
    _broadcast({ type: 'MATCH_END', payload: data });
    emit('matchEnd', data);
  }

  function sendChat(text) {
    const msg = { type: 'CHAT', payload: { name: StatsSystem.getPlayerName(), text, ts: Date.now() } };
    _broadcast(msg);
    emit('chat', { from: myId, name: StatsSystem.getPlayerName(), text });
  }

  function pingAll() {
    _broadcast({ type: 'PING', payload: { ts: Date.now() } });
  }

  // ─── LOBBY BROADCAST (BroadcastChannel for same-origin) ───
  // This lets players on the same machine/network share room info
  const LOBBY_CHANNEL = 'brawlforge_lobby';
  let lobbyChannel = null;
  let knownRooms = {}; // roomId -> { ...roomInfo, seenAt }

  function _startLobbyBroadcast() {
    if (!window.BroadcastChannel) return;
    if (!lobbyChannel) {
      lobbyChannel = new BroadcastChannel(LOBBY_CHANNEL);
      lobbyChannel.onmessage = _handleLobbyBroadcast;
    }
    // Announce every 3s
    _broadcastLobby();
    const interval = setInterval(() => {
      if (!isHost || !roomInfo) { clearInterval(interval); return; }
      _broadcastLobby();
    }, 3000);
  }

  function _broadcastLobby() {
    if (!isHost || !roomInfo || !lobbyChannel) return;
    lobbyChannel.postMessage({
      type: 'ROOM_ANNOUNCE',
      payload: {
        roomId: roomInfo.id,
        name: roomInfo.name,
        hasPassword: !!roomInfo.passwordHash,
        players: roomInfo.players.length,
        maxPlayers: roomInfo.maxPlayers,
        hostId: myId,
        hostName: StatsSystem.getPlayerName(),
        ts: Date.now(),
      }
    });
  }

  function startLobbyListen() {
    if (!window.BroadcastChannel) return;
    if (!lobbyChannel) {
      lobbyChannel = new BroadcastChannel(LOBBY_CHANNEL);
      lobbyChannel.onmessage = _handleLobbyBroadcast;
    }
  }

  function _handleLobbyBroadcast(event) {
    if (!event.data) return;
    if (event.data.type === 'ROOM_ANNOUNCE') {
      const room = event.data.payload;
      if (room.hostId === myId) return; // our own
      knownRooms[room.roomId] = { ...room, seenAt: Date.now() };
      emit('lobbyUpdate', { rooms: getLobbyRooms() });
    }
  }

  function getLobbyRooms() {
    const now = Date.now();
    // Expire rooms not seen in 10s
    for (const [id, room] of Object.entries(knownRooms)) {
      if (now - room.seenAt > 10000) delete knownRooms[id];
    }
    return Object.values(knownRooms);
  }

  function requestLobbyRooms() {
    emit('lobbyUpdate', { rooms: getLobbyRooms() });
  }

  // ─── EVENTS ───
  function on(event, handler) {
    if (!handlers[event]) handlers[event] = [];
    handlers[event].push(handler);
  }
  function off(event, handler) {
    if (handlers[event]) handlers[event] = handlers[event].filter(h => h !== handler);
  }
  function emit(event, data) {
    if (handlers[event]) handlers[event].forEach(h => h(data));
  }

  function getMyId() { return myId; }
  function getIsHost() { return isHost; }
  function getRoomInfo() { return roomInfo; }
  function getMyPeerId() { return myId; }
  function getConnections() { return connections; }

  function leaveRoom() {
    for (const conn of connections) conn.close();
    connections = [];
    isHost = false;
    if (isHost && lobbyChannel) {
      lobbyChannel.postMessage({ type: 'ROOM_GONE', payload: { roomId: roomInfo?.id } });
    }
    roomInfo = null;
    emit('leftRoom', {});
  }

  function destroy() {
    leaveRoom();
    if (peer) { peer.destroy(); peer = null; }
    if (lobbyChannel) { lobbyChannel.close(); lobbyChannel = null; }
  }

  return {
    init, createRoom, joinRoom,
    sendPlayerUpdate, sendPlayerReady, sendMapSelect,
    sendStartMatch, sendGameInput, sendHitEvent,
    sendDeathEvent, sendMatchEnd, sendChat, pingAll,
    startLobbyListen, getLobbyRooms, requestLobbyRooms,
    leaveRoom, destroy,
    getMyId, getIsHost, getRoomInfo, getMyPeerId, getConnections,
    on, off,
    decodeRoomId,
  };
})();

window.Network = Network;
