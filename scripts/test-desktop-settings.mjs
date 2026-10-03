#!/usr/bin/env node
// Execute the real component against deferred IPC doubles, without a browser,
// native settings, persistent configuration or real login registration.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const source = await readFile(new URL('../src/components/settings/DesktopSettings.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText;
const off = { platform: 'macos', tray_available: true, autostart_supported: true, launch_at_login: false, hide_dock_icon: false, start_minimized: false };
const on = { ...off, hide_dock_icon: true };
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function settle() { for (let i = 0; i < 25; i++) await Promise.resolve(); }
function walk(node, predicate, found = []) {
  if (Array.isArray(node)) node.forEach(child => walk(child, predicate, found));
  else if (node && typeof node === 'object') { if (predicate(node)) found.push(node); walk(node.props?.children, predicate, found); }
  return found;
}
function harness() {
  const states = [], refs = [], effects = [], cleanup = [], calls = [], handlers = new Map();
  let si = 0, ri = 0, ei = 0, mounted = false, configLoads = 0;
  let handler = async () => off;
  const imports = {
    react: {
      useState(initial) { const i = si++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; },
      useRef(initial) { const i = ri++; return refs[i] ?? (refs[i] = { current: initial }); },
      useCallback: fn => fn,
      useEffect(fn) { const i = ei++; if (!mounted) effects[i] = fn; },
    },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'lucide-react': { Loader2: 'Loader2', PanelTop: 'PanelTop', RefreshCw: 'RefreshCw' },
    'react-i18next': { useTranslation: () => ({ i18n: { language: 'en' } }) },
    '../../utils/env': { isTauri: () => true },
    '../../utils/request': { request(command, args) { calls.push({ command, args }); return handler(command, args); } },
    '../../stores/useConfigStore': { useConfigStore: select => select({ loadConfig: async () => { configLoads++; } }) },
    '../menubar/messages': { getMenuBarMessages: () => new Proxy({}, { get: (_, key) => key }) },
  };
  const module = { exports: {} };
  runInNewContext(compiled, {
    exports: module.exports,
    require(name) { assert.ok(name in imports, name); return imports[name]; },
    window: { addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name) },
  });
  function render() { si = ri = ei = 0; return module.exports.default(); }
  return {
    async mount() { render(); mounted = true; effects.forEach(fn => cleanup.push(fn())); await settle(); },
    unmount() { cleanup.forEach(fn => fn?.()); },
    focus() { handlers.get('focus')?.(); },
    button() { return walk(render(), node => node.props?.id === 'desktop-hide_dock_icon')[0]; },
    setHandler(fn) { handler = fn; }, render, calls,
    get status() { return states[0]; }, get busy() { return states[1]; }, get error() { return states[2]; }, get configLoads() { return configLoads; },
  };
}
let passed = 0;
async function test(name, body) { await body(); console.log(`ok ${++passed} - ${name}`); }
for (const fails of [false, true]) {
  await test(`older focus ${fails ? 'failure' : 'result'} cannot override a newer preference result`, async () => {
    const h = harness(); await h.mount(); const old = deferred();
    h.setHandler(command => command === 'get_desktop_settings' ? old.promise : Promise.resolve(on));
    h.focus(); h.button().props.onClick(); await settle();
    assert.equal(h.status.hide_dock_icon, true); assert.equal(h.configLoads, 1);
    if (fails) old.reject('stale read failed'); else old.resolve(off);
    await settle(); assert.equal(h.status.hide_dock_icon, true); assert.equal(h.error, ''); h.unmount();
  });
}
await test('same-render double click and focus cannot duplicate the in-flight setter', async () => {
  const h = harness(); await h.mount(); const save = deferred(); h.setHandler(() => save.promise);
  const click = h.button().props.onClick; click(); click(); h.focus();
  assert.equal(h.calls.filter(call => call.command === 'set_desktop_preferences').length, 1);
  save.resolve(on); await settle(); assert.equal(h.busy, null); h.unmount();
});
await test('failed native recovery remains explicit after reconciliation and focus reload', async () => {
  const h = harness(); await h.mount(); const uncertain = { ...off, dock_error: 'native recovery failed' };
  h.setHandler(command => command === 'set_desktop_preferences' ? Promise.reject('save failed; Dock rollback failed') : Promise.resolve(uncertain));
  h.button().props.onClick(); await settle();
  assert.equal(h.status.dock_error, 'native recovery failed'); assert.match(h.error, /Dock rollback failed/);
  h.focus(); await settle(); assert.equal(h.status.dock_error, 'native recovery failed');
  assert.ok(walk(h.render(), node => node.props?.role === 'alert').length); h.unmount();
});
await test('unmount prevents pending status and preference responses from writing state', async () => {
  const h = harness(); await h.mount(); const save = deferred(); h.setHandler(() => save.promise);
  h.button().props.onClick(); h.unmount(); save.resolve(on); await settle();
  assert.equal(h.status.hide_dock_icon, false); assert.equal(h.configLoads, 0);
});
await test('menu bar and login preferences are editable and update correctly', async () => {
  const h = harness(); let preferences = { ...off };
  h.setHandler(async (command, args) => {
    if (command === 'set_desktop_preferences') preferences = { ...preferences, ...args.patch };
    return { ...preferences };
  });
  const toggle = key => walk(h.render(), node => node.props?.id === `desktop-${key}`)[0];
  await h.mount();
  assert.equal(toggle('hide_dock_icon').props.disabled, false);
  toggle('hide_dock_icon').props.onClick(); await settle();
  assert.equal(h.status.hide_dock_icon, true);
  assert.equal(h.status.start_minimized, true);
  assert.equal(toggle('hide_dock_icon').props['aria-checked'], true);
  toggle('launch_at_login').props.onClick(); await settle();
  assert.equal(h.status.launch_at_login, true);
  assert.equal(h.status.hide_dock_icon, true);
  assert.equal(toggle('hide_dock_icon').props.disabled, false);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.filter(c => c.command === 'set_desktop_preferences').map(c => c.args.patch))), [
    { hide_dock_icon: true, start_minimized: true }, { launch_at_login: true },
  ]);
  assert.equal(h.configLoads, 2); h.unmount();
});
console.log(`Desktop Settings tests: ${passed} passed`);
