// Easy Announce Card (Ltek) — Home Assistant Dashboard card for Alexa announcements
// Version: v2026.11.17.1
//
// Type a message (or tap a preset), pick the speakers, press Send. One call reaches every
// selected speaker:
//   send_with: notify (default) → notify.alexa_media  { message, target: [..], data: { type: announce } }
//   send_with: script           → script.<name>       { message, target: [..] }
//
// Speakers are found on their own: every media_player from Alexa Media Player (or every
// media_player), minus the exclude patterns (glob on entity ID, name or integration), plus
// any entities listed under include.
//
// Presets come from an input_select (presets_entity). Admins can save the typed message as a
// preset and delete presets from the card: it rewrites the helper's options over the WebSocket
// API (input_select/list + input_select/update), keeping any "---" / "Select..." placeholder.
// YAML input_selects are read-only.
//
// View state (typed message, selected speakers) lives in a module-level store keyed by the
// card's presets entity, so a card element the dashboard editor recreates renders the
// same view at once. The selection can also be remembered in the browser (remember_selection).
//
// Vanilla JS, single file. The card stylesheet is a constant (no config values are
// interpolated into it); per-card values are custom properties set inline on the card root.
// The card renders once and patches itself on every state change.

const BUILD_NUMBER = 'v2026.11.17.1';
const VERSION = BUILD_NUMBER.slice(1);
const CARD_TAG = 'easy-announce-card';
const EDITOR_TAG = 'easy-announce-card-editor';
const DEFAULT_TITLE = 'Announcements';
const STORE_PREFIX = 'ean-';
const ALEXA_PLATFORM = 'alexa_media';
// input_select options that are there to say "nothing picked", never presets.
const PLACEHOLDERS = new Set(['', '---', '--', '-', 'select...', 'select…', 'select', 'none', 'unknown']);
const UNAVAILABLE = new Set(['unavailable', 'unknown']);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DEFAULTS = {
  title: DEFAULT_TITLE,
  send_with: 'notify',
  notify_service: 'notify.alexa_media',
  announce_type: 'announce',
  script: '',
  presets_entity: '',
  preset_style: 'chips',
  show_message_box: true,
  allow_edit_presets: true,
  clear_after_send: false,
  speaker_source: 'alexa',
  hide_unavailable: true,
  columns: 3,
  tap_action: 'select',
  show_state: true,
  show_select_all: true,
  remember_selection: true,
  font_size_title: 14,
  font_size_name: 13,
  font_size_message: 14,
  icon_size: 24,
};
// key, label, "unset" label, seed hex, fallback CSS used by the card
const COLOR_DEFS = [
  ['color_title', 'Title', 'Theme text', '#e1e1e1', 'var(--primary-text-color)'],
  ['color_selected', 'Selected speaker', 'Theme primary', '#03a9f4', 'var(--primary-color)'],
  ['color_icon', 'Speaker icon', 'Theme state icon', '#44739e', 'var(--state-icon-color, var(--paper-item-icon-color, #44739e))'],
  ['color_send', 'Send button', 'Theme primary', '#03a9f4', 'var(--primary-color)'],
  ['color_preset', 'Preset chips', 'Theme text', '#e1e1e1', 'var(--primary-text-color)'],
];
const COLOR_KEYS = COLOR_DEFS.map((d) => d[0]);
const SIZE_DEFS = [ // key, label, min, max
  ['font_size_title', 'Title', 8, 32],
  ['font_size_message', 'Message & presets', 8, 24],
  ['font_size_name', 'Speaker names', 8, 24],
  ['icon_size', 'Speaker icons', 12, 48],
];
const LIST_KEYS = ['include', 'exclude', 'strip_words'];

const isDefault = (key, v) => {
  const d = DEFAULTS[key];
  if (d === undefined) return false;
  return typeof d === 'number' ? Number(v) === d : v === d;
};

/** Drop defaults, empty lists and empty colors. Idempotent; never touches keys it doesn't know (type, card_mod, …). */
function normalizeConfig(raw) {
  const c = { ...(raw || {}) };
  for (const k of Object.keys(DEFAULTS)) {
    if (!(k in c)) continue;
    if (k === 'title') { if (c.title === null || c.title === DEFAULT_TITLE) delete c.title; continue; } // '' = no title line
    if (c[k] === null || c[k] === undefined || isDefault(k, c[k]) || (typeof DEFAULTS[k] === 'string' && c[k] === '' && DEFAULTS[k] === '')) delete c[k];
  }
  for (const k of COLOR_KEYS) if (k in c && (c[k] === '' || c[k] == null)) delete c[k];
  for (const k of LIST_KEYS) {
    if (!(k in c)) continue;
    const list = (Array.isArray(c[k]) ? c[k] : [c[k]]).map((x) => String(x == null ? '' : x).trim()).filter(Boolean);
    if (list.length) c[k] = [...new Set(list)]; else delete c[k];
  }
  return c;
}

/** Config value with its default applied. */
const cfg = (c, key) => (c[key] !== undefined ? c[key] : DEFAULTS[key]);

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cssEsc = (s) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
const errText = (e) => (e && (e.message || e.code)) || String(e);

// ---------------------------------------------------------------------------
// Speakers
// ---------------------------------------------------------------------------
/** A glob ("*plex*", "This Device*") as a case-insensitive, whole-string RegExp. */
function globRe(pattern) {
  const p = String(pattern).trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${p}$`, 'i');
}

/** True if any pattern matches the entity ID, its name or its integration. */
function excluded(patterns, id, name, platform) {
  return (patterns || []).some((p) => { const re = globRe(p); return re.test(id) || re.test(name || '') || (!!platform && re.test(platform)); });
}

/** "Kitchen Echo Dot" minus strip words ["echo", "dot"] → "Kitchen". Never empty. */
function cleanName(name, words) {
  let out = String(name || '');
  for (const w of words || []) {
    const re = new RegExp(`(^|\\s)${String(w).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'gi');
    out = out.replace(re, ' ');
  }
  out = out.replace(/\s+/g, ' ').trim();
  return out || String(name || '');
}

const friendly = (st, id) => (st && st.attributes && st.attributes.friendly_name) || id.split('.')[1].replace(/_/g, ' ');

/**
 * The speakers the card shows, sorted by name: [{ id, name, available }].
 * source "alexa" = media players whose integration is Alexa Media Player (every media player
 * when the entity registry isn't loaded); "all" = every media player. `include` entries are
 * always added (if they exist); exclude patterns never remove an included entity.
 */
