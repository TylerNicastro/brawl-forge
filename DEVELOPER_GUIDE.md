# BrawlForge — Developer Guide

## Project Structure

```
brawl-forge/
├── index.html          ← Lobby + Room + Game screen
├── style.css           ← All styling
├── stats.js            ← Stats system (localStorage JSON)
├── network.js          ← PeerJS P2P networking
├── engine.js           ← Game loop, physics, hit detection
├── ui.js               ← Screen management, UI events
├── characters/
│   ├── base.js         ← CharacterBase class (extend this)
│   └── iron_knight.js  ← Default character example
└── maps/
    ├── platform_kingdom.js  ← Default map (MapBase + PlatformKingdom)
    └── [your_map].js
```

---

## Adding a New Character

1. Create `characters/your_character.js`
2. Extend `CharacterBase`
3. Register in `CHARACTER_REGISTRY`
4. Add `<script>` tag to `index.html` before `engine.js`

### Minimal Template

```javascript
class MyFighter extends CharacterBase {
  constructor(config = {}) {
    super({
      id: 'my_fighter',
      displayName: 'My Fighter',
      emoji: '🔥',
      colorPrimary: '#ff4400',
      colorSecondary: '#ffaa66',
      description: 'A fiery rushdown character.',
      archetype: 'Rushdown', // Balanced | Rushdown | Zoner | Grappler | Brawler
      ...config,
    });
  }

  defineStats() {
    return {
      maxHP: 90,          // Lower HP = lighter/faster
      weight: 0.85,       // Knockback multiplier (1.0 = normal)
      walkSpeed: 3.8,
      runSpeed: 7.0,      // Fast runner
      airSpeed: 5.0,
      fallSpeed: 9.0,
      fastFallSpeed: 14.0,
      jumpForce: -16,
      doubleJumpForce: -14,
      airJumps: 1,        // Set to 2 for double jump characters
      traction: 0.88,
      airResistance: 0.95,
      size: { w: 38, h: 58 },
    };
  }

  defineAbilities() {
    return {
      jab: {
        name: 'Quick Punch',
        desc: 'Fast jab.',
        damage: 4,
        startup: 2,    // frames before hitbox activates
        active: 4,     // frames hitbox is active
        duration: 16,  // total attack frames
        knockbackX: 2,
        knockbackY: -1,
        hitstun: 10,
        radius: 22,    // hitbox radius in pixels
        offsetX: 26,   // hitbox center offset from player center
        offsetY: -8,
        cooldown: 0,
      },
      // ... other abilities (see iron_knight.js for full list)

      nspecial: {
        name: 'Fireball',
        desc: 'Shoots a projectile.',
        damage: 10,
        startup: 14,
        active: 3,
        duration: 34,
        knockbackX: 5,
        knockbackY: -2,
        hitstun: 16,
        radius: 14,
        offsetX: 50,
        offsetY: -5,
        cooldown: 40,
        isProjectile: true,  // engine will spawn a projectile
      },

      uspecial: {
        name: 'Rocket Jump',
        desc: 'Recovery move.',
        damage: 12,
        startup: 4,
        active: 16,
        duration: 38,
        knockbackX: 2,
        knockbackY: -12,
        hitstun: 20,
        radius: 26,
        offsetX: 0,
        offsetY: -28,
        cooldown: 65,
      },
    };
  }

  // Optional: custom render (otherwise uses default capsule)
  render(ctx) {
    // Draw your character here using canvas 2D API
    // ctx is already translated to (this.x, this.y)
    // Use this.facingRight, this.state, this.animFrame, etc.
    super.render(ctx); // call super for default look
  }
}

// Register — REQUIRED
const CHARACTER_REGISTRY = window.CHARACTER_REGISTRY || {};
CHARACTER_REGISTRY['my_fighter'] = {
  id: 'my_fighter',
  displayName: 'My Fighter',
  emoji: '🔥',
  archetype: 'Rushdown',
  description: 'A fiery rushdown character.',
  Class: MyFighter,
};
window.CHARACTER_REGISTRY = CHARACTER_REGISTRY;
```

### Adding PNG Sprites

Override `render()` and use `ctx.drawImage()`:

```javascript
// Load in constructor
this._sprite = new Image();
this._sprite.src = 'assets/my_fighter.png';

render(ctx) {
  if (this._sprite.complete) {
    const frameW = 64, frameH = 80;
    const frameIdx = this._getAnimFrame();
    ctx.save();
    ctx.translate(this.x, this.y);
    if (!this.facingRight) ctx.scale(-1, 1);
    ctx.drawImage(this._sprite,
      frameIdx * frameW, 0, frameW, frameH,  // source
      -frameW/2, -frameH/2, frameW, frameH   // dest
    );
    ctx.restore();
  } else {
    super.render(ctx); // fallback
  }
}

_getAnimFrame() {
  const stateFrames = {
    idle: [0,1,2,1],
    run: [3,4,5,6,5,4],
    attack: [7,8,9],
    jump: [10],
    fall: [11],
  };
  const frames = stateFrames[this.state] ?? [0];
  return frames[Math.floor(this.animFrame / 4) % frames.length];
}
```

---

## Adding a New Map

