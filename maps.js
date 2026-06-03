// ═══════════════════════════════════════════════════════════
//  MAP SYSTEM  — BrawlForge
//  MapBase: extend to create new stages.
//  Platforms have: x, y, w, h, solid (bool), texture
//  Hazards: moving platforms, danger zones, etc.
// ═══════════════════════════════════════════════════════════

class MapBase {
  constructor() {
    this.id = 'unknown';
    this.displayName = 'Unknown Stage';
    this.emoji = '🏟️';
    this.description = '';
    this.preview = null; // PNG path when added

    // World size
    this.width = 1600;
    this.height = 900;

    // Physics overrides
    this.gravity = 0.72;
    this.blastZones = { left: -200, right: 1800, top: -300, bottom: 1100 };

    // Spawn points (per player slot)
    this.spawnPoints = [
      { x: 500, y: 200 },
      { x: 900, y: 200 },
      { x: 300, y: 200 },
      { x: 1100, y: 200 },
    ];

    // Platforms array (populated by subclass)
    this.platforms = [];

    // Hazards / moving elements
    this.hazards = [];

    // Background layers (parallax)
    this.bgLayers = [];
  }

  // ─── MUST OVERRIDE ───
  build() {
    // Define this.platforms, this.bgLayers, this.hazards
  }

  update(dt) {
    // Update moving platforms, hazards, etc.
    for (const h of this.hazards) {
      if (h.type === 'moving_platform') {
        h.t = (h.t ?? 0) + dt * h.speed;
        const p = this.platforms.find(p => p.id === h.platformId);
        if (p) {
          if (h.axis === 'x') {
            p.x = h.originX + Math.sin(h.t) * h.range;
          } else {
            p.y = h.originY + Math.sin(h.t) * h.range;
          }
        }
      }
    }
  }

  // ─── RENDER ───
  render(ctx, camera) {
    const { x: cx, y: cy, scale } = camera;

    // Background
    this.renderBackground(ctx, camera);

    // Platforms
    for (const plat of this.platforms) {
      this.renderPlatform(ctx, plat, cx, cy);
    }

    // Blast zone debug lines (off by default)
    // this.renderBlastZones(ctx, camera);
  }

