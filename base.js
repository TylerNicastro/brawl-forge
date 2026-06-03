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
    this.jumpForce = baseStats.jumpForce ?? -16;
    this.doubleJumpForce = baseStats.doubleJumpForce ?? -13;
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

    // Gravity
    const gravity = map.gravity ?? 0.7;
    const maxFall = this.fastFalling ? this.fastFallSpeed : this.fallSpeed;
    if (!this.onGround) {
      this.vy = Math.min(this.vy + gravity, maxFall);
    }

    // Move
    this.x += this.vx;
    this.y += this.vy;

    // Ground friction
    if (this.onGround) {
      const friction = this.state === 'run' ? 0.9 : this.traction;
      if (this.state === 'idle' || this.state === 'land') {
        this.vx *= friction;
        if (Math.abs(this.vx) < 0.1) this.vx = 0;
      }
    } else {
      this.vx *= this.airResistance;
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
    const speed = this.onGround ? this.runSpeed : this.airSpeed;
    this.vx += dir * speed * 0.25;
    this.vx = Math.max(-speed, Math.min(speed, this.vx));
    if (this.onGround && this.state !== 'attack') {
      this.setState(Math.abs(dir) > 0.1 ? 'run' : 'idle');
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

    // Scale knockback by damage and weight
    const kbScale = 1 + (this.maxHP - this.hp) / this.maxHP * 0.5;
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