1. Create `maps/your_map.js`
2. Extend `MapBase`
3. Register in `MAP_REGISTRY`
4. Add `<script>` to `index.html`

### Minimal Template

```javascript
class MyStage extends MapBase {
  constructor() {
    super();
    this.id = 'my_stage';
    this.displayName = 'My Stage';
    this.emoji = '🌋';
    this.description = 'A volcanic arena.';
    this.gravity = 0.75;  // Overrides default
    this.blastZones = { left: -200, right: 1600, top: -300, bottom: 1000 };
    this.spawnPoints = [
      { x: 400, y: 200 },
      { x: 800, y: 200 },
    ];
    this.build();
  }

  build() {
    this.platforms = [
      // Main floor (solid block)
      { id: 'floor', x: 150, y: 500, w: 900, h: 80, solid: true,
        color: '#5a2a1a', edgeColor: '#8a4a2a' },

      // Floating platform (passthrough)
      { id: 'left', x: 200, y: 360, w: 200, h: 20, solid: false,
        topColor: '#7a5a3a', bottomColor: '#5a3a1a',
        surfaceColor: '#aa7a4a', glowColor: 'rgba(200,120,60,0.4)' },
    ];

    // Moving platform
    this.hazards = [
      { type: 'moving_platform', platformId: 'center',
        axis: 'x', originX: 500, originY: 340, range: 120, speed: 0.5, t: 0 },
    ];
  }

  update(dt) {
    super.update(dt); // Handles moving platforms
  }

  renderBackground(ctx, camera) {
    // Draw your background here
    ctx.fillStyle = '#1a0a00';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    // ... lava, particles, etc.
  }
}

// Register
const MAP_REGISTRY = window.MAP_REGISTRY || {};
MAP_REGISTRY['my_stage'] = {
  id: 'my_stage',
  displayName: 'My Stage',
  emoji: '🌋',
  description: 'A volcanic arena.',
  Class: MyStage,
};
window.MAP_REGISTRY = MAP_REGISTRY;
```

---

## Platform Properties

| Property | Type | Description |
|---|---|---|
| `id` | string | Unique identifier (needed for hazards) |
| `x, y` | number | Top-left position in world space |
| `w, h` | number | Width and height |
| `solid` | bool | `true` = blocks from all sides, `false` = passthrough from above only |
| `topColor` | color | Gradient top (soft platforms) |
| `bottomColor` | color | Gradient bottom (soft platforms) |
| `surfaceColor` | color | Top 5px surface strip |
| `glowColor` | rgba | Outline glow |
| `color` | color | Fill (solid platforms) |
| `edgeColor` | color | Stroke (solid platforms) |

---

## Ability Properties

| Property | Default | Description |
|---|---|---|
| `name` | — | Display name |
| `desc` | — | Description shown in UI |
| `damage` | 8 | HP damage dealt |
| `startup` | 6 | Frames before hitbox appears |
| `active` | 6 | Frames hitbox is active |
| `duration` | 20 | Total animation frames (1 frame ≈ 16ms) |
| `knockbackX` | 6 | Horizontal knockback (scaled by % HP) |
| `knockbackY` | -8 | Vertical knockback (negative = up) |
| `hitstun` | 20 | Frames opponent is stunned |
| `radius` | 22 | Hitbox radius in pixels |
| `offsetX` | size.w*0.7 | Hitbox X offset from character center |
| `offsetY` | 0 | Hitbox Y offset |
| `cooldown` | 0 | Frames before ability can be used again |
| `moveForward` | — | Horizontal velocity added on use |
| `isProjectile` | false | If true, engine spawns a projectile |
| `isGrab` | false | Special grab handling |
| `isThrow` | false | Throw from grab state |
| `isCounter` | false | Counter move (absorbs hit) |

---

## Stats JSON Format

Stored in `localStorage` under `brawlforge_stats_v1`. Export via the Profile panel.

```json
{
  "player": {
    "name": "Fighter",
    "totalGames": 42,
    "wins": 28,
    "losses": 12,
    "draws": 2,
    "totalKills": 156,
    "totalDeaths": 89,
    "totalDamageDealt": 48200,
    "longestWinStreak": 7
  },
  "characters": {
    "iron_knight": {
      "gamesPlayed": 30,
      "wins": 20,
      "kills": 98,
      "damageDealt": 32000,
      "mostUsedAbility": "fair"
    }
  },
  "maps": { "platform_kingdom": { "gamesPlayed": 42, "wins": 28 } },
  "matches": [ /* last 50 match records */ ],
  "achievements": ["first_win", "win_10", "streak_5"]
}
```

---

## Networking Notes

- Uses **PeerJS** (WebRTC) — works on GitHub Pages with no server.
- Rooms discovered via `BroadcastChannel` (same-origin tabs/windows only).
- For cross-machine play: share the **Room ID** string manually (copy button in room screen).
- Input is sent every frame; position snapshots sent every 3 frames.
- Host is the authority for match start/end.
- Supports up to **4 players** per room.

---

## GitHub Pages Deployment

1. Push all files to a GitHub repo
2. Enable Pages: Settings → Pages → Branch: `main` → Folder: `/`
3. Your game is live at `https://[username].github.io/[repo]/`

No build step, no server needed!
