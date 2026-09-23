#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadGovernanceConfig } = require('./lib/governance-config');

const root = path.resolve(__dirname, '..');
const { inferPlatform } = loadGovernanceConfig(root);
const args = process.argv.slice(2);
const pageArg = readArg('--page');
const diffMode = args.includes('--diff');

const DEFAULT_TEMPLATES = {
  web: {
    colors: ['#1677FF', '#F5F7FA', '#FFFFFF', '#E8E8E8', '#1A1A1A', '#666666', '#00B578', '#FF4D4F'],
    fonts: ['12px', '14px', '16px', '18px'],
    radii: ['6px', '8px', '12px', '999px'],
    spacings: ['8px', '12px', '16px', '24px']
  },
  app: {
    colors: ['#1677FF', '#F8FAFC', '#FFFFFF', '#E2E8F0', '#0F172A', '#64748B', '#00B578', '#FF4D4F'],
    fonts: ['11px', '12px', '14px', '16px', '18px'],
    radii: ['8px', '12px', '16px', '50px'],
    spacings: ['8px', '12px', '14px', '16px', '24px']
  },
  miniapp: {
    colors: ['#1677FF', '#F3F6FB', '#FFFFFF', '#E7ECF4', '#18202D', '#667085', '#00B578', '#FF4D4F'],
    fonts: ['11px', '12px', '14px', '16px', '18px'],
    radii: ['12px', '16px', '18px', '50px'],
    spacings: ['8px', '10px', '12px', '16px', '24px']
  }
};

function readArg(name) {
  const index = args.indexOf(name);
  if (index !== -1) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : null;
}

function usage() {
  console.error('Usage: node scripts/extract-page-css.js --page "<html file or directory>" [--diff]');
}

function toRel(abs) {
  return path.relative(root, abs).replace(/\\/g, '/');
}

function collectHtmlFiles(target) {
  const abs = path.resolve(root, target);
  if (!fs.existsSync(abs)) {
    throw new Error(`Target not found: ${target}`);
  }
  const stat = fs.statSync(abs);
  if (stat.isFile()) {
    if (!abs.endsWith('.html')) throw new Error(`Target is not an HTML file: ${target}`);
    return [abs];
  }
  const out = [];
  const stack = [abs];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      if (entry.isFile() && entry.name.endsWith('.html')) out.push(full);
    }
  }
  return out.sort();
}

function extractStyleBlocks(html) {
  const blocks = [];
  const pattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  while ((match = pattern.exec(html))) blocks.push({ source: 'inline-style', css: match[1] });
  return blocks;
}

function extractLinkedCss(html, htmlFile) {
  const blocks = [];
  const pattern = /<link\b[^>]*href=["']([^"']+\.css(?:\?[^"']*)?)["'][^>]*>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const href = match[1].split('?')[0];
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) continue;
    const cssPath = path.resolve(path.dirname(htmlFile), href);
    if (!cssPath.startsWith(root) || !fs.existsSync(cssPath)) continue;
    blocks.push({ source: toRel(cssPath), css: fs.readFileSync(cssPath, 'utf8') });
  }
  return blocks;
}

function normalizeHex(value) {
  const hex = value.toUpperCase();
  if (/^#[0-9A-F]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
}

function bump(map, value, source) {
  if (!value) return;
  const current = map.get(value) || { value, count: 0, sources: new Set() };
  current.count += 1;
  current.sources.add(source);
  map.set(value, current);
}

function sorted(map) {
  return [...map.values()]
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)))
    .map((item) => ({ value: item.value, count: item.count, sources: [...item.sources].sort() }));
}

function uniqueValues(items) {
  return items.map((item) => item.value);
}

function scanCss(blocks) {
  const colors = new Map();
  const fonts = new Map();
  const fontWeights = new Map();
  const radii = new Map();
  const spacings = new Map();

  for (const block of blocks) {
    const css = stripComments(block.css);
    scanMatches(css, /#[0-9a-fA-F]{3,8}\b/g, (value) => bump(colors, normalizeHex(value), block.source));
    scanMatches(css, /\brgba?\([^)]+\)/gi, (value) => bump(colors, value.replace(/\s+/g, ''), block.source));
    scanMatches(css, /font-size\s*:\s*([0-9.]+px)/gi, (value) => bump(fonts, value, block.source));
    scanMatches(css, /font-weight\s*:\s*([0-9]{3}|bold|600|700|800)/gi, (value) => bump(fontWeights, value, block.source));
    scanMatches(css, /border-radius\s*:\s*([^;]+);/gi, (value) => {
      value.split(/\s+/).forEach((part) => {
        if (/^[0-9.]+px$|^999px$|^50%$/.test(part)) bump(radii, part, block.source);
      });
    });
    scanMatches(css, /\b(?:margin|padding|gap|top|right|bottom|left|width|height|min-height|min-width|max-width)\s*:\s*([^;]+);/gi, (value) => {
      value.split(/\s+/).forEach((part) => {
        if (/^[0-9.]+px$/.test(part)) bump(spacings, part, block.source);
      });
    });
  }

  return {
    colors: sorted(colors),
    fonts: sorted(fonts),
    fontWeights: sorted(fontWeights),
    radii: sorted(radii),
    spacings: sorted(spacings)
  };
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function scanMatches(text, pattern, onMatch) {
  let match;
  while ((match = pattern.exec(text))) {
    onMatch(match[1] || match[0]);
  }
}

function buildDiff(values, defaults) {
  const actual = new Set(values);
  const base = new Set(defaults);
  return {
    inDefaultNotUsed: [...base].filter((value) => !actual.has(value)),
    usedNotInDefault: [...actual].filter((value) => !base.has(value))
  };
}

function analyzeFile(file) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = toRel(file);
  const platform = inferPlatform(rel);
  const blocks = [...extractStyleBlocks(html), ...extractLinkedCss(html, file)];
  const data = scanCss(blocks);
  const result = {
    file: rel,
    platform,
    sources: blocks.map((block) => block.source),
    colors: uniqueValues(data.colors),
    colorDetails: data.colors,
    fonts: data.fonts,
    fontWeights: data.fontWeights,
    radii: uniqueValues(data.radii),
    radiusDetails: data.radii,
    spacings: uniqueValues(data.spacings),
    spacingDetails: data.spacings
  };

  if (diffMode) {
    const template = DEFAULT_TEMPLATES[platform] || DEFAULT_TEMPLATES.web;
    result.diff = {
      colors: buildDiff(result.colors, template.colors),
      fonts: buildDiff(result.fonts.map((item) => item.value), template.fonts),
      radii: buildDiff(result.radii, template.radii),
      spacings: buildDiff(result.spacings, template.spacings)
    };
  }

  return result;
}

if (!pageArg) {
  usage();
  process.exit(1);
}

try {
  const files = collectHtmlFiles(pageArg);
  const results = files.map(analyzeFile);
  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
} catch (error) {
  console.error(`[extract-page-css] ${error.message}`);
  process.exit(1);
}
