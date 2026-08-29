/* Ephemeral smoke test — mocks the DOM, loads charts+sections+app in one shared
   VM scope (as the browser <script> tags do), and exercises the customizer +
   render pipeline. Not shipped; deleted after running. */
'use strict';
const fs = require('fs');
const vm = require('vm');

const DIR = 'd:/torn site 2';
const read = (f) => fs.readFileSync(`${DIR}/${f}`, 'utf8');

/* ---- DOM mock ---- */
function makeEl(id) {
  const e = {
    id, innerHTML: '', textContent: '', value: '', type: 'text',
    disabled: false, hidden: false, checked: false, className: '', title: '',
    offsetWidth: 100, offsetHeight: 40, style: {}, dataset: {},
    children: [], childNodes: [], firstChild: null,
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, f) { const on = f === undefined ? !this._s.has(c) : f; on ? this._s.add(c) : this._s.delete(c); return on; },
      contains(c) { return this._s.has(c); },
    },
    addEventListener() {}, removeEventListener() {},
    setAttribute(k, v) { this['attr_' + k] = v; }, getAttribute(k) { return this['attr_' + k] ?? null; },
    removeAttribute(k) { delete this['attr_' + k]; }, hasAttribute(k) { return ('attr_' + k) in this; },
    querySelector() { return makeEl('q'); }, querySelectorAll() { return []; },
    closest() { return null; },
    appendChild(c) { this.children.push(c); return c; }, removeChild() {}, prepend() {}, insertBefore() {},
    focus() {}, blur() {}, click() {}, scrollIntoView() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 100, right: 100, bottom: 100 }; },
  };
  return e;
}
const elemCache = {};
const document = {
  _els: elemCache,
  querySelector(sel) { return (elemCache[sel] ||= makeEl(sel)); },
  querySelectorAll() { return []; },
  createElement() { return makeEl('created'); },
  addEventListener() {}, removeEventListener() {},
  documentElement: makeEl('html'),
  body: makeEl('body'),
  hidden: false, visibilityState: 'visible',
};

const store = {};
const localStorage = {
  getItem(k) { return k in store ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; },
};