  renderBackground(ctx, camera) {
    // Override in subclass for custom bg
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  renderPlatform(ctx, plat, cx, cy) {
    const sx = (plat.x - cx) * 1 + ctx.canvas.width / 2;
    const sy = (plat.y - cy) * 1 + ctx.canvas.height / 2;

    if (plat.solid) {
      // Solid block
      ctx.fillStyle = plat.color ?? '#3a3a5a';
      ctx.strokeStyle = plat.edgeColor ?? '#5a5a8a';
      ctx.lineWidth = 2;
      ctx.fillRect(sx, sy, plat.w, plat.h);
      ctx.strokeRect(sx, sy, plat.w, plat.h);

      // Top highlight
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(sx + 2, sy + 2, plat.w - 4, 4);
    } else {
      // Soft platform (passthrough)
      const grad = ctx.createLinearGradient(sx, sy, sx, sy + plat.h);
      grad.addColorStop(0, plat.topColor ?? '#5a8a5a');
      grad.addColorStop(1, plat.bottomColor ?? '#3a5a3a');
      ctx.fillStyle = grad;
      ctx.beginPath();
      this._roundRect(ctx, sx, sy, plat.w, plat.h, 4);
      ctx.fill();

      // Top grass/surface line
      ctx.fillStyle = plat.surfaceColor ?? '#77aa66';
      ctx.fillRect(sx, sy, plat.w, 5);

      // Edge glow
      ctx.strokeStyle = plat.glowColor ?? 'rgba(100,180,80,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      this._roundRect(ctx, sx, sy, plat.w, plat.h, 4);
      ctx.stroke();
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

  renderBlastZones(ctx, camera) {
    const { x: cx, y: cy } = camera;
    const toScreen = (wx, wy) => ({
      sx: (wx - cx) + ctx.canvas.width / 2,
      sy: (wy - cy) + ctx.canvas.height / 2,
    });
    ctx.strokeStyle = 'rgba(255,0,0,0.3)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 5]);
    const bz = this.blastZones;
    const tl = toScreen(bz.left, bz.top);
    const br = toScreen(bz.right, bz.bottom);
    ctx.strokeRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);
    ctx.setLineDash([]);
  }
}

// ═══════════════════════════════════════════════════════════
//  STAGE: PLATFORM KINGDOM
//  A classic symmetric layout with floating platforms.
//  Clear and balanced for all archetypes.
// ═══════════════════════════════════════════════════════════

class PlatformKingdom extends MapBase {
  constructor() {
    super();
    this.id = 'platform_kingdom';
    this.displayName = 'Platform Kingdom';
    this.emoji = '🏰';
    this.description = 'A majestic floating castle stage. Symmetric layout with two side platforms and one top platform.';

    this.width = 1400;
    this.height = 800;
    this.gravity = 0.72;
    this.blastZones = { left: -180, right: 1580, top: -280, bottom: 1000 };
    this.spawnPoints = [
      { x: 420, y: 320 },
      { x: 780, y: 320 },
      { x: 250, y: 180 },
      { x: 950, y: 180 },
    ];

    // Animated background elements
    this._clouds = [];
    this._stars = [];
    this._time = 0;
    this._torches = [{ x: 110, lit: 0 }, { x: 1090, lit: 0 }];

    this.build();
    this._initBg();
  }

  build() {
    // Main floor
    this.platforms = [
      {
        id: 'floor',
        x: 100, y: 520, w: 1000, h: 40,
        solid: false,
        topColor: '#5a7a3a', bottomColor: '#3a5a2a',
        surfaceColor: '#77aa55', glowColor: 'rgba(100,180,60,0.4)',
        label: 'Main Stage',
      },
      // Left side platform
      {
        id: 'plat_left',
        x: 160, y: 380, w: 220, h: 20,
        solid: false,
        topColor: '#6a5a8a', bottomColor: '#4a3a6a',
        surfaceColor: '#9a80cc', glowColor: 'rgba(150,100,220,0.4)',
      },
      // Right side platform
      {
        id: 'plat_right',
        x: 820, y: 380, w: 220, h: 20,
        solid: false,
        topColor: '#6a5a8a', bottomColor: '#4a3a6a',
        surfaceColor: '#9a80cc', glowColor: 'rgba(150,100,220,0.4)',
      },
      // Top center platform
      {
        id: 'plat_top',
        x: 465, y: 250, w: 270, h: 20,
        solid: false,
        topColor: '#8a6a3a', bottomColor: '#6a4a2a',
        surfaceColor: '#ccaa55', glowColor: 'rgba(200,160,60,0.4)',
      },
    ];

    // Moving platform hazard
    this.hazards = [
      {
        type: 'moving_platform',
        platformId: 'plat_top',
        axis: 'x',
        originX: 465,
        originY: 250,
        range: 0, // Set > 0 to make it move; 0 = static for default
        speed: 0.4,
        t: 0,
      }
    ];
  }

  _initBg() {
    // Clouds
    for (let i = 0; i < 8; i++) {
      this._clouds.push({
        x: Math.random() * 1800 - 200,
        y: Math.random() * 300 + 20,
        w: 80 + Math.random() * 140,
        h: 30 + Math.random() * 40,
        speed: 0.15 + Math.random() * 0.2,
        alpha: 0.12 + Math.random() * 0.15,
      });
    }
    // Stars
    for (let i = 0; i < 120; i++) {
      this._stars.push({
        x: Math.random() * 1800,
        y: Math.random() * 500,
        r: 0.5 + Math.random() * 1.5,
        twinkle: Math.random() * Math.PI * 2,
        speed: 0.02 + Math.random() * 0.04,
      });
    }
  }

  update(dt) {
    super.update(dt);
    this._time += dt;
    // Scroll clouds
    for (const c of this._clouds) {
      c.x += c.speed;
      if (c.x > 1800) c.x = -200;
    }
  }

  renderBackground(ctx, camera) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const cx = camera.x, cy = camera.y;

    // Sky gradient
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#08080f');
    grad.addColorStop(0.4, '#0e1030');
    grad.addColorStop(0.7, '#1a1840');
    grad.addColorStop(1, '#2a1845');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Stars (parallax 0.1)
    for (const star of this._stars) {
      const sx = ((star.x - cx * 0.08) % W + W) % W;
      const sy = star.y + cy * 0.02;
      const twinkle = 0.5 + 0.5 * Math.sin(this._time * star.speed + star.twinkle);
      ctx.globalAlpha = twinkle * 0.7;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(sx, sy, star.r, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Moon
    const moonX = W * 0.8 - cx * 0.05;
    const moonY = 80;
    const moonR = 38;
    const moonGrad = ctx.createRadialGradient(moonX - 5, moonY - 5, moonR * 0.3, moonX, moonY, moonR);
    moonGrad.addColorStop(0, '#fffdf0');
    moonGrad.addColorStop(0.6, '#f0e8d0');
    moonGrad.addColorStop(1, '#c8b880');
    ctx.fillStyle = moonGrad;
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR, 0, Math.PI*2);
    ctx.fill();
    // Craters
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.beginPath(); ctx.arc(moonX + 10, moonY - 8, 8, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(moonX - 12, moonY + 10, 5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(moonX + 5, moonY + 12, 4, 0, Math.PI*2); ctx.fill();

    // Moon glow
    const glow = ctx.createRadialGradient(moonX, moonY, moonR, moonX, moonY, moonR * 3);
    glow.addColorStop(0, 'rgba(255,240,180,0.12)');
    glow.addColorStop(1, 'rgba(255,240,180,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR * 3, 0, Math.PI*2);
    ctx.fill();

    // Clouds (parallax 0.2)
    for (const c of this._clouds) {
      const sx = ((c.x - cx * 0.15) % (W + 400) + W + 400) % (W + 400) - 200;
      ctx.globalAlpha = c.alpha;
      ctx.fillStyle = '#aabbdd';
      this._roundRect(ctx, sx, c.y, c.w, c.h, c.h/2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Castle silhouette
    this._renderCastle(ctx, camera);

    // Bottom fog
    const fogGrad = ctx.createLinearGradient(0, H * 0.75, 0, H);
    fogGrad.addColorStop(0, 'rgba(20,15,40,0)');
    fogGrad.addColorStop(1, 'rgba(10,8,20,0.7)');
    ctx.fillStyle = fogGrad;
    ctx.fillRect(0, H * 0.75, W, H * 0.25);
  }

  _renderCastle(ctx, camera) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const cx = camera.x, cy = camera.y;
    // Offset castle relative to world center
    const bx = W/2 - cx * 0.3;
    const by = H - 260 - cy * 0.1;

    ctx.fillStyle = 'rgba(20,18,35,0.85)';

    // Main tower
    ctx.fillRect(bx - 40, by - 180, 80, 200);
    // Battlements
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(bx - 48 + i * 22, by - 200, 16, 24);
    }
    // Left tower
    ctx.fillRect(bx - 120, by - 120, 60, 140);
    for (let i = 0; i < 3; i++) ctx.fillRect(bx - 126 + i * 22, by - 136, 14, 18);
    // Right tower
    ctx.fillRect(bx + 60, by - 120, 60, 140);
    for (let i = 0; i < 3; i++) ctx.fillRect(bx + 54 + i * 22, by - 136, 14, 18);
    // Gate arch
    ctx.fillStyle = 'rgba(10,8,20,0.95)';
    ctx.beginPath();
    ctx.arc(bx, by + 30, 22, Math.PI, 0);
    ctx.fillRect(bx - 22, by + 30, 44, 40);
    ctx.fill();
    // Windows (lit)
    const windowGlow = 0.5 + 0.5 * Math.sin(this._time * 0.8);
    ctx.fillStyle = `rgba(255,200,80,${0.4 + windowGlow * 0.2})`;
    ctx.fillRect(bx - 8, by - 160, 16, 20);
    ctx.fillRect(bx - 80, by - 100, 12, 16);
    ctx.fillRect(bx + 88, by - 100, 12, 16);
  }
}

// ─── REGISTRY ───
const MAP_REGISTRY = window.MAP_REGISTRY || {};
MAP_REGISTRY['platform_kingdom'] = {
  id: 'platform_kingdom',
  displayName: 'Platform Kingdom',
  emoji: '🏰',
  description: 'A majestic floating castle. Classic symmetric layout.',
  Class: PlatformKingdom,
};
window.MAP_REGISTRY = MAP_REGISTRY;
window.MapBase = MapBase;
