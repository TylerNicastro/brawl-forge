// ═══════════════════════════════════════════════════════════
//  GAME ENGINE  — BrawlForge
//  Handles: game loop, input, physics, hit detection,
//  projectiles, camera, HUD updates, network sync
// ═══════════════════════════════════════════════════════════

const Engine = (() => {

  // ─── STATE ───
  let canvas, ctx;
  let players = [];       // CharacterBase instances
  let localPlayer = null; // which player is controlled by this client
  let remotePlayer = null;
  let map = null;
  let projectiles = [];
  let damageNumbers = [];
  let running = false;
  let paused = false;
  let gameOver = false;
  let matchConfig = {};
  let lastTime = 0;
  let frameCount = 0;
  let matchTimer = 0;     // seconds remaining
  let matchTimerInterval = null;
  let stocks = [3, 3];

  // Camera
  const camera = { x: 0, y: 0, scale: 1, targetX: 0, targetY: 0 };

  // Input state — stores raw key values (KeyboardEvent.key, lowercased)
  const keys = {};
  const prevKeys = {};

  // Double-tap run detection
  const tapTracker = {};

  // ─── INIT ───
  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    _setupInput();
    _resizeCanvas();
    window.addEventListener('resize', _resizeCanvas);
  }

  function _resizeCanvas() {
    canvas.width = canvas.clientWidth || window.innerWidth;
    canvas.height = canvas.clientHeight || window.innerHeight;
  }

  // ─── START MATCH ───
  function startMatch(config) {
    matchConfig = config;
    players = [];
    projectiles = [];
    damageNumbers = [];
    gameOver = false;
    paused = false;
    frameCount = 0;

    // Build map
    const MapClass = MAP_REGISTRY[config.mapId]?.Class;
    if (!MapClass) { console.error('Map not found:', config.mapId); return; }
    map = new MapClass();

    // Build characters
    for (let i = 0; i < config.players.length; i++) {
      const p = config.players[i];
      const CharClass = CHARACTER_REGISTRY[p.characterId]?.Class;
      if (!CharClass) { console.error('Character not found:', p.characterId); continue; }

      const char = new CharClass();
      char.playerIndex = i;
      char.peerId = p.peerId;
      char.playerName = p.name;
      char.spawnX = map.spawnPoints[i]?.x ?? 400 + i * 200;
      char.spawnY = map.spawnPoints[i]?.y ?? 200;
      char.respawn(char.spawnX, char.spawnY);
      char.stocks = config.stocks ?? 3;
      players.push(char);

      if (p.peerId === Network.getMyId()) {
        localPlayer = char;
      } else {
        remotePlayer = char;
      }
    }

    // Match timer
    matchTimer = config.timeLimit ?? 180;
    if (matchTimerInterval) clearInterval(matchTimerInterval);
    matchTimerInterval = setInterval(() => {
      if (!running || paused || gameOver) return;
      matchTimer--;
      _updateHUDTimer();
      if (matchTimer <= 0) _handleTimeOut();
    }, 1000);

    // Stats session
    StatsSystem.startSession({
      playerName: localPlayer?.playerName,
      characterId: localPlayer?.id,
      mapId: config.mapId,
      opponentName: remotePlayer?.playerName,
      isHost: Network.getIsHost(),
    });

    running = true;
    _gameLoop(0);

    _updateHUD();
    UI.showScreen('game');

    // Countdown
    _startCountdown(() => { paused = false; });
    paused = true; // wait for countdown
  }

  function _startCountdown(cb) {
    const el = document.getElementById('countdown-overlay');
    const nums = ['3', '2', '1', 'FIGHT!'];
    let i = 0;
    const show = () => {
      el.innerHTML = `<div class="countdown-num">${nums[i]}</div>`;
      i++;
      if (i < nums.length) setTimeout(show, 900);
      else setTimeout(() => { el.innerHTML = ''; cb(); }, 900);
    };
    show();
  }

  // ─── GAME LOOP ───
  function _gameLoop(ts) {
    if (!running) return;

    const dt = Math.min((ts - lastTime) / 16, 3); // cap at 3x
    lastTime = ts;
    frameCount++;

    if (!paused) {
      _processInput();
      _updatePhysics(dt);
      _checkHits();
      _updateProjectiles(dt);
      _updateCamera(dt);
      _syncNetwork();
    }

    _render();
    _updateHUD();

    requestAnimationFrame(_gameLoop);
  }

  // ─── INPUT ───
  function _setupInput() {
    window.addEventListener('keydown', e => {
      const k = e.key;
      if (!keys[k]) {
        const now = Date.now();
        if (tapTracker[k] && now - tapTracker[k] < 200) keys[k + '_double'] = true;
        tapTracker[k] = now;
      }
      keys[k] = true;
      // Prevent scroll on arrow keys / space
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', e => {
      keys[e.key] = false;
      keys[e.key + '_double'] = false;
    });
  }

  // Check if any key bound to action is currently held
  function _action(action) {
    const bound = Keybindings.get(action);
    return bound.some(k => !!keys[k]);
  }
  // Check if any key bound to action was just pressed this frame
  function _actionJust(action) {
    const bound = Keybindings.get(action);
    return bound.some(k => keys[k] && !prevKeys[k]);
  }

  function _processInput() {
    if (!localPlayer || localPlayer.state === 'dead') return;

    const p = localPlayer;

    // Directional state
    const left   = _action('left');
    const right  = _action('right');
    const down   = _action('down');
    const up     = _action('up');

    const dirX = (right ? 1 : 0) - (left ? 1 : 0);
    const dirY = (down  ? 1 : 0) - (up   ? 1 : 0);

    // Shield
    const shieldHeld = _action('shield') || _action('shield2');
    if (shieldHeld && !(_action('dodge') || _action('dodge2'))) {
      p.shield(true);
    } else {
      p.shield(false);
    }

    // Movement
    if (!p.shielding) p.move(dirX);

    // Fast fall
    if ((down || _action('fastfall')) && !p.onGround && p.vy > 0) p.fastFall();

    // Drop through platform
    if (down && p.onGround && _actionJust('down')) p.dropThrough();

    // Jump
    if (_actionJust('up') || _actionJust('jump')) p.jump();

    // Dodge / airdodge
    if (_actionJust('dodge') || _actionJust('dodge2')) {
      if (p.onGround) p.dodge(dirX);
      else p.airDodge(dirX || 0, dirY || 0);
    }

    // Attack dispatch
    const attackJust  = _actionJust('attack')  || _actionJust('attack2');
    const specialJust = _actionJust('special') || _actionJust('special2');
    const grabJust    = _actionJust('grab')    || _actionJust('grab2');

    if (grabJust) {
      _tryAttack(p, 'grab', dirX, dirY);
    } else if (attackJust) {
      _dispatchAttack(p, dirX, dirY, false);
    } else if (specialJust) {
      _dispatchAttack(p, dirX, dirY, true);
    }

    // Broadcast input to network
    const inputSnap = {
      dirX, dirY, attackJust, specialJust, grabJust,
      shieldHeld, jump: _actionJust('up') || _actionJust('jump'),
      x: p.x, y: p.y, vx: p.vx, vy: p.vy,
      state: p.state, facingRight: p.facingRight,
    };
    Network.sendGameInput(inputSnap);

    // Store prev keys snapshot
    Object.assign(prevKeys, keys);
  }

  function _dispatchAttack(p, dirX, dirY, isSpecial) {
    if (!p.canAttack()) return;

    const onGround = p.onGround;
    const smash = Math.abs(dirX) > 0.7 || Math.abs(dirY) > 0.7;

    if (isSpecial) {
      // Specials
      if (Math.abs(dirX) > 0.3)      _tryAttack(p, 'fspecial', dirX, dirY);
      else if (dirY < -0.3)          _tryAttack(p, 'uspecial', dirX, dirY);
      else if (dirY > 0.3)           _tryAttack(p, 'dspecial', dirX, dirY);
      else                           _tryAttack(p, 'nspecial', dirX, dirY);
    } else if (onGround) {
      if (smash && Math.abs(dirX) > Math.abs(dirY)) _tryAttack(p, 'fsmash', dirX, dirY);
      else if (smash && dirY < 0)                   _tryAttack(p, 'usmash', dirX, dirY);
      else if (smash && dirY > 0)                   _tryAttack(p, 'dsmash', dirX, dirY);
      else if (Math.abs(dirX) > 0.3)                _tryAttack(p, 'ftilt', dirX, dirY);
      else if (dirY < -0.3)                         _tryAttack(p, 'utilt', dirX, dirY);
      else if (dirY > 0.3)                          _tryAttack(p, 'dtilt', dirX, dirY);
      else                                          _tryJabCombo(p);
    } else {
      // Aerials
      if (Math.abs(dirX) < 0.3 && Math.abs(dirY) < 0.3) _tryAttack(p, 'nair', dirX, dirY);
      else if (dirY < -0.3)                              _tryAttack(p, 'uair', dirX, dirY);
      else if (dirY > 0.3)                               _tryAttack(p, 'dair', dirX, dirY);
      else if ((dirX > 0) === p.facingRight)             _tryAttack(p, 'fair', dirX, dirY);
      else                                               _tryAttack(p, 'bair', dirX, dirY);
    }
  }

  // Jab combo state
  const jabCombos = {};
  function _tryJabCombo(p) {
    const now = Date.now();
    const jc = jabCombos[p.peerId] || { count: 0, lastTime: 0 };
    if (now - jc.lastTime > 300) jc.count = 0;
    const step = ['jab', 'jab2', 'jab3'][Math.min(jc.count, 2)];
    if (_tryAttack(p, step, 0, 0)) {
      jc.count++;
      jc.lastTime = now;
    }
    jabCombos[p.peerId] = jc;
  }

  function _tryAttack(p, type, dirX, dirY) {
    if (!p.abilities[type]) return false;
    // Override facing direction based on dirX input
    if (Math.abs(dirX) > 0.3) p.facingRight = dirX > 0;
    return p.doAttack(type, dirX, dirY);
  }

  // ─── APPLY REMOTE INPUT ───
  Network.on('remoteInput', ({ peerId, input }) => {
    const rp = players.find(p => p.peerId === peerId);
    if (!rp || rp === localPlayer) return;

    // Apply position snapshot (with interpolation handled in applySnapshot)
    rp.applySnapshot(input);

    // Replay inputs
    if (input.jump) rp.jump();
    if (Math.abs(input.dirX) > 0) rp.move(input.dirX);
    rp.shield(input.shieldHeld);

    if (input.attackJust) _dispatchAttack(rp, input.dirX, input.dirY, false);
    if (input.specialJust) _dispatchAttack(rp, input.dirX, input.dirY, true);
    if (input.grabJust) _tryAttack(rp, 'grab', input.dirX, input.dirY);
  });

  // ─── PHYSICS ───
  function _updatePhysics(dt) {
    for (const p of players) {
      p.physicsUpdate(map);
      _checkBlastZone(p);
    }
  }

  function _checkBlastZone(p) {
    if (p.state === 'dead') return;
    const bz = map.blastZones;
    if (p.x < bz.left || p.x > bz.right || p.y > bz.bottom || p.y < bz.top) {
      _killPlayer(p);
    }
  }

  function _killPlayer(p) {
    const killer = players.find(q => q !== p);
    p.die();

    if (killer) {
      killer.kills++;
      StatsSystem.recordKill();
      _showKillFeed(killer, p);
    }

    Network.sendDeathEvent({ peerId: p.peerId, killerPeerId: killer?.peerId });

    if (p.stocks <= 0) {
      _checkMatchEnd();
    } else {
      // Respawn
      setTimeout(() => {
        p.respawn(
          map.spawnPoints[p.playerIndex]?.x ?? 600,
          map.spawnPoints[p.playerIndex]?.y ?? 100
        );
      }, 2000);
    }
  }

  // ─── HIT DETECTION ───
  function _checkHits() {
    for (const attacker of players) {
      if (!attacker.hitboxActive) continue;

      for (const defender of players) {
        if (defender === attacker) continue;
        if (defender.state === 'dead') continue;
        if (defender.invincible) continue;

        const hb = attacker.getHitbox();
        const hurt = defender.getHurtbox();
        if (!hb) continue;

        // Circle vs rect intersection
        const nearX = Math.max(hurt.x - hurt.w/2, Math.min(hb.x, hurt.x + hurt.w/2));
        const nearY = Math.max(hurt.y - hurt.h/2, Math.min(hb.y, hurt.y + hurt.h/2));
        const dx = hb.x - nearX, dy = hb.y - nearY;
        const dist2 = dx*dx + dy*dy;

        if (dist2 < hb.r * hb.r) {
          const hit = defender.takeHit(hb);
          if (hit) {
            attacker.damageDealt += hb.damage;
            StatsSystem.recordDamageDealt(hb.damage);
            attacker.hitlag = 8;
            attacker.hitboxActive = false; // prevent multi-hit on same attack

            // Spawn damage number
            _spawnDmgNumber(defender.x, defender.y - 60, hb.damage);

            // Network
            Network.sendHitEvent({
              attackerPeerId: attacker.peerId,
              defenderPeerId: defender.peerId,
              damage: hb.damage,
              attackType: hb.attackType,
            });

            if (defender.hp <= 0) {
              // Will be caught by blast zone; give a nudge
            }
          }
        }
      }
    }
  }

  // ─── PROJECTILES ───
  function _updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const proj = projectiles[i];
      proj.x += proj.vx;
      proj.y += proj.vy;
      proj.life--;

      if (proj.life <= 0 || proj.x < -100 || proj.x > map.width + 100) {
        projectiles.splice(i, 1);
        continue;
      }

      // Check hit on players
      for (const p of players) {
        if (p.peerId === proj.ownerId) continue;
        if (p.state === 'dead' || p.invincible) continue;
        const dx = p.x - proj.x, dy = p.y - proj.y;
        if (dx*dx + dy*dy < (proj.r + p.size.w/2) ** 2) {
          p.takeHit(proj);
          _spawnDmgNumber(p.x, p.y - 60, proj.damage);
          projectiles.splice(i, 1);
          break;
        }
      }
    }
  }

  function spawnProjectile(owner, hitData) {
    projectiles.push({
      x: owner.x + (owner.facingRight ? 1 : -1) * hitData.offsetX,
      y: owner.y + hitData.offsetY,
      vx: (owner.facingRight ? 1 : -1) * 10,
      vy: 0,
      r: hitData.radius ?? 10,
      life: 60,
      ownerId: owner.peerId,
      damage: hitData.damage,
      knockbackX: hitData.knockbackX,
      knockbackY: hitData.knockbackY,
      hitstun: hitData.hitstun,
      color: owner.colorSecondary,
    });
  }

  // ─── CAMERA ───
  function _updateCamera(dt) {
    // Track average position of players
    if (players.length === 0) return;
    let avgX = 0, avgY = 0;
    for (const p of players) { avgX += p.x; avgY += p.y; }
    avgX /= players.length;
    avgY /= players.length;

    // Compute distance between players for zoom
    let maxDist = 0;
    if (players.length === 2) {
      const dx = players[1].x - players[0].x;
      const dy = players[1].y - players[0].y;
      maxDist = Math.sqrt(dx*dx + dy*dy);
    }

    // Lerp camera position
    camera.targetX = avgX;
    camera.targetY = avgY - 50;
    camera.x += (camera.targetX - camera.x) * 0.08;
    camera.y += (camera.targetY - camera.y) * 0.08;
  }

  function worldToScreen(wx, wy) {
    return {
      sx: wx - camera.x + canvas.width / 2,
      sy: wy - camera.y + canvas.height / 2,
    };
  }

  function screenToWorld(sx, sy) {
    return {
      x: sx + camera.x - canvas.width / 2,
      y: sy + camera.y - canvas.height / 2,
    };
  }

  // ─── RENDER ───
  function _render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    // Translate to camera
    ctx.translate(canvas.width/2 - camera.x, canvas.height/2 - camera.y);

    // Map render
    if (map) map.render(ctx, { x: 0, y: 0, scale: 1 });
    // Note: map.render handles its own camera offset internally via renderBackground

    // Render map platforms in world space
    _renderPlatforms();

    // Projectiles
    _renderProjectiles();

    // Players (sorted by z)
    const sorted = [...players].sort((a, b) => a.playerIndex - b.playerIndex);
    for (const p of sorted) {
      if (p.state !== 'dead') p.render(ctx);
    }

    ctx.restore();

    // Damage numbers (screen space)
    _renderDamageNumbers();
  }

  function _renderPlatforms() {
    if (!map) return;
    for (const plat of map.platforms) {
      if (plat.solid) {
        ctx.fillStyle = plat.color ?? '#3a3a5a';
        ctx.strokeStyle = plat.edgeColor ?? '#5a5a8a';
        ctx.lineWidth = 2;
        ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
        ctx.strokeRect(plat.x, plat.y, plat.w, plat.h);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(plat.x + 2, plat.y + 2, plat.w - 4, 5);
      } else {
        const grad = ctx.createLinearGradient(plat.x, plat.y, plat.x, plat.y + plat.h);
        grad.addColorStop(0, plat.topColor ?? '#5a8a5a');
        grad.addColorStop(1, plat.bottomColor ?? '#3a5a3a');
        ctx.fillStyle = grad;
        _roundRect(ctx, plat.x, plat.y, plat.w, plat.h, 4);
        ctx.fill();
        ctx.fillStyle = plat.surfaceColor ?? '#77aa66';
        ctx.fillRect(plat.x, plat.y, plat.w, 5);
        ctx.strokeStyle = plat.glowColor ?? 'rgba(100,180,80,0.4)';
        ctx.lineWidth = 1;
        _roundRect(ctx, plat.x, plat.y, plat.w, plat.h, 4);
        ctx.stroke();
      }
    }
  }

  function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
    ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
  }

  function _renderProjectiles() {
    for (const proj of projectiles) {
      const glow = ctx.createRadialGradient(proj.x, proj.y, 0, proj.x, proj.y, proj.r * 2);
      glow.addColorStop(0, proj.color ?? '#aaddff');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, proj.r * 2, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, proj.r * 0.5, 0, Math.PI*2);
      ctx.fill();
    }
  }

  function _spawnDmgNumber(x, y, damage) {
    const { sx, sy } = worldToScreen(x, y);
    const el = document.createElement('div');
    el.className = 'dmg-number';
    el.textContent = `-${Math.round(damage)}`;
    el.style.left = (sx - 20) + 'px';
    el.style.top = (sy - 20) + 'px';
    document.getElementById('screen-game').appendChild(el);
    setTimeout(() => el.remove(), 800);
  }

  function _renderDamageNumbers() {
    // Handled via DOM for simplicity
  }

  // ─── HUD ───
  function _updateHUD() {
    if (players.length < 1) return;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const side = i === 0 ? 'p1' : 'p2';
      const pct = p.hp / p.maxHP;

      const hpBar = document.getElementById(`hp-bar-${side}`);
      const hpText = document.getElementById(`hp-text-${side}`);
      const stocks = document.getElementById(`stocks-${side}`);

      if (hpBar) {
        hpBar.style.width = (pct * 100) + '%';
        hpBar.className = 'hp-bar' + (pct > 0.5 ? '' : pct > 0.25 ? ' yellow' : ' red');
      }
      if (hpText) {
        hpText.textContent = `${Math.max(0, Math.round(p.hp))} / ${p.maxHP}`;
      }
      if (stocks) {
        stocks.innerHTML = '';
        for (let s = 0; s < 3; s++) {
          const dot = document.createElement('div');
          dot.className = 'stock-icon' + (s < p.stocks ? '' : ' lost');
          stocks.appendChild(dot);
        }
      }
    }
  }

  function _updateHUDTimer() {
    const el = document.getElementById('timer-display');
    if (!el) return;
    const m = Math.floor(matchTimer / 60);
    const s = matchTimer % 60;
    el.textContent = `${m}:${s.toString().padStart(2,'0')}`;
    el.className = 'timer-display' + (matchTimer < 30 ? ' low' : '');
  }

  function _showKillFeed(killer, victim) {
    UI.toast(`${killer.playerName} KO'd ${victim.playerName}!`, 'info');
  }

  // ─── MATCH END ───
  function _handleTimeOut() {
    if (gameOver) return;
    // Most stocks wins; tie = draw
    const sorted = [...players].sort((a, b) =>
      b.stocks !== a.stocks ? b.stocks - a.stocks : b.hp - a.hp
    );
    const winner = sorted[0];
    const isTie = sorted.length > 1 && sorted[0].stocks === sorted[1].stocks && Math.abs(sorted[0].hp - sorted[1].hp) < 0.1;
    _endMatch(isTie ? null : winner);
  }

  function _checkMatchEnd() {
    const alive = players.filter(p => p.stocks > 0);
    if (alive.length <= 1) {
      _endMatch(alive[0] ?? null);
    }
  }

  function _endMatch(winner) {
    if (gameOver) return;
    gameOver = true;
    running = false;
    clearInterval(matchTimerInterval);

    const isLocalWinner = winner?.peerId === Network.getMyId();
    const result = winner
      ? (isLocalWinner ? 'win' : 'loss')
      : 'draw';

    StatsSystem.endSession(result);

    if (Network.getIsHost()) {
      Network.sendMatchEnd({
        winnerPeerId: winner?.peerId ?? null,
        result,
      });
    }

    UI.showMatchResult({
      winner,
      result,
      localPlayer,
      players,
    });
  }

  // ─── NETWORK SYNC ───
  let _syncTimer = 0;
  function _syncNetwork() {
    _syncTimer++;
    if (_syncTimer < 3) return; // sync every 3 frames (20 times/sec)
    _syncTimer = 0;
    if (localPlayer) {
      Network.sendGameInput({
        x: localPlayer.x, y: localPlayer.y,
        vx: localPlayer.vx, vy: localPlayer.vy,
        state: localPlayer.state,
        facingRight: localPlayer.facingRight,
        hitboxActive: localPlayer.hitboxActive,
        dirX: 0, dirY: 0,
        attackJust: false, specialJust: false, grabJust: false,
      });
    }
  }

  Network.on('matchEnd', ({ winnerPeerId, result }) => {
    if (gameOver) return;
    const winner = players.find(p => p.peerId === winnerPeerId);
    gameOver = true;
    running = false;
    clearInterval(matchTimerInterval);
    const localResult = winnerPeerId === Network.getMyId() ? 'win' : (result === 'draw' ? 'draw' : 'loss');
    StatsSystem.endSession(localResult);
    UI.showMatchResult({ winner, result: localResult, localPlayer, players });
  });

  function stopMatch() {
    running = false;
    gameOver = true;
    clearInterval(matchTimerInterval);
  }

  return {
    init, startMatch, stopMatch,
    worldToScreen, screenToWorld,
    spawnProjectile,
    getPlayers: () => players,
    getMap: () => map,
  };
})();

window.Engine = Engine;
