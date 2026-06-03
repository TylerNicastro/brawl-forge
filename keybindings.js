// ═══════════════════════════════════════════════════════════
//  KEYBINDINGS  — BrawlForge
//  Manages all input mappings with localStorage persistence.
//  The engine reads from Keybindings.get(action) at runtime.
// ═══════════════════════════════════════════════════════════

const Keybindings = (() => {

  // ─── DEFAULT BINDINGS ───
  // Each action maps to an array of key strings (KeyboardEvent.key)
  const DEFAULTS = {
    left:     ['a', 'ArrowLeft'],
    right:    ['d', 'ArrowRight'],
    up:       ['w', 'ArrowUp'],
    down:     ['s', 'ArrowDown'],
    jump:     [' '],           // Space — extra jump key
    fastfall: [],              // no extra bind by default (down covers it)
    attack:   ['j', 'z'],
    attack2:  [],
    special:  ['k', 'x'],
    special2: [],
    grab:     ['l', 'c'],
    grab2:    [],
    shield:   ['u', 'Shift'],
    shield2:  [],
    dodge:    ['i'],
    dodge2:   [],
  };

  // Human-readable display names for the controls panel
  const DISPLAY_NAMES = {
    left:     'Move Left',
    right:    'Move Right',
    up:       'Jump / Up',
    down:     'Down / Fast Fall',
    jump:     'Jump (alt)',
    fastfall: 'Fast Fall (alt)',
    attack:   'Attack',
    attack2:  'Attack (alt 2)',
    special:  'Special',
    special2: 'Special (alt 2)',
    grab:     'Grab',
    grab2:    'Grab (alt 2)',
    shield:   'Shield',
    shield2:  'Shield (alt 2)',
    dodge:    'Dodge',
    dodge2:   'Dodge (alt 2)',
  };

  const STORAGE_KEY = 'brawlforge_keybindings_v1';

  // ─── STATE ───
  let bindings = {};        // action → [key, ...]  (single binding per slot for alt keys)
  // We store as: action → [primary, alt1] where each is a string or ''

  function _load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved) {
        // Merge saved on top of defaults (new actions in defaults get added)
        bindings = { ...DEFAULTS };
        for (const action of Object.keys(DEFAULTS)) {
          if (saved[action] !== undefined) bindings[action] = saved[action];
        }
      } else {
        bindings = JSON.parse(JSON.stringify(DEFAULTS));
      }
    } catch (e) {
      bindings = JSON.parse(JSON.stringify(DEFAULTS));
    }
  }

  function _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings)); } catch(e) {}
  }

  // ─── PUBLIC API ───

  // Returns array of keys bound to this action
  function get(action) {
    return bindings[action] || [];
  }

  // Returns true if the pressed key matches this action
  function matches(action, key) {
    const keys = bindings[action] || [];
    const lk = key.toLowerCase();
    return keys.some(k => k.toLowerCase() === lk || k === key);
  }

  // Returns the action for a given key (first match), or null
  function actionFor(key) {
    for (const action of Object.keys(bindings)) {
      if (matches(action, key)) return action;
    }
    return null;
  }

  // Set a binding: action, slot index (0 = primary, 1 = alt), key string
  function set(action, slot, key) {
    if (!bindings[action]) bindings[action] = [];
    // Prevent duplicate bindings across actions (remove from any other action/slot)
    for (const a of Object.keys(bindings)) {
      bindings[a] = bindings[a].filter(k => k.toLowerCase() !== key.toLowerCase());
    }
    bindings[action][slot] = key;
    // Clean up empty slots at end
    while (bindings[action].length > 0 && bindings[action][bindings[action].length - 1] === '') {
      bindings[action].pop();
    }
    _save();
  }

  function reset() {
    bindings = JSON.parse(JSON.stringify(DEFAULTS));
    _save();
  }

  function getAll() {
    return JSON.parse(JSON.stringify(bindings));
  }

  function getDisplayName(action) {
    return DISPLAY_NAMES[action] || action;
  }

  // Returns all actions in display order for the controls panel
  function getControlsList() {
    return [
      { action: 'left',     label: 'Move Left' },
      { action: 'right',    label: 'Move Right' },
      { action: 'up',       label: 'Jump / Up' },
      { action: 'down',     label: 'Down / Fast Fall' },
      { action: 'jump',     label: 'Jump (alt)' },
      { action: 'attack',   label: 'Attack' },
      { action: 'special',  label: 'Special' },
      { action: 'grab',     label: 'Grab' },
      { action: 'shield',   label: 'Shield' },
      { action: 'dodge',    label: 'Dodge' },
    ];
  }

  // Format a key for display (Space → "Space", ShiftLeft → "Shift", etc.)
  function displayKey(key) {
    if (!key || key === '') return '—';
    const map = {
      ' ': 'Space', 'ArrowLeft': '←', 'ArrowRight': '→',
      'ArrowUp': '↑', 'ArrowDown': '↓',
      'Shift': 'Shift', 'Control': 'Ctrl', 'Alt': 'Alt',
      'Enter': 'Enter', 'Escape': 'Esc', 'Backspace': 'Bksp',
      'Tab': 'Tab', 'CapsLock': 'Caps',
    };
    return map[key] || key.toUpperCase();
  }

  // Format all keys for an action as a display string
  function displayKeys(action) {
    const keys = bindings[action] || [];
    if (keys.length === 0) return '—';
    return keys.filter(Boolean).map(displayKey).join(' / ');
  }

  _load();

  return { get, matches, actionFor, set, reset, getAll, getDisplayName, getControlsList, displayKey, displayKeys };
})();

