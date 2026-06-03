// ═══════════════════════════════════════════════════════════
//  CHARACTER BASE CLASS  — BrawlForge
//
//  All characters must extend CharacterBase and implement:
//    - defineStats()     → return stat object
//    - defineAbilities() → return ability map
//    - render(ctx)       → draw character on canvas
//    - renderEffect(ctx) → optional particle effects
//
//  Abilities use a directional smash-style system:
//    jab, ftilt, utilt, dtilt,
//    fsmash, usmash, dsmash,
//    nair, fair, bair, uair, dair,
//    nspecial, fspecial, uspecial, dspecial,
//    grab, pummel, fthrow, bthrow, uthrow, dthrow,
//    dodge (ground), airdodge
// ═══════════════════════════════════════════════════════════

class CharacterBase {
  constructor(config = {}) {
    // Identity
    this.id = config.id || 'unknown';
    this.displayName = config.displayName || 'Fighter';
    this.emoji = config.emoji || '🥊';
    this.colorPrimary = config.colorPrimary || '#4444ff';
    this.colorSecondary = config.colorSecondary || '#aaaaff';
    this.description = config.description || '';
    this.archetype = config.archetype || 'Balanced'; // Balanced | Rushdown | Zoner | Grappler | Brawler

    // Base stats (overridden by defineStats)
    const baseStats = this.defineStats();
    this.maxHP = baseStats.maxHP ?? 100;
    this.hp = this.maxHP;
    this.weight = baseStats.weight ?? 1.0;       // affects knockback taken
    this.walkSpeed = baseStats.walkSpeed ?? 3.5;
    this.runSpeed = baseStats.runSpeed ?? 6.0;
    this.airSpeed = baseStats.airSpeed ?? 4.5;
    this.fallSpeed = baseStats.fallSpeed ?? 8.0;
    this.fastFallSpeed = baseStats.fastFallSpeed ?? 14.0;
    this.jumpForce = baseStats.jumpForce ?? -19;
    this.doubleJumpForce = baseStats.doubleJumpForce ?? -16;
    this.airJumps = baseStats.airJumps ?? 1;
    this.traction = baseStats.traction ?? 0.85;   // ground friction multiplier
    this.airResistance = baseStats.airResistance ?? 0.95;
    this.size = baseStats.size ?? { w: 40, h: 60 }; // collision box

    // Runtime state
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.facingRight = true;
    this.onGround = false;
    this.airJumpsLeft = this.airJumps;
    this.stocks = 3;
    this.playerIndex = 0; // 0 or 1
    this.peerId = null;

    // State machine
    // idle | walk | run | jumpsquat | jump | fall | land
    // attack | hitstun | knockback | dodge | airdodge | dead
    this.state = 'idle';
    this.stateTimer = 0;
    this.attackTimer = 0;
    this.hitboxActive = false;
    this.currentAttack = null;
    this.hitlag = 0;          // freeze frames on hit
    this.hitstun = 0;
    this.invincible = false;
    this.invincibleTimer = 0;
    this.grabbing = null;     // ref to grabbed opponent
    this.grabbedBy = null;
    this.shielding = false;
    this.shieldHP = 100;
    this.shieldRecharging = false;

    // Input buffer
    this.inputBuffer = [];
    this.heldInputs = {};
    this.lastDirInput = { x: 0, y: 0 };

    // Abilities
    this.abilities = this.defineAbilities();
    this.cooldowns = {};
    for (const name of Object.keys(this.abilities)) {
      this.cooldowns[name] = 0;
    }

    // Particles / effects
    this.effects = [];

    // Stats tracking
    this.damageDealt = 0;
    this.damageTaken = 0;
    this.kills = 0;

    // Status effects
    this.burnTimer   = 0;    // frames remaining on burn
    this.burnDamage  = 0.4;  // HP per frame while burning
    this.burnTraction = 0;   // traction penalty while burning

    // Animation state
    this.animFrame = 0;
    this.animTimer = 0;
    this.landLag = 0;
  }