const errors = [];
const sandbox = {
  document, localStorage,
  console: { log: () => {}, warn: () => {}, error: (...a) => errors.push(a.map(String).join(' ')) },
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
  Date, Math, JSON, Number, String, Array, Object, Set, Map, isNaN, parseInt, parseFloat, RegExp,
  navigator: { userAgent: 'node' },
  location: { href: '', reload() {} },
  requestAnimationFrame: (cb) => setTimeout(cb, 0), cancelAnimationFrame: () => {},
  fetch: () => Promise.reject(new Error('no network in smoke test')),
  URL,
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const ctxObj = vm.createContext(sandbox);

/* ---- Load the three scripts into one shared scope (browser order) ---- */
const combined = read('charts.js') + '\n' + read('sections.js') + '\n' + read('app.js') +
  '\n;globalThis.__TD = { state, SECTIONS, CATEGORIES, OVERVIEW_SELECTIONS, buildSelections,' +
  ' visibleCategories, resolveActiveTab, customizeGroupsHTML, applyToggle, applyBulk,' +
  ' renderProfile, renderOverview, renderSettings, ctx, render };';
let loadOk = true;
try {
  vm.runInContext(combined, ctxObj, { filename: 'combined.js' });
} catch (e) {
  loadOk = false;
  console.log('LOAD FAILED:', e.message);
  console.log(e.stack.split('\n').slice(0, 4).join('\n'));
  process.exit(1);
}
console.log('load: OK');

/* Pull references out of the sandbox */
const S = ctxObj;
const results = [];
const check = (name, cond, extra = '') => { results.push({ name, ok: !!cond, extra }); };

/* 1. registry present */
check('SECTIONS is array', Array.isArray(S.SECTIONS));
check('CATEGORIES is array', Array.isArray(S.CATEGORIES));
check('buildSelections is fn', typeof S.buildSelections === 'function');
check('customizeGroupsHTML is fn', typeof S.customizeGroupsHTML === 'function');
check('applyToggle is fn', typeof S.applyToggle === 'function');
check('applyBulk is fn', typeof S.applyBulk === 'function');

/* 2. base selections always include profile */
check('buildSelections includes profile', S.buildSelections().split(',').includes('profile'));

/* 3. USER SCENARIO: none, then only three sections, profile + overview off */
S.applyBulk('none');
check('none → enabled empty', S.state.enabled.size === 0);
check('none → profile off', S.state.showProfile === false);
check('none → overview off', S.state.showOverview === false);
{
  const sel = S.buildSelections().split(',');
  check('none → selections == [profile] only', sel.length === 1 && sel[0] === 'profile', sel.join(','));
  const vis = S.visibleCategories().map((c) => c.id);
  check('none → overview tab hidden', !vis.includes('overview'), vis.join(','));
  check('none → settings tab visible', vis.includes('settings'), vis.join(','));
}

/* enable the three the user named: networth, battlestats, workstats (by selection) */
const wanted = ['networth', 'battlestats', 'workstats'];
const picked = [];
for (const want of wanted) {
  const s = S.SECTIONS.find((x) => (x.selections || []).includes(want));
  if (s) { S.applyToggle(s.id, true); picked.push(s.id); }
}
check('picked 3 sections', picked.length === 3, picked.join(','));
{
  const sel = new Set(S.buildSelections().split(','));
  check('selections include networth', sel.has('networth'));
  check('selections include battlestats', sel.has('battlestats'));
  check('selections include workstats', sel.has('workstats'));
  check('selections do NOT include bars (overview-only, off)', !sel.has('bars'), [...sel].join(','));
  const vis = S.visibleCategories().map((c) => c.id);
  check('overview still hidden (showOverview off)', !vis.includes('overview'), vis.join(','));
}

/* resolveActiveTab must move off the now-hidden overview */
S.state.activeTab = 'overview';
S.resolveActiveTab();
check('resolveActiveTab left overview', S.state.activeTab !== 'overview', S.state.activeTab);

/* 4. customizeGroupsHTML reflects state + has Layout group */
{
  const html = S.customizeGroupsHTML();
  check('groups html has Layout', /Layout/.test(html));
  check('groups html has Profile banner toggle', /__profile/.test(html) && /Profile banner/.test(html));
  check('groups html has Overview toggle', /__overview/.test(html));
  check('profile toggle NOT is-on (off)', /data-toggle="__profile"/.test(html) && !/is-on[^>]*__profile|__profile[^>]*is-on/.test(html.replace(/\n/g, '')));
}

/* 5. every renderer survives an EMPTY payload (graceful degradation) */
S.state.data = {};
S.state.ref = null;
let renderFails = 0;
const emptyStr = (fn, label) => {
  try { const out = fn(); if (typeof out !== 'string') { renderFails++; console.log('  non-string:', label); } }
  catch (e) { renderFails++; console.log('  THREW:', label, e.message); }
};
emptyStr(() => S.renderProfile({}), 'renderProfile');
emptyStr(() => S.renderOverview({}, S.ctx()), 'renderOverview');
emptyStr(() => S.renderSettings(), 'renderSettings');
for (const s of S.SECTIONS) emptyStr(() => s.render({}, S.ctx()), 'section:' + s.id);
check(`all renderers survive {} (${S.SECTIONS.length + 3} renderers)`, renderFails === 0, renderFails + ' failed');

/* 6. full render() pipeline with empty data — no throw */
let pipeOk = true;
try { S.applyBulk('default'); S.state.data = {}; S.render(); } catch (e) { pipeOk = false; console.log('  render() threw:', e.message); }
check('render() pipeline (defaults, empty data)', pipeOk);

/* 7. bulk round-trip */
S.applyBulk('all');
check('all → every section enabled', S.state.enabled.size === S.SECTIONS.length);
check('all → profile on', S.state.showProfile === true);
S.applyBulk('default');
const defCount = S.SECTIONS.filter((s) => s.defaultOn).length;
check('default → defaultOn count', S.state.enabled.size === defCount, `${S.state.enabled.size} vs ${defCount}`);

/* safeRender internal errors captured via console.error */
check('no internal render errors logged', errors.length === 0, errors.slice(0, 3).join(' | '));

/* ---- report ---- */
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; }
  else { fail++; console.log(`FAIL  ${r.name}  ${r.extra ? '(' + r.extra + ')' : ''}`); }
}
console.log(`\n${pass}/${pass + fail} checks passed${fail ? `, ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
