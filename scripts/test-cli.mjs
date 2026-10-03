// Real executable smoke tests with synthetic local files. No OAuth or switch calls.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const binary = resolve(process.argv[2] ?? 'src-tauri/target/debug/antigravity-tools');
const root = mkdtempSync(join(tmpdir(), 'agy-lite-cli-'));
const data = join(root, 'data');
const env = { ...process.env, ABV_DATA_DIR: data, DISPLAY: '', WAYLAND_DISPLAY: '' };
let passed = 0;
function run(args, code = 0, exe = binary) {
  const result = spawnSync(exe, args, { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined, 'CLI must exit without a display');
  assert.equal(result.status, code, `${args.join(' ')}: ${result.stderr}`);
  assert.ok(!`${result.stdout}${result.stderr}`.includes('FIXTURE-SECRET'));
  passed++;
  return result;
}
try {
  assert.match(run(['--version']).stdout, /^(agy-switch|agy-lite) \d+\.\d+\.\d+/);
  assert.match(run(['--help']).stdout, /cached data/);
  assert.deepEqual(JSON.parse(run(['accounts', 'list', '--json']).stdout).accounts, []);
  assert.deepEqual(readdirSync(root), []); // Not even a log/data directory is created.
  run(['current'], 3);
  run(['quota', '--refresh'], 2);
  run(['switch', 'unused', '--target', 'cli', '--json'], 2);
  assert.deepEqual(readdirSync(root), []); // Unsupported target must fail before any state access.
  assert.equal(JSON.parse(run(['--unknown', '--json'], 2).stderr).error.code, 2);
  mkdirSync(join(data, 'accounts'), { recursive: true });
  const index = JSON.stringify({ accounts: [{ id: 'test-1' }], current_account_id: 'test-1', current_target_ide: 'agy' });
  const account = JSON.stringify({ id: 'test-1', email: 'test@example.invalid', token: { access_token: 'FIXTURE-SECRET-ACCESS', refresh_token: 'FIXTURE-SECRET-REFRESH' }, quota: { last_updated: 123, models: [{ name: 'test-model', percentage: 75, reset_time: '2030-01-01T00:00:00Z' }] } });
  writeFileSync(join(data, 'accounts.json'), index);
  writeFileSync(join(data, 'accounts/test-1.json'), account);
  assert.equal(JSON.parse(run(['current', '--json']).stdout).account.id, 'test-1');
  assert.equal(JSON.parse(run(['quota', '--json']).stdout).quota.models[0].percentage, 75);
  assert.match(run(['quota', 'TEST@example.invalid']).stdout, /75% remaining/);
  run(['quota', 'missing@example.invalid'], 3);
  assert.equal(readFileSync(join(data, 'accounts.json'), 'utf8'), index);
  assert.equal(readFileSync(join(data, 'accounts/test-1.json'), 'utf8'), account);
  assert.deepEqual(readdirSync(data).sort(), ['accounts', 'accounts.json']);
  const noQuota = JSON.parse(account); delete noQuota.quota;
  writeFileSync(join(data, 'accounts/test-1.json'), JSON.stringify(noQuota));
  run(['quota'], 4);
  writeFileSync(join(data, 'accounts.json'), 'corrupt');
  run(['list', '--json'], 1);
  assert.equal(readFileSync(join(data, 'accounts.json'), 'utf8'), 'corrupt');
  if (process.platform !== 'win32') {
    const linkSwitch = join(root, 'agy-switch'); symlinkSync(binary, linkSwitch);
    assert.match(run([], 0, linkSwitch).stdout, /Usage:/);
    const linkLite = join(root, 'agy-lite'); symlinkSync(binary, linkLite);
    assert.match(run([], 0, linkLite).stdout, /Usage:/);
  }
  console.log(`${passed} CLI executable smoke checks passed; no GUI, network or credential changes`);
} finally { rmSync(root, { recursive: true, force: true }); }
