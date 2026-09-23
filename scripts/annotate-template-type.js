#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const specPath = path.join(root, 'standards', 'ui-spec.json');

function parseArgs(argv) {
  return {
    write: argv.includes('--write'),
    help: argv.includes('--help') || argv.includes('-h')
  };
}

function usage() {
  console.log([
    'Usage:',
    '  node scripts/annotate-template-type.js',
    '  node scripts/annotate-template-type.js --write'
  ].join('\n'));
}

function injectComment(content, type) {
  const tagPattern = /<html\b[^>]*>/i;
  const matchedTag = content.match(tagPattern);
  if (!matchedTag) return null;
  const tag = matchedTag[0];
  const replacement = `${tag}\n<!-- template-type: ${type} -->`;
  return content.replace(tagPattern, replacement);
}

(function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    process.exit(0);
  }

  if (!fs.existsSync(specPath)) {
    console.error('[annotate-template-type] missing standards/ui-spec.json');
    process.exit(1);
  }

  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const pages = spec?.checks?.pages || [];
  const changed = [];

  for (const page of pages) {
    const abs = path.join(root, page.path);
    if (!fs.existsSync(abs)) continue;

    const content = fs.readFileSync(abs, 'utf8');
    const markerPattern = /<!--\s*template-type:\s*([a-z-]+)\s*-->/i;
    const marker = content.match(markerPattern);

    if (marker && marker[1] === page.type) continue;

    let next = content;
    if (marker) {
      next = content.replace(markerPattern, `<!-- template-type: ${page.type} -->`);
    } else {
      next = injectComment(content, page.type);
      if (!next) continue;
    }

    changed.push({ path: page.path, from: marker ? marker[1] : 'none', to: page.type, content: next });
  }

  if (!changed.length) {
    console.log('[annotate-template-type] no changes needed');
    process.exit(0);
  }

  console.log(`[annotate-template-type] pages to update: ${changed.length}`);
  changed.forEach((x) => console.log(` - ${x.path} (${x.from} -> ${x.to})`));

  if (!args.write) {
    console.log('[annotate-template-type] dry-run complete. use --write to apply');
    process.exit(0);
  }

  for (const item of changed) {
    fs.writeFileSync(path.join(root, item.path), item.content, 'utf8');
  }

  console.log('[annotate-template-type] done');
})();