function discoverSpeakers(hass, c) {
  if (!hass || !hass.states) return [];
  const source = cfg(c, 'speaker_source');
  const reg = hass.entities || null;
  const include = c.include || [];
  const hideUnavail = cfg(c, 'hide_unavailable');
  const out = new Map();
  for (const id of Object.keys(hass.states)) {
    if (!id.startsWith('media_player.')) continue;
    const st = hass.states[id];
    const platform = reg && reg[id] ? reg[id].platform : '';
    if (include.includes(id)) continue; // added below
    if (source === 'alexa' && reg && platform !== ALEXA_PLATFORM) continue;
    if (reg && reg[id] && reg[id].hidden) continue;
    const name = friendly(st, id);
    if (excluded(c.exclude, id, name, platform)) continue;
    const available = !UNAVAILABLE.has(st.state);
    if (!available && hideUnavail) continue;
    out.set(id, { id, name: cleanName(name, c.strip_words), available });
  }
  for (const id of include) {
    const st = hass.states[id];
    if (!st) continue;
    const available = !UNAVAILABLE.has(st.state);
    if (!available && hideUnavail) continue;
    out.set(id, { id, name: cleanName(friendly(st, id), c.strip_words), available });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Short state line for a speaker tile. */
function speakerState(st) {
  if (!st) return 'Missing';
  if (UNAVAILABLE.has(st.state)) return 'Offline';
  const a = st.attributes || {};
  if (st.state === 'playing') {
    const what = [a.media_title, a.media_artist].filter(Boolean).join(' · ');
    return what ? `Playing · ${what}` : 'Playing';
  }
  if (st.state === 'paused') return 'Paused';
  return st.state ? st.state.charAt(0).toUpperCase() + st.state.slice(1) : '';
}

// ---------------------------------------------------------------------------
// Presets (input_select)
// ---------------------------------------------------------------------------
const isPlaceholder = (o) => PLACEHOLDERS.has(String(o == null ? '' : o).trim().toLowerCase());

/** { options: real presets, all: every option, editable, exists } for the presets entity. */
function readPresets(hass, c) {
  const id = c.presets_entity;
  const st = id && hass && hass.states ? hass.states[id] : null;
  if (!st) return { options: [], all: [], editable: false, exists: false };
  const all = Array.isArray(st.attributes && st.attributes.options) ? st.attributes.options.map(String) : [];
  return { options: all.filter((o) => !isPlaceholder(o)), all, editable: !(st.attributes && st.attributes.editable === false), exists: true };
}

/**
 * The full option list to store after the presets change to `presets`: the placeholders the
 * helper had stay first (the sync automation picks "---"), then the presets, without duplicates.
 * input_select needs at least one option, so an emptied list keeps a "---".
 */
function planOptions(allBefore, presets) {
  const keep = (allBefore || []).filter((o) => isPlaceholder(o) && String(o).trim() !== '');
  const list = [...new Set([...keep, ...presets.map((p) => String(p).trim()).filter(Boolean)])];
  return list.length ? list : ['---'];
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------
/** [domain, service, data] for one announcement, or null when the card isn't set up to send. */
function buildCall(c, message, targets) {
  const msg = String(message || '').trim();
  if (!msg || !targets || !targets.length) return null;
  if (cfg(c, 'send_with') === 'script') {
    const s = String(c.script || '').trim();
    if (!/^script\.[a-z0-9_]+$/.test(s)) return null;
    return ['script', s.slice(7), { message: msg, target: [...targets] }];
  }
  const svc = String(cfg(c, 'notify_service') || '').trim();
  const m = svc.match(/^([a-z0-9_]+)\.([a-z0-9_]+)$/);
  if (!m) return null;
  return [m[1], m[2], { message: msg, target: [...targets], data: { type: cfg(c, 'announce_type') } }];
}

/** Why the card can't send yet (shown in place of a status), or ''. */
function setupProblem(c) {
  if (cfg(c, 'send_with') === 'script') {
    return /^script\.[a-z0-9_]+$/.test(String(c.script || '').trim()) ? '' : 'Pick the script to call in the card settings.';
  }
  return /^[a-z0-9_]+\.[a-z0-9_]+$/.test(String(cfg(c, 'notify_service') || '').trim()) ? '' : 'The notify service must look like notify.alexa_media.';
}

// ---------------------------------------------------------------------------
// View store: survives the dashboard editor replacing the card element
// ---------------------------------------------------------------------------
const VIEWS = new Map();
const viewKey = (c) => c.presets_entity || 'default';

function storageGet(k) { try { return JSON.parse(window.localStorage.getItem(STORE_PREFIX + k)); } catch (e) { return null; } }
function storageSet(k, v) { try { window.localStorage.setItem(STORE_PREFIX + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }

function viewFor(c) {
  const key = viewKey(c);
  let v = VIEWS.get(key);
  if (!v) {
    const saved = cfg(c, 'remember_selection') ? storageGet(`sel:${key}`) : null;
    v = { key, message: '', selected: new Set(Array.isArray(saved) ? saved : []), managing: false, status: null, busy: false };
    VIEWS.set(key, v);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
const CARD_CSS = `
  :host { display: block; font-family: var(--primary-font-family, sans-serif); }
  ha-card.card { padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
  .head { display: flex; align-items: center; gap: 8px; min-height: 20px; }
  .title { flex: 1 1 auto; min-width: 0; font-size: var(--ean-fs-title); font-weight: 600; color: var(--ean-c-title);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .head-btn, .icon-btn { border: none; background: none; padding: 0; margin: 0; cursor: pointer; line-height: 0; color: var(--secondary-text-color); }
  .head-btn ha-icon, .icon-btn ha-icon { --mdc-icon-size: 20px; width: 20px; height: 20px; }
  .head-btn:hover, .icon-btn:hover { color: var(--primary-text-color); }
  .head-btn.on { color: var(--ean-c-selected); }
  .icon-btn:disabled { opacity: .35; cursor: default; }

  .presets { display: flex; flex-wrap: wrap; gap: 6px; }
  .presets:empty { display: none; }
  .chip { max-width: 100%; min-height: 30px; padding: 4px 12px; border-radius: 15px; border: 1px solid var(--divider-color); background: none;
    cursor: pointer; color: var(--ean-c-preset); font-family: inherit; font-size: var(--ean-fs-msg); text-align: left;
    display: inline-flex; align-items: center; gap: 6px; box-sizing: border-box; }
  .chip:hover { border-color: var(--ean-c-selected); }
  .chip.on { border-color: var(--ean-c-selected); background: color-mix(in srgb, var(--ean-c-selected) 18%, transparent); }
  .chip .chip-text { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .chip .chip-del { line-height: 0; color: var(--secondary-text-color); }
  .chip .chip-del ha-icon { --mdc-icon-size: 16px; width: 16px; height: 16px; }
  .chip.managing:hover { border-color: var(--error-color, #db4437); }
  .chip.managing:hover .chip-del { color: var(--error-color, #db4437); }
  select.preset-select { width: 100%; height: 36px; box-sizing: border-box; padding: 0 10px; border: 1px solid var(--divider-color); border-radius: 8px;
    background: var(--card-background-color); color: var(--primary-text-color); font-family: inherit; font-size: var(--ean-fs-msg); }

  .compose { display: flex; align-items: flex-end; gap: 8px; }
  textarea.msg { flex: 1 1 auto; min-width: 0; min-height: 40px; max-height: 140px; resize: vertical; box-sizing: border-box; padding: 9px 12px;
    border: 1px solid var(--divider-color); border-radius: 10px; background: var(--card-background-color); color: var(--primary-text-color);
    font-family: inherit; font-size: var(--ean-fs-msg); line-height: 1.35; }
  textarea.msg:focus { outline: none; border-color: var(--ean-c-selected); }
  .send { flex: none; height: 40px; padding: 0 16px; border: none; border-radius: 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
    background: var(--ean-c-send); color: var(--text-primary-color, #fff); font-family: inherit; font-size: 14px; font-weight: 600; }
  .send ha-icon { --mdc-icon-size: 18px; width: 18px; height: 18px; }
  .send:disabled { opacity: .4; cursor: default; }
  .send.busy { opacity: .7; }

  .spk-head { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em;
    color: var(--secondary-text-color); }
  .spk-head .count { flex: 1 1 auto; text-transform: none; letter-spacing: 0; font-weight: 500; }
  .link { border: none; background: none; padding: 2px 4px; cursor: pointer; color: var(--ean-c-selected); font-family: inherit; font-size: 12px; font-weight: 600; }
  .link:disabled { color: var(--disabled-text-color, var(--secondary-text-color)); cursor: default; }

  .grid { display: grid; grid-template-columns: var(--ean-cols); gap: 8px; }
  .tile { position: relative; display: flex; align-items: center; gap: 10px; min-width: 0; padding: 8px 10px; border-radius: 12px; cursor: pointer;
    border: 1px solid var(--divider-color); background: none; color: var(--primary-text-color); font-family: inherit; text-align: left;
    transition: border-color .15s ease, background-color .15s ease; }
  .tile:hover { border-color: color-mix(in srgb, var(--ean-c-selected) 60%, var(--divider-color)); }
  .tile.on { border-color: var(--ean-c-selected); background: color-mix(in srgb, var(--ean-c-selected) 15%, transparent); }
  .tile.off { opacity: .45; cursor: default; }
  .tile.flash { border-color: var(--success-color, #43a047); background: color-mix(in srgb, var(--success-color, #43a047) 18%, transparent); }
  .tile ha-icon.spk-icon { flex: none; --mdc-icon-size: var(--ean-icon); width: var(--ean-icon); height: var(--ean-icon); color: var(--ean-c-icon); }
  .tile.on ha-icon.spk-icon { color: var(--ean-c-selected); }
  .tile .txt { display: flex; flex-direction: column; min-width: 0; padding-right: 14px; } /* room for the check mark */
  .tile .name { font-size: var(--ean-fs-name); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile .state { font-size: 11px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile .check { position: absolute; top: 4px; right: 6px; line-height: 0; color: var(--ean-c-selected); display: none; }
  .tile .check ha-icon { --mdc-icon-size: 16px; width: 16px; height: 16px; }
  .tile.on .check { display: block; }
  .empty { color: var(--secondary-text-color); font-size: 13px; }

  .status { font-size: 12px; color: var(--secondary-text-color); min-height: 16px; }
  .status:empty { display: none; }
  .status.ok { color: var(--success-color, #43a047); }
  .status.err { color: var(--error-color, #db4437); }
  .status.warn { color: var(--warning-color, #f4b942); }
`;

/** The per-card values, as custom properties on the card root (the stylesheet never changes). */
function rootStyleVars(c) {
  const color = (key) => { const d = COLOR_DEFS.find((x) => x[0] === key); return c[key] || d[4]; };
  const px = (key) => `${Number(cfg(c, key))}px`;
  const n = Number(cfg(c, 'columns'));
  const cols = n > 0 ? `repeat(${Math.round(n)}, minmax(0, 1fr))` : 'repeat(auto-fill, minmax(140px, 1fr))';
  return [
    `--ean-cols:${cols}`,
    `--ean-fs-title:${px('font_size_title')}`, `--ean-fs-msg:${px('font_size_message')}`, `--ean-fs-name:${px('font_size_name')}`,
    `--ean-icon:${px('icon_size')}`,
    ...COLOR_KEYS.map((k) => `--ean-c-${k.slice(6)}:${color(k)}`),
  ].join(';');
}

const speakerIcon = (st) => (st && st.attributes && st.attributes.icon) || (st && st.state === 'playing' ? 'mdi:speaker-play' : 'mdi:speaker');

class EasyAnnounceCard extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._config = {};
    this._throttle = null;
    this._speakers = [];
    this._spkSig = '';
    this._preSig = '';
    this._rendered = false;
    this.attachShadow({ mode: 'open' });
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    this._config = normalizeConfig(config);
    this._view = viewFor(this._config);
    if (this._hass) this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first || !this._rendered) { this._render(); return; }
    if (this._throttle) return;
    this._throttle = setTimeout(() => { this._throttle = null; this._update(); }, 250);
  }

  disconnectedCallback() {
    if (this._throttle) clearTimeout(this._throttle);
    this._throttle = null;
  }

  getCardSize() {
    const cols = Number(this._c('columns')) || 3;
    return 3 + Math.ceil((this._speakers.length || 3) / cols);
  }

  static getConfigElement() { return document.createElement(EDITOR_TAG); }

  static getStubConfig() { return {}; }

  _c(key) { return cfg(this._config, key); }

  /** Admins may rewrite the presets helper (input_select/update is admin-only in Home Assistant). */
  _canEditPresets() {
    const h = this._hass;
    const p = readPresets(h, this._config);
    return !!(this._c('allow_edit_presets') && p.exists && p.editable && h && h.user && h.user.is_admin && typeof h.callWS === 'function');
  }

  _visibleSelected() {
    const shown = new Set(this._speakers.filter((s) => s.available).map((s) => s.id));
    return [...this._view.selected].filter((id) => shown.has(id));
  }

  _persistSelection() {
    if (this._c('remember_selection')) storageSet(`sel:${this._view.key}`, [...this._view.selected]);
  }

  // ── Render (full) ───────────────────────────────────────────────────────
  _render() {
    if (!this._hass) return;
    const c = this._config;
    const v = this._view || (this._view = viewFor(c));
    const root = this.shadowRoot;
    // Keep the caret in the message box across a redraw.
    const ae = root.activeElement;
    let caret = null;
    if (ae && ae.classList && ae.classList.contains('msg')) { try { caret = [ae.selectionStart, ae.selectionEnd]; } catch (e) { caret = null; } }
    const title = this._c('title');
    this._speakers = discoverSpeakers(this._hass, c);
    this._spkSig = this._speakerSig();
    root.innerHTML = `<style>${CARD_CSS}</style>
      <ha-card class="card" style="${esc(rootStyleVars(c))}">
        ${title || this._canEditPresets() ? `<div class="head"><span class="title">${esc(title)}</span>${this._manageBtnHtml()}</div>` : ''}
        <div class="presets" data-presets>${this._presetsHtml()}</div>
        ${this._c('show_message_box') ? `<div class="compose">
          <textarea class="msg" rows="1" placeholder="Type an announcement…" aria-label="Announcement">${esc(v.message)}</textarea>
          ${this._canEditPresets() ? '<button class="icon-btn" data-save-preset title="Save as a preset"><ha-icon icon="mdi:bookmark-plus-outline"></ha-icon></button>' : ''}
          <button class="send" data-send><ha-icon icon="mdi:bullhorn-outline"></ha-icon>Send</button>
        </div>` : ''}
        <div class="spk-head"><span>Speakers</span><span class="count" data-count></span>${this._c('show_select_all')
    ? '<button class="link" data-all>All</button><button class="link" data-none>None</button>' : ''}</div>
        <div class="grid" data-grid>${this._gridHtml()}</div>
        <div class="status" data-status></div>
      </ha-card>`;
    this._rendered = true;
    this._wire();
    this._patch();
    this._showStatus();
    if (caret) {
      const el = root.querySelector('textarea.msg');
      if (el) { el.focus(); try { el.setSelectionRange(caret[0], caret[1]); } catch (e) { /* not a text field */ } }
    }
  }

  _manageBtnHtml() {
    if (!this._canEditPresets() || !readPresets(this._hass, this._config).options.length) return '';
    const on = this._view.managing;
    return `<button class="head-btn${on ? ' on' : ''}" data-manage title="${on ? 'Done editing presets' : 'Edit presets'}">
      <ha-icon icon="${on ? 'mdi:check' : 'mdi:pencil-outline'}"></ha-icon></button>`;
  }

  _presetsHtml() {
    const p = readPresets(this._hass, this._config);
    this._preSig = p.all.join('\n');
    if (!p.options.length) return '';
    const msg = this._view.message.trim();
    if (this._c('preset_style') === 'dropdown' && !this._view.managing) {
      const sel = p.options.includes(msg) ? msg : '';
      return `<select class="preset-select" data-preset-select aria-label="Preset message">
        <option value=""${sel ? '' : ' selected'}>Pick a preset…</option>
        ${p.options.map((o) => `<option value="${esc(o)}"${o === sel ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    }
    const managing = this._view.managing && this._canEditPresets();
    return p.options.map((o, i) => `<button class="chip${o === msg ? ' on' : ''}${managing ? ' managing' : ''}" data-preset="${i}" title="${esc(managing ? `Delete “${o}”` : o)}">
      <span class="chip-text">${esc(o)}</span>${managing ? '<span class="chip-del"><ha-icon icon="mdi:trash-can-outline"></ha-icon></span>' : ''}</button>`).join('');
  }

  _gridHtml() {
    if (!this._speakers.length) {
      return `<div class="empty">${this._c('speaker_source') === 'alexa'
        ? 'No Alexa speakers found. Alexa Media Player must be installed, or switch the card to every media player.'
        : 'No media players found.'}</div>`;
    }
    const showState = this._c('show_state');
    return this._speakers.map((s) => `<button class="tile" data-spk="${esc(s.id)}" title="${esc(s.id)}">
        <ha-icon class="spk-icon" icon="mdi:speaker"></ha-icon>
        <span class="txt"><span class="name">${esc(s.name)}</span>${showState ? '<span class="state" data-state></span>' : ''}</span>
        <span class="check"><ha-icon icon="mdi:check-circle"></ha-icon></span></button>`).join('');
  }

  _speakerSig() { return this._speakers.map((s) => `${s.id}|${s.name}|${s.available}`).join(','); }

  _wire() {
    const root = this.shadowRoot;
    const on = (sel, ev, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, (e) => fn(el, e)));
    on('textarea.msg', 'input', (el) => { this._view.message = el.value; this._refreshPresetsActive(); this._patchSend(); });
    on('textarea.msg', 'keydown', (el, e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this._send(); }
    });
    on('[data-send]', 'click', () => this._send());
    on('[data-save-preset]', 'click', () => this._savePreset());
    on('[data-manage]', 'click', () => { this._view.managing = !this._view.managing; this._render(); });
    on('[data-all]', 'click', () => {
      this._speakers.filter((s) => s.available).forEach((s) => this._view.selected.add(s.id));
      this._persistSelection(); this._patch();
    });
    on('[data-none]', 'click', () => { this._view.selected.clear(); this._persistSelection(); this._patch(); });
    on('[data-spk]', 'click', (el) => this._tapSpeaker(el.dataset.spk));
    this._wirePresets();
  }

  _wirePresets() {
    const root = this.shadowRoot;
    root.querySelectorAll('[data-preset]').forEach((el) => el.addEventListener('click', () => {
      const opt = readPresets(this._hass, this._config).options[Number(el.dataset.preset)];
      if (opt === undefined) return;
      if (this._view.managing && this._canEditPresets()) { this._deletePreset(opt); return; }
      this._usePreset(opt);
    }));
    root.querySelectorAll('[data-preset-select]').forEach((el) => el.addEventListener('change', () => { if (el.value) this._usePreset(el.value); }));
  }

  _usePreset(text) {
    this._view.message = text;
    const ta = this.shadowRoot.querySelector('textarea.msg');
    if (ta) ta.value = text;
    if (!this._c('show_message_box')) { this._send(); return; } // presets-only card: a tap announces
    this._refreshPresetsActive();
    this._patchSend();
  }

  /** Mark the chip / dropdown entry that matches the message, without redrawing. */
  _refreshPresetsActive() {
    const msg = this._view.message.trim();
    const opts = readPresets(this._hass, this._config).options;
    this.shadowRoot.querySelectorAll('[data-preset]').forEach((el) => el.classList.toggle('on', opts[Number(el.dataset.preset)] === msg));
    const sel = this.shadowRoot.querySelector('[data-preset-select]');
    if (sel) sel.value = opts.includes(msg) ? msg : '';
    const save = this.shadowRoot.querySelector('[data-save-preset]');
    if (save) save.disabled = !msg || opts.includes(msg) || this._view.busy;
  }

  _tapSpeaker(id) {
    const s = this._speakers.find((x) => x.id === id);
    if (!s || !s.available) return;
    if (this._c('tap_action') === 'send') { this._send([id]); return; }
    if (this._view.selected.has(id)) this._view.selected.delete(id); else this._view.selected.add(id);
    this._persistSelection();
    this._patch();
  }

  // ── Live updates ────────────────────────────────────────────────────────
  _update() {
    if (!this._hass) return;
    const next = discoverSpeakers(this._hass, this._config);
    const sig = next.map((s) => `${s.id}|${s.name}|${s.available}`).join(',');
    if (sig !== this._spkSig) {
      this._speakers = next;
      this._spkSig = sig;
      const grid = this.shadowRoot.querySelector('[data-grid]');
      if (grid) {
        grid.innerHTML = this._gridHtml();
        grid.querySelectorAll('[data-spk]').forEach((el) => el.addEventListener('click', () => this._tapSpeaker(el.dataset.spk)));
      }
    }
    const p = readPresets(this._hass, this._config);
    if (p.all.join('\n') !== this._preSig) {
      // The head's edit button depends on there being presets: a full redraw keeps the message and caret.
      this._render();
      return;
    }
    this._patch();
  }

  /** Patch everything state-driven in place: tiles, the selected count, the Send button. */
  _patch() {
    const h = this._hass;
    const root = this.shadowRoot;
    const sel = this._view.selected;
    for (const s of this._speakers) {
      const el = root.querySelector(`.tile[data-spk="${cssEsc(s.id)}"]`);
      if (!el) continue;
      const st = h.states[s.id];
      el.classList.toggle('on', sel.has(s.id) && s.available);
      el.classList.toggle('off', !s.available);
      el.setAttribute('aria-pressed', String(sel.has(s.id) && s.available));
      const icon = el.querySelector('.spk-icon');
      if (icon) { const ic = speakerIcon(st); if (icon.getAttribute('icon') !== ic) icon.setAttribute('icon', ic); }
      const stEl = el.querySelector('[data-state]');
      if (stEl) { const t = speakerState(st); if (stEl.textContent !== t) stEl.textContent = t; }
    }
    const count = root.querySelector('[data-count]');
    if (count) {
      const n = this._visibleSelected().length;
      const tapSend = this._c('tap_action') === 'send';
      count.textContent = tapSend ? 'tap one to announce' : n ? `${n} selected` : 'none selected';
    }
    root.querySelectorAll('[data-all], [data-none]').forEach((b) => { b.disabled = this._c('tap_action') === 'send'; });
    this._patchSend();
  }

  _patchSend() {
    const btn = this.shadowRoot.querySelector('[data-send]');
    if (!btn) return;
    const ready = !!this._view.message.trim() && (this._c('tap_action') === 'send' || this._visibleSelected().length > 0) && !setupProblem(this._config);
    btn.disabled = !ready || this._view.busy || this._c('tap_action') === 'send';
    btn.classList.toggle('busy', this._view.busy);
    btn.title = this._c('tap_action') === 'send' ? 'Tap a speaker to announce on it' : '';
    const save = this.shadowRoot.querySelector('[data-save-preset]');
    if (save) {
      const msg = this._view.message.trim();
      save.disabled = !msg || readPresets(this._hass, this._config).options.includes(msg) || this._view.busy;
    }
  }

  _setStatus(kind, text) {
    this._view.status = text ? { kind, text, at: Date.now() } : null;
    this._showStatus();
  }

  _showStatus() {
    const el = this.shadowRoot.querySelector('[data-status]');
    if (!el) return;
    const problem = setupProblem(this._config);
    const st = this._view.status;
    const kind = problem ? 'warn' : st ? st.kind : '';
    el.className = `status${kind ? ` ${kind}` : ''}`;
    el.textContent = problem || (st ? st.text : '');
  }

  // ── Actions ─────────────────────────────────────────────────────────────
  async _send(only) {
    const v = this._view;
    if (v.busy) return;
    const targets = only || this._visibleSelected();
    const msg = v.message.trim();
    if (!msg) { this._setStatus('warn', 'Type or pick a message first.'); return; }
    if (!targets.length) { this._setStatus('warn', 'Pick at least one speaker.'); return; }
    const call = buildCall(this._config, msg, targets);
    if (!call) { this._showStatus(); return; }
    v.busy = true; this._patchSend();
    const names = targets.map((id) => (this._speakers.find((s) => s.id === id) || { name: id }).name);
    try {
      await this._hass.callService(call[0], call[1], call[2]);
      this._setStatus('ok', `Announced on ${names.length > 3 ? `${names.length} speakers` : names.join(', ')}.`);
      targets.forEach((id) => this._flash(id));
      if (this._c('clear_after_send')) {
        v.message = '';
        const ta = this.shadowRoot.querySelector('textarea.msg');
        if (ta) ta.value = '';
        this._refreshPresetsActive();
      }
    } catch (e) {
      this._setStatus('err', `Not sent: ${errText(e)}`);
    } finally {
      v.busy = false; this._patchSend();
    }
  }

  _flash(id) {
    const el = this.shadowRoot.querySelector(`.tile[data-spk="${cssEsc(id)}"]`);
    if (!el) return;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 900);
  }

  /** The helper's stored id (what input_select/update wants) is its registry unique_id. */
  async _storageItem() {
    const id = this._config.presets_entity;
    let uid = null;
    try { const e = await this._hass.callWS({ type: 'config/entity_registry/get', entity_id: id }); uid = e && e.unique_id; } catch (e) { uid = null; }
    const items = (await this._hass.callWS({ type: 'input_select/list' })) || [];
    const item = items.find((x) => x.id === uid) || items.find((x) => x.id === id.split('.')[1]);
    if (!item) throw new Error(`${id} isn't a helper made in the UI, so the card can't change it`);
    return item;
  }

  async _writePresets(presets, okText) {
    const v = this._view;
    v.busy = true; this._patchSend();
    try {
      const item = await this._storageItem();
      const options = planOptions(item.options || readPresets(this._hass, this._config).all, presets);
      const data = { type: 'input_select/update', input_select_id: item.id, name: item.name, options };
      if (item.icon) data.icon = item.icon;
      if (item.initial && options.includes(item.initial)) data.initial = item.initial;
      await this._hass.callWS(data);
      this._setStatus('ok', okText);
    } catch (e) {
      this._setStatus('err', `Presets not saved: ${errText(e)}`);
    } finally {
      v.busy = false; this._patchSend();
    }
  }

  _savePreset() {
    const msg = this._view.message.trim();
    const p = readPresets(this._hass, this._config);
    if (!msg || p.options.includes(msg) || !this._canEditPresets()) return;
    return this._writePresets([...p.options, msg], 'Saved as a preset.');
  }

  _deletePreset(text) {
    const p = readPresets(this._hass, this._config);
    if (!p.options.includes(text)) return;
    const left = p.options.filter((o) => o !== text);
    if (!left.length) this._view.managing = false;
    return this._writePresets(left, `Deleted “${text}”.`);
  }
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------
const THEME_COLORS = [
  ['var(--primary-color)', 'Primary'],
  ['var(--accent-color)', 'Accent'],
  ['var(--primary-text-color)', 'Primary text'],
  ['var(--secondary-text-color)', 'Secondary text'],
  ['var(--disabled-text-color)', 'Disabled text'],
  ['var(--state-active-color)', 'State active'],
  ['var(--error-color)', 'Error'],
  ['var(--warning-color)', 'Warning'],
  ['var(--success-color)', 'Success'],
  ['var(--info-color)', 'Info'],
];

function colorMode(cur) {
  cur = cur == null ? '' : String(cur);
  if (cur === '') return 'default';
  if (/^#[0-9a-fA-F]{3,8}$/.test(cur)) return 'custom';
  if (/^var\(/.test(cur) && THEME_COLORS.some(([v]) => v === cur)) return 'theme';
  return 'css';
}

const EDITOR_CSS = `
        .eane {
          /* Font sizes (by role, not by pixel) */
          --ltek-fs-panel-title: 16px;  /* top-level panel / section title */
          --ltek-fs-header: 15px;       /* editor header, panel summary */
          --ltek-fs-group: 14px;        /* group heading inside a panel */
          --ltek-fs-label: 13px;        /* standard field label / row */
          --ltek-fs-body: 12px;         /* body text, most controls */
          --ltek-fs-small: 11px;        /* hints, secondary text */
          --ltek-fs-tiny: 10px;         /* badges, micro-labels */
          /* Font weights */
          --ltek-fw-normal: 400;        /* control labels (recede) */
          --ltek-fw-medium: 500;
          --ltek-fw-semibold: 600;
          --ltek-fw-bold: 700;          /* titles, values (lead) */
          /* Text colors */
          --ltek-c-text: var(--primary-text-color, #e1e1e1);  /* primary */
          --ltek-c-label: #ccc;         /* control labels */
          --ltek-c-muted: #888;         /* hints / disabled */
          --ltek-c-accent: var(--primary-color, #2196F3);
          /* Accent tints — hover / active fills (kept as rgba literals; one place
             to change). Default to the Material blue the cards shipped with. */
          --ltek-c-accent-fade: rgba(var(--rgb-primary-color,33,150,243),0.12);       /* active / pressed fill */
          --ltek-c-accent-fade-soft: rgba(var(--rgb-primary-color,33,150,243),0.08);  /* hover fill */
          --ltek-c-error-fade: rgba(244,67,54,0.15);         /* delete hover fill */
          /* Status colors — defer to the user's theme, fall back to Material. */
          --ltek-c-error: var(--error-color, #f44336);
          --ltek-c-success: var(--success-color, #4caf50);
          --ltek-c-warning: var(--warning-color, #ffb300);
          --ltek-c-info: var(--info-color, #2196F3);
          /* Second accent: the green "library / shared" grouping (distinct from
             the blue layout accent on purpose — NOT tied to --primary-color). */
          --ltek-c-accent-lib: #7fd18a;
          --ltek-c-on-accent: #fff;   /* text/icon on a solid accent fill */
          /* Action icons (edit/copy/hide/etc): neutral idle → brighten on hover.
             Delete stays a status color (error) on its own hover. */
          --ltek-c-icon: #aaa;        /* idle action icon */
          --ltek-c-icon-hover: #fff;  /* hovered action icon */
          /* Surfaces */
          --ltek-c-surface: rgba(255,255,255,0.015);        /* panels */
          --ltek-c-surface-raised: rgba(255,255,255,0.02);  /* cards / rows */
          /* Borders */
          --ltek-c-panel-border: #3a3a3a;   /* panels */
          --ltek-c-border: #444;            /* controls */
          --ltek-c-border-soft: #333;       /* subtle inner dividers */
          /* Radii */
          --ltek-r-panel: 12px;   /* panels */
          --ltek-r-card: 10px;    /* section cards */
          --ltek-r-md: 8px;       /* blocks */
          --ltek-r-ctrl: 6px;     /* inputs, selects, buttons */
          /* Spacing scale (4px base) */
          --ltek-sp-1: 4px;
          --ltek-sp-2: 6px;
          --ltek-sp-3: 8px;
          --ltek-sp-4: 10px;
          --ltek-sp-5: 12px;
          --ltek-sp-6: 16px;
          /* Control padding — uniform input/select/button height. */
          --ltek-ctrl-pad: 6px 10px;
          /* Icon sizes (two clear roles; one-off glyphs stay literal). */
          --ltek-icon-sm: 16px;   /* inline / action icons */
          --ltek-icon-lg: 20px;   /* panel-title icons */
          /* Slider row geometry (shared by every slider) */
          --ltek-slider-val-w: 44px;   /* value readout column width */
          display: flex; flex-direction: column; gap: 8px; font-family: var(--paper-font-body1_-_font-family, sans-serif);
        }
        .eane ha-icon { --mdc-icon-size: 18px; vertical-align: middle; }
        .eane-sec { border: 1px solid var(--ltek-c-panel-border); border-radius: var(--ltek-r-panel); background: var(--ltek-c-surface); overflow: hidden; }
        .eane-sec[open] { border-color: var(--ltek-c-accent); }
        .eane-sec > summary { display: flex; align-items: center; gap: var(--ltek-sp-3); padding: 14px 16px; cursor: pointer; user-select: none;
          list-style: none; font-size: var(--ltek-fs-panel-title); font-weight: var(--ltek-fw-bold); color: var(--ltek-c-text); }
        .eane-sec > summary::-webkit-details-marker, .eane-sub > summary::-webkit-details-marker { display: none; }
        .eane-sec > summary > ha-icon:not(.chev) { color: var(--ltek-c-accent); --mdc-icon-size: var(--ltek-icon-lg); }
        .eane-sec > summary .chev, .eane-sub > summary .chev { margin-left: auto; color: #999; --mdc-icon-size: 20px; transition: transform .2s ease; transform: rotate(-90deg); }
        .eane-sec[open] > summary .chev, .eane-sub[open] > summary .chev { transform: none; }
        .eane-body { padding: 0 16px 16px; }
        .eane-hint { color: var(--ltek-c-muted); font-size: var(--ltek-fs-small); margin: 0 0 var(--ltek-sp-3); }
        .eane-hint code { font-size: var(--ltek-fs-tiny); }
        .eane-group { color: var(--accent-color, var(--ltek-c-accent)); font-size: var(--ltek-fs-group); font-weight: var(--ltek-fw-semibold);
          margin-top: var(--ltek-sp-4); padding-top: var(--ltek-sp-3); border-top: 1px solid var(--ltek-c-border-soft); }
        .eane-group.first { margin-top: 0; padding-top: 0; border-top: none; }
        .eane-sub { border-top: 1px solid var(--ltek-c-border-soft); border-radius: var(--ltek-r-ctrl); }
        .eane-sub[open] { border: 1px solid var(--accent-color, var(--ltek-c-accent)); margin: var(--ltek-sp-1) 0; }
        .eane-sub > summary { display: flex; align-items: center; gap: var(--ltek-sp-2); padding: var(--ltek-sp-3) var(--ltek-sp-2); cursor: pointer;
          list-style: none; color: var(--ltek-c-accent); font-size: var(--ltek-fs-label); font-weight: var(--ltek-fw-semibold);
          text-transform: uppercase; letter-spacing: 0.04em; }
        .eane-sub-body { padding: 0 var(--ltek-sp-4) var(--ltek-sp-4); }
        .eane-row { display: flex; align-items: center; gap: var(--ltek-sp-4); padding: var(--ltek-sp-1) 0; flex-wrap: wrap; justify-content: flex-start; }
        .eane-row label.lbl { color: var(--ltek-c-label); font-size: var(--ltek-fs-body); font-weight: var(--ltek-fw-normal); flex: none; }
        .eane-row input[type="text"], .eane-row select { flex: 1 1 auto; min-width: 0; padding: var(--ltek-ctrl-pad);
          background: var(--secondary-background-color, #2a2a2a); border: 1px solid var(--ltek-c-border); border-radius: var(--ltek-r-ctrl);
          color: var(--ltek-c-text); font-size: var(--ltek-fs-body); }
        .eane-row input[type="range"] { flex: 1 1 auto; min-width: 100px; accent-color: var(--ltek-c-accent); cursor: pointer; }
        .eane-val { flex: 0 0 var(--ltek-slider-val-w); text-align: right; font-weight: var(--ltek-fw-bold); font-variant-numeric: tabular-nums;
          white-space: nowrap; color: var(--ltek-c-text); font-size: var(--ltek-fs-body); }
        .eane-nowrap { flex-wrap: nowrap; }
        .eane-check { display: flex; align-items: center; gap: var(--ltek-sp-2); padding: var(--ltek-sp-1) 0; color: var(--ltek-c-label);
          font-size: var(--ltek-fs-body); cursor: pointer; }
        .eane-check input { accent-color: var(--ltek-c-accent); }
        .eane-check .muted { color: var(--ltek-c-muted); font-size: var(--ltek-fs-small); }
        .eane-checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 0 var(--ltek-sp-4); }
        .eane-color { display: flex; flex: 1 1 auto; gap: var(--ltek-sp-2); flex-wrap: wrap; min-width: 0; }
        .eane-color select.eane-cmode { flex: 0 0 auto; min-width: 120px; }
        .eane-color input[type="color"] { flex: 0 0 auto; width: 44px; height: 30px; padding: 0; border: none; background: none; cursor: pointer; }
        .eane-reset { border: none; background: none; padding: 0; color: var(--ltek-c-icon); cursor: pointer; }
        .eane-reset:hover { color: var(--ltek-c-icon-hover); }
        .eane-reset ha-icon { --mdc-icon-size: var(--ltek-icon-sm); }
        .eane-list { display: flex; flex-direction: column; gap: var(--ltek-sp-2); }
        .eane-item { display: flex; align-items: center; gap: var(--ltek-sp-2); padding: var(--ltek-sp-2) var(--ltek-sp-3);
          background: var(--ltek-c-surface-raised); border-radius: var(--ltek-r-card); }
        .eane-item input[type="text"] { flex: 1 1 0; min-width: 0; padding: var(--ltek-ctrl-pad); background: var(--secondary-background-color, #2a2a2a);
          border: 1px solid var(--ltek-c-border); border-radius: var(--ltek-r-ctrl); color: var(--ltek-c-text); font-size: var(--ltek-fs-body); }
        .eane-item > ha-icon { color: var(--ltek-c-accent); --mdc-icon-size: var(--ltek-icon-lg); flex: none; }
        .eane-del { border: none; background: none; padding: 0; cursor: pointer; color: var(--ltek-c-icon); flex: none; line-height: 0; }
        .eane-del ha-icon { --mdc-icon-size: var(--ltek-icon-sm); }
        .eane-del:hover { color: var(--ltek-c-error); }
        .eane-add { align-self: flex-start; padding: var(--ltek-ctrl-pad); border: 1px dashed var(--ltek-c-accent); border-radius: var(--ltek-r-ctrl);
          background: transparent; color: var(--ltek-c-accent); font-size: var(--ltek-fs-body); font-weight: var(--ltek-fw-semibold); cursor: pointer; }
        .eane-add:hover { background: var(--ltek-c-accent-fade-soft); }
        .eane-foot { color: var(--ltek-c-muted); font-size: var(--ltek-fs-tiny); text-align: right; }
        .eane-name { flex: 1 1 auto; min-width: 0; color: var(--ltek-c-text); font-size: var(--ltek-fs-label); font-weight: var(--ltek-fw-normal);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .eane-badge { flex: none; color: var(--ltek-c-muted); font-size: var(--ltek-fs-tiny); font-variant-numeric: tabular-nums;
          border: 1px solid var(--ltek-c-border); border-radius: var(--ltek-r-ctrl); padding: 0 var(--ltek-sp-1); }
        .eane-act { border: none; background: none; padding: 0; cursor: pointer; color: var(--ltek-c-icon); flex: none; line-height: 0; }
        .eane-act:hover { color: var(--ltek-c-icon-hover); }
        .eane-act.on { color: var(--ltek-c-accent); }
        .eane-act:disabled { opacity: .3; cursor: default; }
        .eane-act ha-icon { --mdc-icon-size: var(--ltek-icon-sm); }
        .eane-item.off .eane-name, .eane-item.off > ha-icon { opacity: .45; }
        .eane-warn { color: var(--ltek-c-warning); }
`;

// Settings that show or hide other settings: changing one re-renders the editor.
const REVEAL_KEYS = new Set(['send_with', 'presets_entity', 'show_message_box', 'speaker_source', 'hide_unavailable', 'tap_action', 'preset_style']);

class EasyAnnounceCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._open = new Set(['sending']);
    this._rendered = false;
    this._cmode = {}; // color key → mode chosen this session (keeps an empty Custom CSS field visible)
  }

  setConfig(config) {
    const next = normalizeConfig(config);
    const changed = JSON.stringify(next) !== JSON.stringify(this._config);
    this._config = next;
    if (!this._rendered || changed) this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._render();
  }

  _emit() {
    this._config = normalizeConfig(this._config);
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
  }

  /** Write a value; empty or default removes the key (byte-stable YAML). */
  _set(key, value) {
    if (key === 'title' && value === '') { this._config.title = ''; this._emit(); return; } // empty title = no title line
    if (value === '' || value === undefined || value === null || isDefault(key, value)) delete this._config[key];
    else this._config[key] = value;
    this._emit();
  }

  _c(key) { return cfg(this._config, key); }

  _ids(domain) { return this._hass ? Object.keys(this._hass.states).filter((id) => id.startsWith(`${domain}.`)).sort() : []; }

  _panel(id, icon, title, body) {
    return `<details class="eane-sec" data-panel="${id}"${this._open.has(id) ? ' open' : ''}>
      <summary><ha-icon icon="${icon}"></ha-icon>${title}<ha-icon class="chev" icon="mdi:chevron-down"></ha-icon></summary>
      <div class="eane-body">${body}</div></details>`;
  }

  _sub(id, title, body) {
    return `<details class="eane-sub" data-panel="${id}"${this._open.has(id) ? ' open' : ''}>
      <summary>${title}<ha-icon class="chev" icon="mdi:chevron-down"></ha-icon></summary>
      <div class="eane-sub-body">${body}</div></details>`;
  }

  _check(key, label, hint = '') {
    return `<label class="eane-check"><input type="checkbox" data-key="${key}"${this._c(key) ? ' checked' : ''}>${label}${
      hint ? ` <span class="muted">${hint}</span>` : ''}</label>`;
  }

  _text(key, label, placeholder = '', list = '') {
    const v = this._config[key] !== undefined ? this._config[key] : '';
    return `<div class="eane-row"><label class="lbl">${label}</label><input type="text" data-key="${key}" value="${esc(v)}" placeholder="${esc(placeholder)}"${
      list ? ` list="${list}"` : ''}></div>`;
  }

  _select(key, label, options) {
    const cur = this._c(key);
    return `<div class="eane-row"><label class="lbl">${label}</label><select data-key="${key}">${
      options.map(([v, n]) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>`;
  }

  _slider(key, label, min, max, fmt = (n) => `${n}px`) {
    const v = Number(this._c(key));
    return `<div class="eane-row eane-nowrap"><label class="lbl">${label}</label>
      <input type="range" data-skey="${key}" min="${min}" max="${max}" step="1" value="${v}">
      <span class="eane-val" data-val="${key}">${fmt(v)}</span>
      ${this._config[key] !== undefined ? `<button class="eane-reset" data-reset="${key}" title="Back to default"><ha-icon icon="mdi:restore"></ha-icon></button>` : ''}</div>`;
  }

  _datalist(id, ids) { return `<datalist id="${id}">${ids.map((x) => `<option value="${esc(x)}"></option>`).join('')}</datalist>`; }

  _colorControl(key) {
    const [, label, defaultLabel, seedHex] = COLOR_DEFS.find((d) => d[0] === key);
    const cur = this._config[key] || '';
    const mode = this._cmode[key] || colorMode(cur);
    let field = '';
    if (mode === 'theme') {
      field = `<select class="eane-ctheme" data-ckey="${key}">${THEME_COLORS.map(([v, n]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
    } else if (mode === 'custom') {
      field = `<input type="color" class="eane-chex" data-ckey="${key}" value="${/^#[0-9a-fA-F]{6}$/.test(cur) ? cur : seedHex}">`;
    } else if (mode === 'css') {
      field = `<input type="text" class="eane-ccss" data-ckey="${key}" value="${esc(cur)}" placeholder="e.g. tomato, rgba(…), var(--my-color)">`;
    }
    const modes = [['default', defaultLabel], ['theme', 'Theme color'], ['custom', 'Custom color'], ['css', 'Custom CSS']];
    return `<div class="eane-row"><label class="lbl">${label}</label><div class="eane-color">
      <select class="eane-cmode" data-ckey="${key}" data-seed="${seedHex}">${modes.map(([m, n]) => `<option value="${m}"${m === mode ? ' selected' : ''}>${n}</option>`).join('')}</select>
      ${field}</div></div>`;
  }

  /** An editable list of strings (include / exclude / strip_words). */
  _list(key, addLabel, placeholder, listId = '') {
    const items = this._config[key] || [];
    return `<div class="eane-list">
      <button class="eane-add" data-list-add="${key}">+ ${addLabel}</button>
      ${items.map((w, i) => `<div class="eane-item"><input type="text" data-list="${key}" data-i="${i}" value="${esc(w)}" placeholder="${esc(placeholder)}"${
    listId ? ` list="${listId}"` : ''}>
        <button class="eane-del" data-list-del="${key}" data-i="${i}" title="Remove"><ha-icon icon="mdi:trash-can-outline"></ha-icon></button></div>`).join('')}
    </div>`;
  }

  _sendingBody() {
    const script = this._c('send_with') === 'script';
    return `<p class="eane-hint">How the card sends an announcement. Either way it's one call with every selected speaker as the target.</p>
      ${this._select('send_with', 'Send with', [['notify', 'Alexa Media Player (notify)'], ['script', 'A script']])}
      ${script
    ? `${this._text('script', 'Script', 'script.alexa_announcement_routing', 'eane-scripts')}${this._datalist('eane-scripts', this._ids('script'))}
      <p class="eane-hint">Called with <code>message</code> (the text) and <code>target</code> (a list of media player IDs). Automations can call the
        same script, so both send the same way.</p>`
    : `${this._text('notify_service', 'Notify service', DEFAULTS.notify_service)}
      ${this._select('announce_type', 'Type', [['announce', 'Announce (chime first)'], ['tts', 'Speak (no chime)']])}
      <p class="eane-hint">Calls <code>${esc(this._c('notify_service'))}</code> with <code>data: { type: ${esc(this._c('announce_type'))} }</code>.</p>`}
      ${setupProblem(this._config) ? `<p class="eane-hint eane-warn">${esc(setupProblem(this._config))}</p>` : ''}`;
  }

  _messagesBody() {
    const p = readPresets(this._hass, this._config);
    const id = this._config.presets_entity;
    let found = '';
    if (id && this._hass) {
      found = !p.exists ? `<p class="eane-hint eane-warn">${esc(id)} doesn't exist.</p>`
        : `<p class="eane-hint"><b>${p.options.length}</b> preset${p.options.length === 1 ? '' : 's'}${p.all.length > p.options.length ? ` (placeholders like "---" are skipped)` : ''}.${
          p.editable ? '' : ' This helper is set up in YAML, so the card can show its presets but not change them.'}</p>`;
    }
    return `<p class="eane-hint">Presets are the options of an <code>input_select</code>. Tap one to put it in the message box.</p>
      ${this._text('presets_entity', 'Presets helper', 'input_select.alexa_announcement_text', 'eane-selects')}${this._datalist('eane-selects', this._ids('input_select'))}
      ${found}
      ${id ? `${this._select('preset_style', 'Show presets as', [['chips', 'Chips'], ['dropdown', 'Dropdown']])}
      ${this._check('allow_edit_presets', 'Save and delete presets from the card', '(admins only)')}` : ''}
      <div class="eane-group">Message box</div>
      ${this._check('show_message_box', 'Show the message box and Send button')}
      ${this._c('show_message_box') ? this._check('clear_after_send', 'Clear the message after sending')
    : '<p class="eane-hint">Without the box, tapping a preset announces it on the selected speakers.</p>'}`;
  }

  _speakersBody() {
    const list = this._hass ? discoverSpeakers(this._hass, this._config) : [];
    const shown = this._hass ? `<p class="eane-hint">Showing <b>${list.length}</b>: ${list.slice(0, 12).map((s) => esc(s.name)).join(', ')}${list.length > 12 ? ', …' : ''}</p>` : '';
    return `<p class="eane-hint">The card finds the speakers itself. Tap a speaker on the card to select it.</p>
      ${this._select('speaker_source', 'Find', [['alexa', 'Alexa Media Player speakers'], ['all', 'Every media player']])}
      ${this._check('hide_unavailable', 'Hide offline speakers')}
      ${shown}
      <div class="eane-group">Leave out</div>
      <p class="eane-hint">Matched against the entity ID, the name and the integration. <code>*</code> matches anything:
        <code>*Phone*</code>, <code>This Device*</code>, <code>media_player.*_group</code>.</p>
      ${this._list('exclude', 'Pattern', '*kitchen*')}
      <div class="eane-group">Always add</div>
      <p class="eane-hint">Media players to show even if the rules above would leave them out.</p>
      ${this._list('include', 'Speaker', 'media_player.office', 'eane-players')}${this._datalist('eane-players', this._ids('media_player'))}
      <div class="eane-group">Names</div>
      <p class="eane-hint">Words to drop from speaker names ("Kitchen Echo" → "Kitchen" without "Echo").</p>
      ${this._list('strip_words', 'Word', 'Echo')}`;
  }

  _layoutBody() {
    return `${this._text('title', 'Title', DEFAULT_TITLE)}
      <p class="eane-hint">Clear the title to hide it.</p>
      <div class="eane-group">Speakers</div>
      ${this._slider('columns', 'Columns', 0, 6, (n) => (Number(n) ? String(n) : 'Auto'))}
      ${this._select('tap_action', 'Tapping a speaker', [['select', 'Selects it (then press Send)'], ['send', 'Announces on it straight away']])}
      ${this._check('show_state', 'Show what each speaker is doing', '(Idle, Playing · song)')}
      ${this._c('tap_action') === 'select' ? `${this._check('show_select_all', 'All / None buttons')}
      ${this._check('remember_selection', 'Remember the selected speakers', '(in this browser)')}` : ''}`;
  }

  _lookBody() {
    const c = (k) => this._colorControl(k);
    const s = (k) => { const d = SIZE_DEFS.find((x) => x[0] === k); return this._slider(k, d[1], d[2], d[3]); };
    return `<p class="eane-hint">Sizes and colors. Every color can follow your theme or be custom; ↺ puts a size back to its default.</p>
      ${this._sub('look-text', 'Text', [s('font_size_title'), c('color_title'), s('font_size_message'), c('color_preset')].join(''))}
      ${this._sub('look-speakers', 'Speakers', [s('font_size_name'), s('icon_size'), c('color_icon'), c('color_selected')].join(''))}
      ${this._sub('look-send', 'Send button', c('color_send'))}`;
  }

  _render() {
    // Keep focus and caret in a text field across the redraw.
    const ae = document.activeElement && this.contains(document.activeElement) ? document.activeElement : null;
    const focus = ae && (ae.dataset.key ? `[data-key="${ae.dataset.key}"]` : ae.dataset.list ? `[data-list="${ae.dataset.list}"][data-i="${ae.dataset.i}"]` : null);
    let caret = null;
    try { caret = focus && ae.selectionStart != null ? [ae.selectionStart, ae.selectionEnd] : null; } catch (e) { caret = null; }
    this.innerHTML = `<style>${EDITOR_CSS}</style>
      <div class="eane">
        ${this._panel('sending', 'mdi:bullhorn-outline', 'Sending', this._sendingBody())}
        ${this._panel('messages', 'mdi:message-text-outline', 'Messages & presets', this._messagesBody())}
        ${this._panel('speakers', 'mdi:speaker-multiple', 'Speakers', this._speakersBody())}
        ${this._panel('layout', 'mdi:view-grid-outline', 'Title & layout', this._layoutBody())}
        ${this._panel('look', 'mdi:palette', 'Appearance', this._lookBody())}
        <div class="eane-foot">Easy Announce Card ${BUILD_NUMBER}</div>
      </div>`;
    this._rendered = true;
    this._wire();
    if (focus) {
      const el = this.querySelector(focus);
      if (el) { el.focus(); if (caret) try { el.setSelectionRange(caret[0], caret[1]); } catch (e) { /* not a text field */ } }
    }
  }

  _wire() {
    const all = (sel, fn) => this.querySelectorAll(sel).forEach(fn);
    all('details.eane-sec, details.eane-sub', (d) => d.addEventListener('toggle', () => {
      if (d.open) this._open.add(d.dataset.panel); else this._open.delete(d.dataset.panel);
    }));
    all('[data-key]', (el) => el.addEventListener('change', () => {
      const key = el.dataset.key;
      this._set(key, el.type === 'checkbox' ? el.checked : el.value.trim());
      if (REVEAL_KEYS.has(key) || key === 'script' || key === 'notify_service' || key === 'announce_type') this._render();
    }));
    all('[data-skey]', (el) => {
      const key = el.dataset.skey;
      const out = () => this.querySelector(`[data-val="${key}"]`);
      el.addEventListener('input', () => { const o = out(); if (o) o.textContent = key === 'columns' ? (Number(el.value) ? el.value : 'Auto') : `${el.value}px`; });
      el.addEventListener('change', () => { this._set(key, Number(el.value)); this._render(); });
    });
    all('[data-reset]', (b) => b.addEventListener('click', () => { this._set(b.dataset.reset, ''); this._render(); }));
    // String lists
    const saveList = (key, list, redraw = true) => { this._config[key] = list; this._emit(); if (redraw) this._render(); };
    all('[data-list]', (el) => el.addEventListener('change', () => {
      const key = el.dataset.list;
      const list = [...(this._config[key] || [])];
      list[Number(el.dataset.i)] = el.value.trim();
      saveList(key, list.filter(Boolean));
    }));
    all('[data-list-del]', (b) => b.addEventListener('click', () => {
      const key = b.dataset.listDel;
      saveList(key, (this._config[key] || []).filter((_, j) => j !== Number(b.dataset.i)));
    }));
    all('[data-list-add]', (b) => b.addEventListener('click', () => {
      const key = b.dataset.listAdd;
      // An empty row isn't saved until something is typed in it (normalize drops blanks).
      this._config[key] = [...(this._config[key] || []), ''];
      this._render();
      const inputs = this.querySelectorAll(`[data-list="${key}"]`);
      if (inputs.length) inputs[inputs.length - 1].focus();
    }));
    // Colors (four-mode control)
    all('.eane-cmode', (sel) => sel.addEventListener('change', () => {
      const key = sel.dataset.ckey;
      const cur = this._config[key] || '';
      const was = colorMode(cur);
      let next = '';
      // Seed the new mode from the old value; never drop the user's color on a mode change.
      if (sel.value === 'theme') next = was === 'theme' ? cur : 'var(--primary-color)';
      else if (sel.value === 'custom') next = /^#[0-9a-fA-F]{6}$/.test(cur) ? cur : sel.dataset.seed;
      else if (sel.value === 'css') next = cur;
      this._cmode[key] = sel.value;
      this._set(key, next);
      this._render();
    }));
    all('.eane-ctheme', (el) => el.addEventListener('change', () => this._set(el.dataset.ckey, el.value)));
    all('.eane-chex', (el) => el.addEventListener('input', () => this._set(el.dataset.ckey, el.value)));
    all('.eane-ccss', (el) => el.addEventListener('change', () => this._set(el.dataset.ckey, el.value.trim())));
  }
}

// Test hooks (pure helpers; no effect in the browser)
EasyAnnounceCard._test = {
  BUILD_NUMBER, VERSION, CARD_CSS, EDITOR_CSS, DEFAULTS, COLOR_DEFS, VIEWS,
  normalizeConfig, discoverSpeakers, cleanName, globRe, excluded, readPresets, planOptions, isPlaceholder,
  buildCall, setupProblem, rootStyleVars, colorMode, speakerState, viewKey,
};

if (!customElements.get(CARD_TAG)) customElements.define(CARD_TAG, EasyAnnounceCard);
if (!customElements.get(EDITOR_TAG)) customElements.define(EDITOR_TAG, EasyAnnounceCardEditor);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === CARD_TAG)) {
  window.customCards.push({
    type: CARD_TAG,
    name: 'Easy Announce Card (Ltek)',
    description: 'Send an Alexa announcement to the speakers you pick, from presets or typed text.',
    preview: false,
    documentationURL: 'https://github.com/Ltek/easy-announce-card',
  });
}

console.info(`%c EASY-ANNOUNCE-CARD %c ${BUILD_NUMBER} `, 'color:#fff;background:#2196F3;font-weight:700', 'color:#2196F3;background:transparent');