window.Keybindings = Keybindings;


// ═══════════════════════════════════════════════════════════
//  SETTINGS UI CONTROLLER
//  Handles the keybinding modal logic (open/close/rebind).
// ═══════════════════════════════════════════════════════════

const SettingsUI = (() => {

  let listeningBtn = null;   // the button currently awaiting a keypress
  let listeningAction = null;
  let listeningSlot = 0;

  function open() {
    _refreshAllButtons();
    document.getElementById('settings-modal').style.display = 'flex';
  }

  function close() {
    _cancelListen();
    document.getElementById('settings-modal').style.display = 'none';
    // Refresh controls panels in lobby + room
    _refreshControlsDisplays();
  }

  function _refreshAllButtons() {
    document.querySelectorAll('.bind-btn').forEach(btn => {
      const action = btn.dataset.action;
      if (!action) return;
      // Determine which slot this is (primary = first btn for this action, alt = second)
      const allForAction = document.querySelectorAll(`.bind-btn[data-action="${action}"]`);
      // Since each action only has one row+button, we store both keys on one button
      _updateBtnText(btn, action);
    });
  }

  function _updateBtnText(btn, action) {
    btn.textContent = Keybindings.displayKeys(action) || '—';
    btn.classList.remove('listening');
  }

  function _startListen(btn, action) {
    // Cancel any previous listen
    _cancelListen();

    listeningBtn = btn;
    listeningAction = action;
    btn.textContent = '[ press key… ]';
    btn.classList.add('listening');

    document.addEventListener('keydown', _onKeyDown, { capture: true, once: true });
  }

  function _cancelListen() {
    if (listeningBtn) {
      _updateBtnText(listeningBtn, listeningAction);
      listeningBtn.classList.remove('listening');
    }
    listeningBtn = null;
    listeningAction = null;
    document.removeEventListener('keydown', _onKeyDown, { capture: true });
  }

  function _onKeyDown(e) {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      _cancelListen();
      return;
    }

    // Determine slot: if action already has a primary key, set as alt (index 1)
    // We let users cycle: first press = primary, second press on same btn = alt
    const existing = Keybindings.get(listeningAction);
    // We'll just replace primary (index 0) each time — simpler UX
    Keybindings.set(listeningAction, 0, e.key);

    _updateBtnText(listeningBtn, listeningAction);
    listeningBtn = null;
    listeningAction = null;
    _refreshAllButtons();
    _refreshControlsDisplays();
  }

  function _refreshControlsDisplays() {
    const controls = Keybindings.getControlsList();
    ['controls-display', 'controls-display-room'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = controls.map(c =>
        `<div class="ctrl-row"><span class="ctrl-label">${c.label}</span><span class="ctrl-key">${Keybindings.displayKeys(c.action)}</span></div>`
      ).join('');
    });
  }

  function init() {
    // Tab switching
    document.querySelectorAll('.stab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.settings-tab-content').forEach(c => c.style.display = 'none');
        tab.classList.add('active');
        document.getElementById('stab-' + tab.dataset.tab).style.display = 'block';
      });
    });

    // Bind buttons
    document.querySelectorAll('.bind-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn === listeningBtn) { _cancelListen(); return; }
        _startListen(btn, btn.dataset.action);
      });
    });

    // Close / reset
    document.getElementById('settings-close-btn').addEventListener('click', close);
    document.getElementById('settings-reset-btn').addEventListener('click', () => {
      Keybindings.reset();
      _refreshAllButtons();
      _refreshControlsDisplays();
    });

    // Close on overlay backdrop click
    document.getElementById('settings-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('settings-modal')) close();
    });

    // Open button in lobby
    document.getElementById('btn-open-settings').addEventListener('click', open);

    // Initial render of controls display
    _refreshControlsDisplays();
  }

  return { init, open, close };
})();

window.SettingsUI = SettingsUI;