  // ─── MUST OVERRIDE ───
  defineStats() { return {}; }
  defineAbilities() { return {}; }
  render(ctx) {
    // Default capsule rendering — replaced by PNG when available
    const { w, h } = this.size;
    ctx.save();
    ctx.translate(this.x, this.y);
    if (!this.facingRight) ctx.scale(-1, 1);

    // Body
    ctx.fillStyle = this.colorPrimary;
    ctx.strokeStyle = this.colorSecondary;
    ctx.lineWidth = 2;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.ellipse(0, h/2 + 2, w*0.4, 6, 0, 0, Math.PI*2);
    ctx.fill();

    // Torso
    ctx.fillStyle = this.colorPrimary;
    this._roundRect(ctx, -w/2, -h/2, w, h * 0.65, 8);
    ctx.fill();
    ctx.stroke();

    // Head
    ctx.fillStyle = this.colorSecondary;
    ctx.beginPath();
    ctx.arc(0, -h/2 - 14, 14, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();

    // Eye
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(5, -h/2 - 15, 4, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(6, -h/2 - 15, 2, 0, Math.PI*2);
    ctx.fill();

    // Legs
    ctx.fillStyle = this.colorPrimary;
    ctx.fillRect(-w/2 + 4, h/2 - 20, 10, 20);
    ctx.fillRect(w/2 - 14, h/2 - 20, 10, 20);

    // Attack flash
    if (this.hitboxActive) {
      ctx.fillStyle = 'rgba(255,200,0,0.3)';
      ctx.beginPath();
      ctx.arc(this.facingRight ? w*0.6 : -w*0.6, 0, 20, 0, Math.PI*2);
      ctx.fill();
    }

    // Invincibility flash
    if (this.invincible) {
      ctx.globalAlpha = (Math.sin(Date.now() * 0.05) + 1) * 0.3;
      ctx.fillStyle = '#fff';
      this._roundRect(ctx, -w/2, -h/2, w, h, 8);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // Hitbox debug (uncomment to debug)
    // this._drawHitbox(ctx);
  }

  renderEffect(ctx) {
    // Render particle effects
    for (const e of this.effects) {
      ctx.save();
      ctx.globalAlpha = e.alpha;
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ─── PHYSICS UPDATE ───
  physicsUpdate(map) {
    if (this.state === 'dead') return;
    if (this.hitlag > 0) { this.hitlag--; return; }

    // Stronger gravity = snappier jumps, less floaty
    const gravity = (map.gravity ?? 0.72) * 1.35;
    const maxFall = this.fastFalling ? this.fastFallSpeed : this.fallSpeed;
    if (!this.onGround) {
      this.vy = Math.min(this.vy + gravity, maxFall);
    }

    this.x += this.vx;
    this.y += this.vy;

    // Ground friction — handled in move(); only apply passive decel here when not moving
    if (this.onGround) {
      if (this.state === 'idle' || this.state === 'land') {
        // Burn reduces traction (slippery while on fire)
        const frictionMul = this.burnTimer > 0 ? 0.82 : 0.55;
        this.vx *= frictionMul;
        if (Math.abs(this.vx) < 0.3) this.vx = 0;
      }
    } else {
      this.vx *= 0.98;
    }

    // Platform collision
    this.onGround = false;
    for (const plat of map.platforms) {
      const hw = this.size.w / 2;
      const hh = this.size.h / 2;
      // Only collide from above (soft platforms)
      if (
        this.x + hw > plat.x &&
        this.x - hw < plat.x + plat.w &&
        this.y + hh >= plat.y &&
        this.y + hh - this.vy <= plat.y + 4 &&
        this.vy >= 0 &&
        !this.droppingThrough
      ) {
        this.y = plat.y - hh;
        this.vy = 0;
        this.onGround = true;
        this.airJumpsLeft = this.airJumps;
        this.fastFalling = false;
        if (this.state === 'fall' || this.state === 'jump') {
          this.setState('land');
          this.landLag = 4;
        }
        break;
      }
      // Solid block collision from sides/bottom
      if (plat.solid) {
        if (
          this.x + hw > plat.x && this.x - hw < plat.x + plat.w &&
          this.y + hh > plat.y && this.y - hh < plat.y + plat.h
        ) {
          // Resolve: find minimum overlap axis
          const overlapLeft  = (this.x + hw) - plat.x;
          const overlapRight = (plat.x + plat.w) - (this.x - hw);
          const overlapTop   = (this.y + hh) - plat.y;
          const overlapBot   = (plat.y + plat.h) - (this.y - hh);
          const minOverlap   = Math.min(overlapLeft, overlapRight, overlapTop, overlapBot);
          if (minOverlap === overlapTop && this.vy >= 0) {
            this.y = plat.y - hh;
            this.vy = 0; this.onGround = true;
            this.airJumpsLeft = this.airJumps;
            this.fastFalling = false;
          } else if (minOverlap === overlapBot && this.vy < 0) {
            this.y = plat.y + plat.h + hh;
            this.vy = 0;
          } else if (minOverlap === overlapLeft) {
            this.x = plat.x - hw; this.vx = 0;
          } else if (minOverlap === overlapRight) {
            this.x = plat.x + plat.w + hw; this.vx = 0;
          }
        }
      }
    }

    // State timers
    this.stateTimer--;
    if (this.hitstun > 0) this.hitstun--;

    // ── BURN STATUS ──
    if (this.burnTimer > 0) {
      this.burnTimer--;
      this.hp = Math.max(0.1, this.hp - this.burnDamage);
      // Orange fire flicker every 8 frames
      if (this.burnTimer % 8 === 0) this.spawnParticles(this.x, this.y - 20, this.burnTimer % 16 < 8 ? '#ff6600' : '#ffcc00', 3, 2);
      if (this.burnTimer <= 0) this.burnTraction = 0;
    }
    if (this.landLag > 0) {
      this.landLag--;
      if (this.landLag <= 0 && this.state === 'land') this.setState('idle');
    }
    if (this.attackTimer > 0) {
      this.attackTimer--;
      if (this.attackTimer <= 0) {
        this.hitboxActive = false;
        this.currentAttack = null;
        if (this.state === 'attack') this.setState(this.onGround ? 'idle' : 'fall');
      }
    }
    if (this.invincibleTimer > 0) {
      this.invincibleTimer--;
      if (this.invincibleTimer <= 0) this.invincible = false;
    }

    // Cooldowns
    for (const name in this.cooldowns) {
      if (this.cooldowns[name] > 0) this.cooldowns[name]--;
    }

    // Shield recharge
    if (!this.shielding && this.shieldHP < 100) {
      this.shieldHP = Math.min(100, this.shieldHP + 0.4);
    }
    if (this.shieldHP <= 0) {
      this.shieldRecharging = true;
      this.shielding = false;
    }
    if (this.shieldRecharging && this.shieldHP >= 30) {
      this.shieldRecharging = false;
    }

    // Effects
    this.effects = this.effects.filter(e => {
      e.x += e.vx; e.y += e.vy;
      e.alpha -= e.fadeSpeed;
      e.r += e.growSpeed ?? 0;
      return e.alpha > 0;
    });

    // Fall state
    if (!this.onGround && this.state !== 'jump' && this.state !== 'attack' &&
        this.state !== 'hitstun' && this.state !== 'airdodge' && this.vy > 0) {
      this.setState('fall');
    }

    // Animate
    this.animTimer++;
    if (this.animTimer > 8) { this.animTimer = 0; this.animFrame++; }
  }

  // ─── STATE MACHINE ───
  setState(newState) {
    if (this.state === newState) return;
    this.state = newState;
    this.stateTimer = 0;
  }

  canAct() {
    return this.hitstun <= 0 && this.attackTimer <= 0 &&
      this.state !== 'dead' && this.hitlag <= 0 &&
      this.state !== 'airdodge';
  }

  canAttack() {
    return this.canAct() && !this.shielding;
  }

  // ─── ACTIONS ───
  jump() {
    // Allow cancelling fspecial dash into jump
    if (this._cancelIntoJump && this.state === 'attack') {
      this._cancelIntoJump = false;
      this.attackTimer = 0;
      this.hitboxActive = false;
      this.currentAttack = null;
      this.setState('jump');
      this.vy = this.jumpForce;
      this.onGround = false;
      this.spawnParticles(this.x, this.y + this.size.h/2, '#ffaa44', 5, 3);
      return true;
    }
    if (!this.canAct()) return false;
    if (this.onGround) {
      this.vy = this.jumpForce;
      this.onGround = false;
      this.setState('jump');
      return true;
    } else if (this.airJumpsLeft > 0) {
      this.airJumpsLeft--;
      this.vy = this.doubleJumpForce;
      this.setState('jump');
      this.spawnParticles(this.x, this.y + this.size.h/2, '#aaddff', 6, 2);
      return true;
    }
    return false;
  }

  fastFall() {
    if (!this.onGround && this.vy > 0) {
      this.fastFalling = true;
    }
  }

  move(dir) {
    if (!this.canAct()) return;
    if (Math.abs(dir) > 0.1) this.facingRight = dir > 0;

    if (this.onGround) {
      if (Math.abs(dir) > 0.1) {
        // Quick acceleration — feels snappy, not icy
        this.vx += dir * this.runSpeed * 0.7;
        this.vx = Math.max(-this.runSpeed, Math.min(this.runSpeed, this.vx));
        if (this.state !== 'attack') this.setState('run');
      } else {
        // Hard stop on no input — no sliding
        this.vx *= 0.55;
        if (Math.abs(this.vx) < 0.5) this.vx = 0;
        if (this.state !== 'attack' && this.state !== 'land') this.setState('idle');
      }
    } else {
      // Air: moderate directional control
      if (Math.abs(dir) > 0.1) {
        this.vx += dir * this.airSpeed * 0.18;
        this.vx = Math.max(-this.airSpeed, Math.min(this.airSpeed, this.vx));
      }
    }
  }

  shield(active) {
    if (this.state === 'dead') return;
    if (this.shieldRecharging) { this.shielding = false; return; }
    if (active && this.canAct()) {
      this.shielding = true;
      this.setState('idle');
    } else {
      this.shielding = false;
    }
  }

  dropThrough() {
    this.droppingThrough = true;
    setTimeout(() => this.droppingThrough = false, 200);
  }

  // ─── ATTACK DISPATCH ───
  // attackType: one of the ability names
  doAttack(attackType, dirX = 0, dirY = 0) {
    if (!this.canAttack()) return false;
    if (this.cooldowns[attackType] > 0) return false;

    const ability = this.abilities[attackType];
    if (!ability) return false;

    this.currentAttack = { type: attackType, ...ability, dirX, dirY };
    this.state = 'attack';
    this.attackTimer = ability.duration ?? 20;
    this.hitboxActive = false; // enabled mid-animation
    this.hitlag = 0;

    // Hitbox activates after startup frames
    const startup = ability.startup ?? 6;
    setTimeout(() => {
      if (this.currentAttack?.type === attackType) {
        this.hitboxActive = true;
        // Auto-deactivate after active frames
        setTimeout(() => { this.hitboxActive = false; }, (ability.active ?? 6) * 16);
      }
    }, startup * 16);

    // Cooldown
    if (ability.cooldown) this.cooldowns[attackType] = ability.cooldown;

    // Optional: apply move-forward on attack
    if (ability.moveForward && this.onGround) {
      this.vx += (this.facingRight ? 1 : -1) * (ability.moveForward ?? 2);
    }

    // Recovery special: burst upward and reset air jump
    if (ability.isRecovery) {
      this.vy = ability.recoveryVY ?? -20;
      this.vx = (this.facingRight ? 1 : -1) * (ability.recoveryVX ?? 0);
      this.onGround = false;
      this.airJumpsLeft = this.airJumps; // restore air jump so you always get height
      if (ability.invincibleStartup) { this.invincible = true; this.invincibleTimer = (ability.startup ?? 4) + 6; }
    }

    // cancelIntoJump: allow jump to interrupt the attack mid-duration
    if (ability.cancelIntoJump) {
      this._cancelIntoJump = true;
      setTimeout(() => { this._cancelIntoJump = false; }, (ability.duration ?? 20) * 16);
    }

    // Visual effect
    if (ability.effect) this.triggerEffect(ability.effect);

    // Stats
    StatsSystem.recordAbilityUse(attackType);

    return true;
  }

  dodge(dirX = 0) {
    if (!this.canAct()) return false;
    this.setState('dodge');
    this.invincible = true;
    this.invincibleTimer = 22;
    if (dirX !== 0) {
      this.vx = (dirX > 0 ? 1 : -1) * this.runSpeed * 1.4;
    }
    setTimeout(() => {
      if (this.state === 'dodge') this.setState('idle');
    }, 400);
    return true;
  }

  airDodge(dirX, dirY) {
    if (!this.canAct() || this.onGround) return false;
    this.setState('airdodge');
    this.invincible = true;
    this.invincibleTimer = 25;
    const spd = 8;
    const len = Math.sqrt(dirX*dirX + dirY*dirY) || 1;
    this.vx = (dirX/len) * spd;
    this.vy = (dirY/len) * spd;
    setTimeout(() => {
      if (this.state === 'airdodge') this.setState('fall');
    }, 500);
    return true;
  }

  // ─── HIT DETECTION (called by engine) ───
  getHitbox() {
    if (!this.hitboxActive || !this.currentAttack) return null;
    const attack = this.currentAttack;
    const dir = this.facingRight ? 1 : -1;
    const ox = attack.offsetX ?? this.size.w * 0.7;
    const oy = attack.offsetY ?? 0;
    return {
      x: this.x + dir * ox,
      y: this.y + oy,
      r: attack.radius ?? 22,
      damage: attack.damage ?? 8,
      knockbackX: (attack.knockbackX ?? 6) * dir,
      knockbackY: attack.knockbackY ?? -8,
      hitstun: attack.hitstun ?? 20,
      attackType: attack.type,
      attackerId: this.peerId,
    };
  }

  getHurtbox() {
    // Main body hurtbox
    return {
      x: this.x, y: this.y,
      w: this.size.w, h: this.size.h,
    };
  }

  // ─── TAKE HIT ───
  takeHit(hitData) {
    if (this.invincible || this.state === 'dead') return false;
    if (this.shielding) {
      // Blocked by shield
      this.shieldHP -= hitData.damage * 0.7;
      this.hitlag = 8;
      this.spawnParticles(this.x, this.y, '#88ccff', 4, 3);
      return false; // not a true hit
    }

    const dmg = hitData.damage;
    this.hp = Math.max(0, this.hp - dmg);
    this.damageTaken += dmg;
    StatsSystem.recordDamageTaken(dmg);

    // Knockback scales with how much damage the defender has accumulated
    // At 0% damage: base knockback. At 100% damage taken: ~2.5x knockback.
    const dmgRatio = 1 - (this.hp / this.maxHP);           // 0 (fresh) → 1 (near dead)
    const kbScale  = 1 + dmgRatio * 2.2;                   // 1.0 → 3.2x
    const kbX = hitData.knockbackX * kbScale / this.weight;
    const kbY = hitData.knockbackY * kbScale / this.weight;
    this.vx = kbX;
    this.vy = kbY;

    this.hitstun = Math.round(hitData.hitstun * kbScale);
    this.hitlag = 6;
    this.setState('hitstun');
    this.shielding = false;
    this.onGround = false;

    // Flash red effect
    this.spawnParticles(this.x, this.y, '#ff4444', 8, 4);

    // Status effect application
    if (hitData.applyStatus === 'burn') {
      this.burnTimer = 180;  // 3 seconds at 60fps
      this.spawnParticles(this.x, this.y, '#ff6600', 10, 5);
    }

    return true; // hit landed
  }

  // ─── DEATH ───
  die() {
    this.stocks--;
    this.setState('dead');
    this.hitboxActive = false;
    this.spawnParticles(this.x, this.y, this.colorPrimary, 16, 6);
    StatsSystem.recordDeath();

    if (this.stocks > 0) {
      // Respawn after delay
      setTimeout(() => this.respawn(), 2000);
    }
  }

  respawn(spawnX, spawnY) {
    this.hp = this.maxHP;
    this.vx = 0; this.vy = 0;
    this.x = spawnX ?? this.spawnX ?? 400;
    this.y = spawnY ?? this.spawnY ?? 100;
    this.setState('fall');
    this.invincible = true;
    this.invincibleTimer = 120;
    this.shieldHP = 100;
    this.hitboxActive = false;
    this.currentAttack = null;
    this.grabbing = null;
    this.grabbedBy = null;
  }

  // ─── PARTICLES ───
  spawnParticles(x, y, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 / count) * i + Math.random() * 0.5;
      this.effects.push({
        x, y,
        vx: Math.cos(angle) * speed * (0.5 + Math.random()),
        vy: Math.sin(angle) * speed * (0.5 + Math.random()),
        r: 4 + Math.random() * 4,
        color,
        alpha: 1,
        fadeSpeed: 0.04,
        growSpeed: -0.1,
      });
    }
  }

  triggerEffect(effectName) {
    // Override in subclass for custom effects
  }

  // ─── SERIALIZATION (for network) ───
  serialize() {
    return {
      x: Math.round(this.x * 10) / 10,
      y: Math.round(this.y * 10) / 10,
      vx: Math.round(this.vx * 100) / 100,
      vy: Math.round(this.vy * 100) / 100,
      hp: this.hp,
      stocks: this.stocks,
      state: this.state,
      facingRight: this.facingRight,
      hitboxActive: this.hitboxActive,
    };
  }

  applySnapshot(data) {
    // Smooth interpolation for remote players
    this.x += (data.x - this.x) * 0.3;
    this.y += (data.y - this.y) * 0.3;
    this.vx = data.vx;
    this.vy = data.vy;
    this.hp = data.hp;
    this.stocks = data.stocks;
    this.state = data.state;
    this.facingRight = data.facingRight;
    this.hitboxActive = data.hitboxActive;
  }
}

window.CharacterBase = CharacterBase;
// ═══════════════════════════════════════════════════════════
//  CHARACTER: IRON KNIGHT
//  Archetype: Balanced / Brawler
//  A classic armored knight. Solid ground game, powerful
//  sword attacks with good range. Moderate speed.
// ═══════════════════════════════════════════════════════════

class IronKnight extends CharacterBase {
  constructor(config = {}) {
    super({
      id: 'iron_knight',
      displayName: 'Iron Knight',
      emoji: '⚔️',
      colorPrimary: '#4a7abf',
      colorSecondary: '#c8d8f0',
      description: 'A stalwart warrior with powerful sword strikes and sturdy armor. Strong grounded combos, reliable recovery.',
      archetype: 'Balanced',
      ...config,
    });

    this._swordAngle = 0;
    this._armorGlow = 0;
    this._shieldVisible = false;
  }

  defineStats() {
    return {
      maxHP: 110,
      weight: 1.1,
      walkSpeed: 3.2,
      runSpeed: 5.8,
      airSpeed: 4.2,
      fallSpeed: 8.5,
      fastFallSpeed: 13,
      jumpForce: -18.5,
      doubleJumpForce: -15.5,
      airJumps: 1,
      traction: 0.87,
      airResistance: 0.94,
      size: { w: 44, h: 64 },
    };
  }

  defineAbilities() {
    return {
      // ── JABS ──
      jab: {
        name: 'Quick Slash', desc: 'Fast jab with sword pommel.',
        damage: 5, startup: 3, active: 5, duration: 18,
        knockbackX: 3, knockbackY: -2, hitstun: 12,
        radius: 24, offsetX: 28, offsetY: -10,
        cooldown: 0,
      },
      jab2: {
        name: 'Cross Slash', desc: 'Follow-up horizontal cut.',
        damage: 6, startup: 4, active: 5, duration: 20,
        knockbackX: 4, knockbackY: -3, hitstun: 14,
        radius: 28, offsetX: 32, offsetY: 0,
        cooldown: 0,
      },
      jab3: {
        name: 'Finish Thrust', desc: 'Lunging stab finisher.',
        damage: 9, startup: 5, active: 6, duration: 28,
        knockbackX: 7, knockbackY: -5, hitstun: 18,
        radius: 22, offsetX: 40, offsetY: 5,
        cooldown: 0, moveForward: 3,
      },

      // ── TILTS ──
      ftilt: {
        name: 'Sword Poke', desc: 'Quick forward stab at mid-range.',
        damage: 9, startup: 6, active: 6, duration: 26,
        knockbackX: 5, knockbackY: -4, hitstun: 15,
        radius: 26, offsetX: 38, offsetY: -5,
        cooldown: 12,
      },
      utilt: {
        name: 'Rising Slash', desc: 'Upward arcing sword swing.',
        damage: 8, startup: 5, active: 7, duration: 24,
        knockbackX: 1, knockbackY: -12, hitstun: 16,
        radius: 26, offsetX: 10, offsetY: -40,
        cooldown: 10,
      },
      dtilt: {
        name: 'Low Sweep', desc: 'Crouching low sword sweep. Can trip.',
        damage: 7, startup: 5, active: 6, duration: 22,
        knockbackX: 4, knockbackY: 2, hitstun: 14,
        radius: 28, offsetX: 30, offsetY: 20,
        cooldown: 12,
      },

      // ── SMASH ATTACKS ──
      fsmash: {
        name: 'Overhead Cleave', desc: 'Powerful overhead sword slam. High damage, high knockback.',
        damage: 22, startup: 14, active: 6, duration: 46,
        knockbackX: 12, knockbackY: -8, hitstun: 30,
        radius: 34, offsetX: 40, offsetY: -10,
        cooldown: 28, moveForward: 2,
      },
      usmash: {
        name: 'Heaven Split', desc: 'Slow but devastating upward slash.',
        damage: 20, startup: 16, active: 7, duration: 50,
        knockbackX: 2, knockbackY: -18, hitstun: 32,
        radius: 32, offsetX: 8, offsetY: -50,
        cooldown: 30,
      },
      dsmash: {
        name: 'Ground Slam', desc: 'Slams sword into ground, hits both sides.',
        damage: 18, startup: 12, active: 8, duration: 44,
        knockbackX: 8, knockbackY: 0, hitstun: 26,
        radius: 40, offsetX: 0, offsetY: 20,
        cooldown: 25,
      },

      // ── AERIALS ──
      nair: {
        name: 'Spin Cut', desc: 'Spinning sword slash. Multi-hit.',
        damage: 10, startup: 5, active: 10, duration: 28,
        knockbackX: 3, knockbackY: -5, hitstun: 16,
        radius: 32, offsetX: 0, offsetY: 0,
        cooldown: 6,
      },
      fair: {
        name: 'Forward Slash', desc: 'Forward diagonal slash. Good for edgeguarding.',
        damage: 12, startup: 8, active: 7, duration: 30,
        knockbackX: 8, knockbackY: -4, hitstun: 20,
        radius: 28, offsetX: 36, offsetY: -10,
        cooldown: 10,
      },
      bair: {
        name: 'Back Kick', desc: 'Backward boot kick. Fast and strong.',
        damage: 13, startup: 6, active: 6, duration: 26,
        knockbackX: -9, knockbackY: -3, hitstun: 18,
        radius: 24, offsetX: -36, offsetY: 5,
        cooldown: 10,
      },
      uair: {
        name: 'Sky Slash', desc: 'Upward flip slash. Juggle tool.',
        damage: 11, startup: 7, active: 8, duration: 28,
        knockbackX: 1, knockbackY: -14, hitstun: 20,
        radius: 26, offsetX: 5, offsetY: -45,
        cooldown: 8,
      },
      dair: {
        name: 'Dive Stab', desc: 'Downward spike. Spikes opponents below.',
        damage: 14, startup: 10, active: 6, duration: 32,
        knockbackX: 2, knockbackY: 12, hitstun: 22,
        radius: 22, offsetX: 0, offsetY: 44,
        cooldown: 14,
      },

      // ── SPECIALS ──
      nspecial: {
        name: 'Sword Beam', desc: 'Fires a projectile slash wave at full HP.',
        damage: 12, startup: 16, active: 3, duration: 36,
        knockbackX: 6, knockbackY: -3, hitstun: 18,
        radius: 18, offsetX: 50, offsetY: -5,
        cooldown: 40, isProjectile: true,
      },
      fspecial: {
        name: 'Flame Dash', desc: 'Ignites sword and dashes forward. Applies BURN status on hit — 3s of ticking fire damage and reduced traction. Can cancel into jump mid-dash for movement tech.',
        damage: 10, startup: 6, active: 16, duration: 36,
        knockbackX: 6, knockbackY: -3, hitstun: 14,
        radius: 28, offsetX: 26, offsetY: 0,
        cooldown: 55, moveForward: 14,
        applyStatus: 'burn',   // engine applies burn status to defender
        effect: 'flameDash',
        cancelIntoJump: true,  // engine allows jump input to cancel mid-dash
      },
      uspecial: {
        name: 'Rising Knight', desc: 'Recovery uppercut. Launches Knight straight up with invincible startup. Resets air jump. Strong vertical knockback on hit.',
        damage: 14, startup: 4, active: 20, duration: 50,
        knockbackX: 2, knockbackY: -18, hitstun: 28,
        radius: 30, offsetX: 0, offsetY: -36,
        cooldown: 90,
        isRecovery: true,      // engine applies special vertical launch + resets airJumpsLeft
        recoveryVY: -22,       // strong upward burst
        recoveryVX: 0,         // no horizontal drift (pure vertical)
        invincibleStartup: true,
        effect: 'risingKnight',
      },
      dspecial: {
        name: 'Shield Bash', desc: 'Counter move. If hit during startup, reflects and strikes back.',
        damage: 18, startup: 10, active: 6, duration: 40,
        knockbackX: 10, knockbackY: -8, hitstun: 28,
        radius: 30, offsetX: 20, offsetY: 0,
        cooldown: 60, isCounter: true,
      },

      // ── GRABS ──
      grab: {
        name: 'Grab', desc: 'Grabs the opponent.',
        damage: 0, startup: 6, active: 4, duration: 22,
        radius: 32, offsetX: 34, offsetY: 0,
        cooldown: 20, isGrab: true,
      },
      pummel: {
        name: 'Pommel Strike', desc: 'Hits grabbed opponent.',
        damage: 4, startup: 2, active: 2, duration: 16,
        knockbackX: 0, knockbackY: 0, hitstun: 6,
        radius: 30, offsetX: 20, offsetY: 0,
        cooldown: 0,
      },
      fthrow: {
        name: 'Toss Forward', desc: 'Throws opponent forward.',
        damage: 10, startup: 2, active: 2, duration: 14,
        knockbackX: 10, knockbackY: -4, hitstun: 20,
        radius: 30, offsetX: 40, offsetY: 0,
        cooldown: 0, isThrow: true,
      },
      bthrow: {
        name: 'Behind Toss', desc: 'Spins and throws backward.',
        damage: 11, startup: 4, active: 2, duration: 18,
        knockbackX: -11, knockbackY: -4, hitstun: 20,
        radius: 30, offsetX: -40, offsetY: 0,
        cooldown: 0, isThrow: true,
      },
      uthrow: {
        name: 'Upward Fling', desc: 'Throws opponent upward. Set up for aerials.',
        damage: 8, startup: 3, active: 2, duration: 16,
        knockbackX: 1, knockbackY: -14, hitstun: 18,
        radius: 30, offsetX: 0, offsetY: -30,
        cooldown: 0, isThrow: true,
      },
      dthrow: {
        name: 'Ground Slam', desc: 'Slams opponent into ground.',
        damage: 12, startup: 4, active: 2, duration: 20,
        knockbackX: 3, knockbackY: -8, hitstun: 22,
        radius: 30, offsetX: 0, offsetY: 30,
        cooldown: 0, isThrow: true,
      },
    };
  }

  // ─── CUSTOM RENDER ───
  render(ctx) {
    const { w, h } = this.size;
    ctx.save();
    ctx.translate(this.x, this.y);
    const flip = this.facingRight ? 1 : -1;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, h/2 + 2, w*0.4, 6, 0, 0, Math.PI*2);
    ctx.fill();

    ctx.scale(flip, 1);

    // Animate based on state
    let bobY = 0, lean = 0;
    if (this.state === 'run') {
      bobY = Math.sin(this.animFrame * 0.8) * 3;
    } else if (this.state === 'idle') {
      bobY = Math.sin(this.animFrame * 0.3) * 1.5;
    }

    ctx.translate(0, bobY);

    // Legs
    const legSwing = this.state === 'run' ? Math.sin(this.animFrame * 0.8) * 12 : 0;
    ctx.fillStyle = '#2a4a7a';
    // Left leg
    ctx.save();
    ctx.translate(-10, h/2 - 16);
    ctx.rotate((-legSwing * Math.PI) / 180);
    ctx.fillRect(-6, 0, 12, 22);
    // Boot
    ctx.fillStyle = '#1a2a40';
    ctx.fillRect(-8, 18, 16, 8);
    ctx.restore();
    // Right leg
    ctx.save();
    ctx.translate(10, h/2 - 16);
    ctx.rotate((legSwing * Math.PI) / 180);
    ctx.fillRect(-6, 0, 12, 22);
    ctx.fillStyle = '#1a2a40';
    ctx.fillRect(-8, 18, 16, 8);
    ctx.restore();

    // Chest plate
    ctx.fillStyle = this.colorPrimary;
    ctx.strokeStyle = this.colorSecondary;
    ctx.lineWidth = 1.5;
    this._roundRect(ctx, -w/2 + 2, -h/2 + 16, w - 4, h * 0.55, 6);
    ctx.fill();
    ctx.stroke();

    // Armor highlight
    ctx.fillStyle = 'rgba(200,216,240,0.15)';
    this._roundRect(ctx, -w/2 + 4, -h/2 + 18, w * 0.4, h * 0.25, 4);
    ctx.fill();

    // Pauldrons (shoulder pads)
    ctx.fillStyle = '#3a6aaf';
    ctx.beginPath();
    ctx.ellipse(-w/2 + 4, -h/2 + 18, 12, 8, -0.3, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(w/2 - 4, -h/2 + 18, 12, 8, 0.3, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();

    // Helmet
    ctx.fillStyle = '#3a6aaf';
    ctx.beginPath();
    ctx.arc(0, -h/2 - 4, 18, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Visor
    ctx.fillStyle = this._armorGlow > 0 ? '#ffffaa' : '#1a3a5a';
    this._roundRect(ctx, -10, -h/2 - 4, 20, 8, 2);
    ctx.fill();

    // Eye glow if attacking
    if (this.state === 'attack') {
      ctx.fillStyle = 'rgba(255,220,0,0.8)';
      this._roundRect(ctx, -10, -h/2 - 4, 20, 8, 2);
      ctx.fill();
      this._armorGlow = 5;
    }
    if (this._armorGlow > 0) this._armorGlow--;

    // SWORD
    const swordSwing = this.state === 'attack' ? (1 - this.attackTimer / 20) * 120 - 60 : -30;
    ctx.save();
    ctx.translate(w/2 - 6, -h/2 + 22);
    ctx.rotate((swordSwing * Math.PI) / 180);

    // Blade
    ctx.fillStyle = '#d8e8ff';
    ctx.strokeStyle = '#88aacc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(4, 2);
    ctx.lineTo(6, -44);
    ctx.lineTo(0, -52);
    ctx.lineTo(-2, -44);
    ctx.lineTo(2, 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Blade shine
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.moveTo(1, -5);
    ctx.lineTo(2, -8);
    ctx.lineTo(4, -48);
    ctx.lineTo(3, -48);
    ctx.lineTo(1, -8);
    ctx.closePath();
    ctx.fill();

    // Guard
    ctx.fillStyle = '#aa8833';
    ctx.fillRect(-8, -4, 16, 5);
    ctx.fillStyle = '#ddaa44';
    ctx.fillRect(-6, -3, 12, 3);

    // Handle
    ctx.fillStyle = '#553311';
    ctx.fillRect(-3, 0, 6, 16);
    ctx.fillStyle = '#775533';
    ctx.fillRect(-2, 1, 4, 14);

    // Pommel
    ctx.fillStyle = '#aa8833';
    ctx.beginPath();
    ctx.arc(0, 18, 5, 0, Math.PI*2);
    ctx.fill();

    // Attack effect
    if (this.hitboxActive) {
      ctx.strokeStyle = 'rgba(255,220,0,0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, -26, 30, -1.2, 0.4);
      ctx.stroke();
    }
    ctx.restore();

    // Invincible shimmer
    if (this.invincible && Math.floor(Date.now() / 80) % 2 === 0) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#88ccff';
      this._roundRect(ctx, -w/2, -h/2, w, h, 8);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Hitstun red flash
    if (this.hitstun > 0 && Math.floor(this.hitstun / 3) % 2 === 0) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#ff4444';
      this._roundRect(ctx, -w/2, -h/2, w, h, 8);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Burn orange aura
    if (this.burnTimer > 0) {
      const pulse = 0.15 + 0.1 * Math.sin(Date.now() * 0.015);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#ff6600';
      this._roundRect(ctx, -w/2 - 4, -h/2 - 4, w + 8, h + 8, 10);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
    this.renderEffect(ctx);
  }

  triggerEffect(effectName) {
    if (effectName === 'swordBeam') {
      this.spawnParticles(this.x + (this.facingRight ? 60 : -60), this.y - 10, '#aaddff', 8, 5);
    }
    if (effectName === 'flameDash') {
      // Trail of orange/yellow fire particles behind the knight
      for (let i = 0; i < 7; i++) {
        const ox = (this.facingRight ? -1 : 1) * i * 9;
        this.spawnParticles(this.x + ox, this.y, i % 2 === 0 ? '#ff6600' : '#ffcc00', 3, 3);
      }
    }
    if (effectName === 'risingKnight') {
      this.spawnParticles(this.x, this.y, '#ffcc44', 16, 7);
      // Extra upward gold streak
      for (let i = 0; i < 5; i++) {
        this.effects.push({
          x: this.x + (Math.random()-0.5)*20,
          y: this.y - i * 12,
          vx: (Math.random()-0.5)*2,
          vy: -4 - Math.random()*3,
          r: 5, color: '#ffe066', alpha: 1, fadeSpeed: 0.06, growSpeed: -0.08,
        });
      }
    }
  }
}

// ─── REGISTER ───
const CHARACTER_REGISTRY = window.CHARACTER_REGISTRY || {};
CHARACTER_REGISTRY['iron_knight'] = {
  id: 'iron_knight',
  displayName: 'Iron Knight',
  emoji: '⚔️',
  archetype: 'Balanced',
  description: 'A stalwart warrior with powerful sword strikes and sturdy armor.',
  Class: IronKnight,
};
window.CHARACTER_REGISTRY = CHARACTER_REGISTRY;

// ═══════════════════════════════════════════════════════════
//  CHARACTER: SANDBAG
//  The classic training dummy. Infinite stocks, never fights
//  back, absorbs all damage to let you practice combos.
//  Select via the "Training" button in the lobby.
// ═══════════════════════════════════════════════════════════

class Sandbag extends CharacterBase {
  constructor(config = {}) {
    super({
      id: 'sandbag',
      displayName: 'Sandbag',
      emoji: '🥊',
      colorPrimary: '#c8a87a',
      colorSecondary: '#8a6a44',
      description: 'The training dummy. Never fights back. Perfect for testing combos and move feel.',
      archetype: 'Dummy',
      ...config,
    });
    this._wobble = 0;
    this._stitchPhase = 0;
  }

  defineStats() {
    return {
      maxHP: 999,
      weight: 1.8,        // heavy — doesn't fly too far
      walkSpeed: 0,
      runSpeed: 0,
      airSpeed: 0,
      fallSpeed: 10,
      fastFallSpeed: 10,
      jumpForce: 0,
      doubleJumpForce: 0,
      airJumps: 0,
      traction: 0.5,
      airResistance: 0.96,
      size: { w: 48, h: 70 },
    };
  }

  defineAbilities() { return {}; }   // no attacks

  // Sandbag never acts — override canAct to always return false
  canAct()   { return false; }
  canAttack(){ return false; }

  // Sandbag has infinite stocks — it never truly dies
  die() {
    // Reset after 1s instead of consuming a stock
    this.setState('dead');
    this.hitboxActive = false;
    this.spawnParticles(this.x, this.y, '#c8a87a', 12, 5);
    setTimeout(() => this.respawn(this.spawnX ?? 600, this.spawnY ?? 200), 1000);
  }

  render(ctx) {
    const { w, h } = this.size;
    ctx.save();
    ctx.translate(this.x, this.y);

    // Wobble when hit
    if (this._wobble > 0) {
      ctx.rotate(Math.sin(this._wobble * 0.5) * 0.12);
      this._wobble--;
    }

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, h/2 + 2, w * 0.45, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Bag body (rounded rect)
    const grad = ctx.createLinearGradient(-w/2, -h/2, w/2, h/2);
    grad.addColorStop(0, '#d4b48a');
    grad.addColorStop(0.5, '#c8a87a');
    grad.addColorStop(1, '#a88a5a');
    ctx.fillStyle = grad;
    ctx.strokeStyle = '#7a5a30';
    ctx.lineWidth = 2;
    this._roundRect(ctx, -w/2, -h/2, w, h, 12);
    ctx.fill();
    ctx.stroke();

    // Stitching lines (horizontal bands)
    ctx.strokeStyle = '#7a5a30';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    for (let i = 1; i < 4; i++) {
      const ly = -h/2 + (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(-w/2 + 6, ly);
      ctx.lineTo(w/2 - 6, ly);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Top rope/cap
    ctx.fillStyle = '#5a3a18';
    this._roundRect(ctx, -w/2 + 4, -h/2 - 6, w - 8, 14, 4);
    ctx.fill();

    // Rope knot
    ctx.fillStyle = '#3a2010';
    ctx.beginPath();
    ctx.arc(0, -h/2 - 14, 7, 0, Math.PI * 2);
    ctx.fill();

    // Burn effect
    if (this.burnTimer > 0) {
      const pulse = 0.18 + 0.08 * Math.sin(Date.now() * 0.015);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#ff6600';
      this._roundRect(ctx, -w/2 - 4, -h/2 - 4, w + 8, h + 8, 14);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Invincible flash
    if (this.invincible && Math.floor(Date.now() / 80) % 2 === 0) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#88ccff';
      this._roundRect(ctx, -w/2, -h/2, w, h, 12);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
    this.renderEffect(ctx);
  }

  // Sandbag wobbles when hit
  takeHit(hitData) {
    const result = super.takeHit(hitData);
    if (result) this._wobble = 20;
    return result;
  }
}

CHARACTER_REGISTRY['sandbag'] = {
  id: 'sandbag',
  displayName: 'Sandbag',
  emoji: '🥊',
  archetype: 'Dummy',
  description: 'Training dummy. Never attacks. Infinite stocks. Great for practicing combos.',
  Class: Sandbag,
  isSandbag: true,   // flag so UI can mark it specially
};
window.CHARACTER_REGISTRY = CHARACTER_REGISTRY;
