import { packager } from '@electron/packager';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(APP_DIR, '../..');
const BUILD_DIR = path.join(APP_DIR, 'build');
const STAGE_DIR = path.join(BUILD_DIR, 'stage');
const CACHE_DIR = path.join(BUILD_DIR, 'electron-cache');
const DMG_ROOT = path.join(BUILD_DIR, 'dmg-root');
const RELEASE_DIR = path.join(APP_DIR, 'release');
const DIR_ONLY = process.argv.includes('--dir');

const appVersion = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')).version;
const electronVersion = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'node_modules/electron/package.json'), 'utf8')).version;
const electronDist = path.join(APP_DIR, 'node_modules/electron/dist');
const electronZip = path.join(CACHE_DIR, `electron-v${electronVersion}-darwin-arm64.zip`);

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function copyDir(source, target) {
  fs.cpSync(source, target, { recursive: true, dereference: true });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sizeLabel(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function directorySize(target) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) return stat.size;
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    total += directorySize(path.join(target, entry.name));
  }
  return total;
}

function copyBundlePreservingLinks(source, target) {
  execFileSync('ditto', [source, target], { stdio: 'inherit' });
}

function prepareStage() {
  rmrf(STAGE_DIR);
  fs.mkdirSync(STAGE_DIR, { recursive: true });
  fs.writeFileSync(path.join(STAGE_DIR, 'package.json'), `${JSON.stringify({
    name: 'proto-harness-agent',
    productName: 'Proto Harness Agent',
    version: appVersion,
    description: '本地优先的产品 Agent 客户端',
    main: 'electron/main.js',
    type: 'module',
    license: 'MIT',
    author: 'amonastic'
  }, null, 2)}\n`);
  copyDir(path.join(APP_DIR, 'electron'), path.join(STAGE_DIR, 'electron'));
  copyDir(path.join(APP_DIR, 'renderer'), path.join(STAGE_DIR, 'renderer'));
  for (const packageName of ['core', 'runtime-adapter']) {
    copyDir(path.join(REPO_ROOT, 'packages', packageName, 'src'), path.join(STAGE_DIR, 'packages', packageName, 'src'));
    fs.copyFileSync(
      path.join(REPO_ROOT, 'packages', packageName, 'package.json'),
      path.join(STAGE_DIR, 'packages', packageName, 'package.json')
    );
  }
}

function prepareElectronZip() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.copyFileSync(path.join(electronDist, 'LICENSE'), path.join(BUILD_DIR, 'ELECTRON-LICENSE.txt'));
  fs.copyFileSync(path.join(electronDist, 'LICENSES.chromium.html'), path.join(BUILD_DIR, 'LICENSES.chromium.html'));
  if (fs.existsSync(electronZip)) return;
  console.log('准备本地 Electron zip…');
  execFileSync('zip', ['-qry', electronZip, '.'], { cwd: electronDist, stdio: 'inherit' });
}

