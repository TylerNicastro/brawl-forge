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
      jumpForce: -15.5,
      doubleJumpForce: -13,
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
        name: 'Blade Dash', desc: 'Lunging dash attack through opponents.',
        damage: 14, startup: 8, active: 14, duration: 34,
        knockbackX: 9, knockbackY: -5, hitstun: 20,
        radius: 26, offsetX: 30, offsetY: 0,
        cooldown: 50, moveForward: 12,
      },
      uspecial: {
        name: 'Rising Knight', desc: 'Upward spinning recovery move. Invincible startup.',
        damage: 16, startup: 5, active: 18, duration: 44,
        knockbackX: 3, knockbackY: -14, hitstun: 24,
        radius: 28, offsetX: 0, offsetY: -30,
        cooldown: 70,
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

    ctx.restore();
    this.renderEffect(ctx);
  }

  triggerEffect(effectName) {
    if (effectName === 'swordBeam') {
      this.spawnParticles(
        this.x + (this.facingRight ? 60 : -60),
        this.y - 10, '#aaddff', 8, 5
      );
    }
    if (effectName === 'bladeDash') {
      for (let i = 0; i < 5; i++) {
        const ox = (this.facingRight ? -1 : 1) * i * 10;
        this.spawnParticles(this.x + ox, this.y, '#4488ff', 3, 2);
      }
    }
    if (effectName === 'risingKnight') {
      this.spawnParticles(this.x, this.y, '#ffcc44', 12, 6);
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
