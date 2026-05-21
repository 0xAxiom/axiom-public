#!/usr/bin/env node
// validate-env.mjs — Pre-flight environment variable validation for AI agents
// Zero dependencies. Drop into any cron job or skill to catch config problems early.
//
// Usage:
//   node validate-env.mjs --require RPC_URL,WALLET_ADDR --wallet WALLET_ADDR --url RPC_URL
//   node validate-env.mjs --config rules.json
//   node validate-env.mjs --config rules.json --env-file .env --json

import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);

const getArg = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
};
const hasArg = (flag) => args.includes(flag);

// Optional: load a .env file into process.env without overriding existing values
const envFile = getArg('--env-file');
if (envFile) {
  if (!existsSync(envFile)) {
    console.error(`--env-file: file not found: ${envFile}`);
    process.exit(1);
  }
  const lines = readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] ??= val;
  }
}

// Accumulate rules from config file and/or CLI flags
const rules = {
  required:  [],   // must exist and be non-empty
  wallet:    [],   // must be 0x + 40 hex chars
  url:       [],   // must parse as a valid URL
  key:       [],   // API key: non-empty, >= 8 chars
  prefix:    {},   // { VAR: "expected-prefix" }
  regex:     {},   // { VAR: "pattern-string" }
  minLength: {},   // { VAR: N }
};

// Load config file
const configFile = getArg('--config');
if (configFile) {
  if (!existsSync(configFile)) {
    console.error(`--config: file not found: ${configFile}`);
    process.exit(1);
  }
  try {
    const cfg = JSON.parse(readFileSync(configFile, 'utf8'));
    if (Array.isArray(cfg.required))  rules.required.push(...cfg.required);
    if (Array.isArray(cfg.wallet))    rules.wallet.push(...cfg.wallet);
    if (Array.isArray(cfg.url))       rules.url.push(...cfg.url);
    if (Array.isArray(cfg.key))       rules.key.push(...cfg.key);
    if (cfg.prefix)    Object.assign(rules.prefix,    cfg.prefix);
    if (cfg.regex)     Object.assign(rules.regex,     cfg.regex);
    if (cfg.minLength) Object.assign(rules.minLength, cfg.minLength);
  } catch (e) {
    console.error(`Failed to parse config file: ${e.message}`);
    process.exit(1);
  }
}

// CLI: --require VAR1,VAR2,...
const reqFlag = getArg('--require');
if (reqFlag) rules.required.push(...reqFlag.split(',').map(s => s.trim()).filter(Boolean));

// CLI: multi-value flags
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  const val  = args[i + 1];
  if (!val) continue;
  if (flag === '--wallet') { rules.wallet.push(val); continue; }
  if (flag === '--url')    { rules.url.push(val);    continue; }
  if (flag === '--key')    { rules.key.push(val);    continue; }
  if (flag === '--prefix') {
    const eq = val.indexOf('=');
    if (eq > 0) rules.prefix[val.slice(0, eq)] = val.slice(eq + 1);
    continue;
  }
  if (flag === '--regex') {
    const eq = val.indexOf('=');
    if (eq > 0) rules.regex[val.slice(0, eq)] = val.slice(eq + 1);
    continue;
  }
  if (flag === '--min-length') {
    const eq = val.indexOf('=');
    if (eq > 0) rules.minLength[val.slice(0, eq)] = parseInt(val.slice(eq + 1), 10);
    continue;
  }
}

const jsonMode  = hasArg('--json');
const quietMode = hasArg('--quiet');

// --- Validation engine ---

const results = [];

const check = (varName, rule, passFn, failMsg) => {
  const raw = process.env[varName];
  const ok  = passFn(raw);
  results.push({
    var:     varName,
    rule,
    ok,
    message: ok ? 'OK' : failMsg,
    // never expose actual values in output
  });
};

const dedup = (arr) => [...new Set(arr)];

for (const v of dedup(rules.required)) {
  check(v, 'required',
    (val) => val !== undefined && val.trim() !== '',
    'Missing or empty'
  );
}

for (const v of dedup(rules.wallet)) {
  check(v, 'wallet (0x+40hex)',
    (val) => val !== undefined && /^0x[0-9a-fA-F]{40}$/.test(val.trim()),
    'Must be 0x followed by 40 hex characters'
  );
}

for (const v of dedup(rules.url)) {
  check(v, 'valid-url',
    (val) => {
      if (!val) return false;
      try { new URL(val.trim()); return true; } catch { return false; }
    },
    'Must be a valid URL (http/https/ws/wss)'
  );
}

for (const v of dedup(rules.key)) {
  check(v, 'api-key',
    (val) => val !== undefined && val.trim().length >= 8,
    'Must be present and at least 8 characters'
  );
}

for (const [v, pfx] of Object.entries(rules.prefix)) {
  check(v, `prefix:"${pfx}"`,
    (val) => val !== undefined && val.startsWith(pfx),
    `Must start with "${pfx}"`
  );
}

for (const [v, pattern] of Object.entries(rules.regex)) {
  check(v, `regex:/${pattern}/`,
    (val) => {
      if (!val) return false;
      try { return new RegExp(pattern).test(val); } catch { return false; }
    },
    `Must match /${pattern}/`
  );
}

for (const [v, len] of Object.entries(rules.minLength)) {
  const actual = process.env[v]?.length ?? 0;
  check(v, `min-length:${len}`,
    (val) => val !== undefined && val.length >= len,
    `Must be at least ${len} chars (got ${actual})`
  );
}

// --- Output ---

const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;
const total  = results.length;
const allOk  = failed === 0;

if (jsonMode) {
  process.stdout.write(JSON.stringify({
    ok: allOk,
    passed,
    failed,
    total,
    results,
  }, null, 2) + '\n');
} else if (!quietMode) {
  if (total === 0) {
    console.log('No rules specified. Pass --require, --wallet, --url, etc. or use --config rules.json');
    process.exit(0);
  }

  const colVar  = Math.max(...results.map(r => r.var.length),  12);
  const colRule = Math.max(...results.map(r => r.rule.length), 10);
  const sep     = '─'.repeat(colVar + colRule + 18);

  console.log(`\n  ${'VAR'.padEnd(colVar)}  ${'RULE'.padEnd(colRule)}  STATUS`);
  console.log(`  ${sep}`);

  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    const tail = r.ok ? '' : `  ← ${r.message}`;
    console.log(`  ${icon}  ${r.var.padEnd(colVar)}  ${r.rule.padEnd(colRule)}${tail}`);
  }

  console.log(`  ${sep}`);
  if (allOk) {
    console.log(`  ✅  ${passed}/${total} checks passed\n`);
  } else {
    console.log(`  ❌  ${passed}/${total} passed — failed: ${results.filter(r => !r.ok).map(r => r.var).join(', ')}\n`);
  }
}

process.exit(allOk ? 0 : 1);