async function main() {
  prepareStage();
  prepareElectronZip();
  rmrf(RELEASE_DIR);
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  console.log(`打包 Proto Harness Agent ${appVersion} / Electron ${electronVersion} / arm64`);
  const built = await packager({
    dir: STAGE_DIR,
    out: RELEASE_DIR,
    name: 'Proto Harness Agent',
    appBundleId: 'com.protoharness.agent',
    appCategoryType: 'public.app-category.productivity',
    appVersion,
    buildVersion: '1',
    platform: 'darwin',
    arch: 'arm64',
    electronVersion,
    electronZipDir: CACHE_DIR,
    asar: false,
    overwrite: true,
    prune: true,
    quiet: false,
    extendInfo: {
      NSHumanReadableCopyright: 'MIT · 本地优先的产品 Agent 客户端',
      LSMinimumSystemVersion: '12.0'
    },
    extraResource: [
      path.join(APP_DIR, 'docs', 'user-guide.md'),
      path.join(APP_DIR, 'docs', 'data-format.md'),
      path.join(APP_DIR, 'docs', 'third-party.md'),
      path.join(REPO_ROOT, 'LICENSE'),
      path.join(BUILD_DIR, 'ELECTRON-LICENSE.txt'),
      path.join(BUILD_DIR, 'LICENSES.chromium.html')
    ]
  });
  const appPath = built[0];
  if (!appPath || !fs.existsSync(appPath)) throw new Error('打包未生成 .app');
  const bundlePath = appPath.endsWith('.app') ? appPath : path.join(appPath, 'Proto Harness Agent.app');
  const resourcesDir = path.join(bundlePath, 'Contents', 'Resources');
  fs.copyFileSync(path.join(BUILD_DIR, 'icon.icns'), path.join(resourcesDir, 'app-icon.icns'));
  execFileSync('/usr/libexec/PlistBuddy', [
    '-c', 'Set :CFBundleIconFile app-icon.icns',
    path.join(bundlePath, 'Contents', 'Info.plist')
  ], { stdio: 'inherit' });
  console.log('签名（ad-hoc）…');
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', bundlePath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', bundlePath], { stdio: 'inherit' });
  console.log('签名验证通过（ad-hoc，未公证）');

  const buildInfo = {
    product: 'Proto Harness Agent',
    version: appVersion,
    build: 1,
    platform: 'darwin',
    arch: 'arm64',
    electron_version: electronVersion,
    built_at: new Date().toISOString(),
    source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT }).toString().trim(),
    app_path: bundlePath,
    app_size_bytes: directorySize(bundlePath),
    signing: {
      mode: 'ad-hoc',
      identity: '-',
      developer_id: false,
      notarized: false,
      warning: '本地测试产物：未使用 Developer ID 签名，未公证。正式分发需提供签名与公证凭据。'
    },
    dmgs: {},
    zips: {}
  };

  if (!DIR_ONLY) {
    rmrf(DMG_ROOT);
    fs.mkdirSync(DMG_ROOT, { recursive: true });
    copyBundlePreservingLinks(bundlePath, path.join(DMG_ROOT, 'Proto Harness Agent.app'));
    fs.symlinkSync('/Applications', path.join(DMG_ROOT, 'Applications'));
    const dmgPath = path.join(RELEASE_DIR, `Proto-Harness-Agent-${appVersion}-arm64.dmg`);
    console.log('生成 DMG…');
    execFileSync('hdiutil', [
      'create', '-volname', 'Proto Harness Agent',
      '-srcfolder', DMG_ROOT, '-ov', '-format', 'UDZO', dmgPath
    ], { stdio: 'inherit' });
    const zipPath = path.join(RELEASE_DIR, `Proto-Harness-Agent-${appVersion}-arm64.zip`);
    console.log('生成 ZIP…');
    execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundlePath, zipPath], { stdio: 'inherit' });
    buildInfo.dmgs[dmgPath] = {
      sha256: sha256(dmgPath),
      size_bytes: fs.statSync(dmgPath).size,
      size_label: sizeLabel(fs.statSync(dmgPath).size)
    };
    buildInfo.zips[zipPath] = {
      sha256: sha256(zipPath),
      size_bytes: fs.statSync(zipPath).size,
      size_label: sizeLabel(fs.statSync(zipPath).size)
    };
    console.log(`DMG: ${dmgPath}`);
    console.log(`ZIP: ${zipPath}`);
  }

  fs.writeFileSync(path.join(RELEASE_DIR, 'build-info.json'), `${JSON.stringify(buildInfo, null, 2)}\n`);
  console.log(`APP: ${bundlePath}`);
  console.log(`BUILD INFO: ${path.join(RELEASE_DIR, 'build-info.json')}`);
}

main().catch((error) => {
  console.error('打包失败');
  console.error(error.stack || error);
  process.exit(1);
});
