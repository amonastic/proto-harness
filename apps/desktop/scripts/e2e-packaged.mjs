import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(APP_DIR, 'release');
const candidates = [
  path.join(releaseDir, 'Proto Harness Agent-darwin-arm64', 'Proto Harness Agent.app', 'Contents', 'MacOS', 'Proto Harness Agent')
];
if (fs.existsSync(releaseDir)) {
  for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.endsWith('.app')) {
      candidates.push(path.join(releaseDir, entry.name, 'Contents', 'MacOS', 'Proto Harness Agent'));
    }
  }
}
const binary = candidates.find((item) => fs.existsSync(item));
if (!binary) {
  console.error('未找到打包产物，请先运行 npm run package');
  process.exit(1);
}
console.log(`使用安装产物运行 E2E：${binary}`);
const result = spawnSync(process.execPath, [path.join(APP_DIR, 'e2e', 'journeys.mjs')], {
  cwd: APP_DIR,
  stdio: 'inherit',
  env: {
    ...process.env,
    PHA_E2E_BINARY: binary,
    PHA_E2E_LABEL: 'packaged'
  }
});
process.exit(result.status ?? 1);
