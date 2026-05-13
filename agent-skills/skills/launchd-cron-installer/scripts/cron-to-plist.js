#!/usr/bin/env node
// cron-to-plist.js — convert a cron spec into a launchd plist
// Usage: cron-to-plist.js "<cron-spec>" --label <label> --command <path> [--stdout PATH] [--stderr PATH] [--interval SECONDS]
// Prints plist XML to stdout. Exits non-zero on parse error.

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.error(
    `Usage:
  cron-to-plist.js "<cron-spec>" --label <label> --command <path> [opts]
  cron-to-plist.js --interval <seconds> --label <label> --command <path> [opts]

Options:
  --label <name>       reverse-DNS label (required, becomes filename)
  --command <path>     absolute path to executable (required)
  --stdout <path>      StandardOutPath
  --stderr <path>      StandardErrorPath
  --interval <sec>     use StartInterval (mutually exclusive with cron-spec)
  --run-at-load        set RunAtLoad to true (default: false)

Cron spec: standard 5 fields (m h dom mon dow). Step (*/N) for minute and hour are expanded.
Lists ("1,2,3") and ranges ("1-5") are expanded. Day-of-month + day-of-week together are AND'd per launchd default.`,
  );
  process.exit(args.length === 0 ? 1 : 0);
}

function getOpt(name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}
function hasFlag(name) {
  return args.includes(name);
}

const label = getOpt("--label");
const command = getOpt("--command");
const stdoutPath = getOpt("--stdout");
const stderrPath = getOpt("--stderr");
const interval = getOpt("--interval");
const runAtLoad = hasFlag("--run-at-load");
const cronSpec = args[0] && !args[0].startsWith("--") ? args[0] : undefined;

if (!label || !command) {
  console.error("error: --label and --command are required");
  process.exit(2);
}
if (!/^[a-zA-Z0-9.\-_]+$/.test(label)) {
  console.error("error: label must match [a-zA-Z0-9.\\-_]+");
  process.exit(2);
}
if (!command.startsWith("/")) {
  console.error("error: --command must be an absolute path");
  process.exit(2);
}
if (cronSpec && interval) {
  console.error("error: cron-spec and --interval are mutually exclusive");
  process.exit(2);
}
if (!cronSpec && !interval) {
  console.error("error: provide either a cron-spec or --interval");
  process.exit(2);
}

// Expand a single cron field into a sorted unique list of integers.
function expandField(field, min, max) {
  if (field === "*") return null; // wildcard
  const out = new Set();
  for (const part of field.split(",")) {
    let step = 1;
    let body = part;
    if (body.includes("/")) {
      const [b, s] = body.split("/");
      body = b;
      step = parseInt(s, 10);
      if (!Number.isFinite(step) || step <= 0) throw new Error(`bad step in ${field}`);
    }
    let lo, hi;
    if (body === "*") {
      lo = min;
      hi = max;
    } else if (body.includes("-")) {
      const [l, h] = body.split("-").map((n) => parseInt(n, 10));
      lo = l;
      hi = h;
    } else {
      lo = hi = parseInt(body, 10);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < min || hi > max || lo > hi) {
      throw new Error(`bad range ${part} (expected ${min}..${max})`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

function buildCalendarEntries(spec) {
  const fields = spec.split(/\s+/);
  if (fields.length !== 5) throw new Error("cron spec must have 5 fields: m h dom mon dow");
  const [mF, hF, domF, monF, dowF] = fields;
  const minutes = expandField(mF, 0, 59);
  const hours = expandField(hF, 0, 23);
  const days = expandField(domF, 1, 31);
  const months = expandField(monF, 1, 12);
  const weekdays = expandField(dowF, 0, 6);

  // Generate cartesian product, omitting "*" fields from each dict.
  const lists = {
    Minute: minutes,
    Hour: hours,
    Day: days,
    Month: months,
    Weekday: weekdays,
  };
  // For each non-null list, we cross-product. Null means "every".
  const dims = Object.entries(lists).filter(([, v]) => v !== null);
  if (dims.length === 0) {
    return [{}]; // every minute — launchd accepts empty StartCalendarInterval dict
  }
  let combos = [{}];
  for (const [key, vals] of dims) {
    const next = [];
    for (const c of combos) {
      for (const v of vals) {
        next.push({ ...c, [key]: v });
      }
    }
    combos = next;
  }
  if (combos.length > 100) {
    throw new Error(
      `cron spec expands to ${combos.length} entries (>100). Use --interval for frequent schedules.`,
    );
  }
  return combos;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function emit() {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  );
  lines.push('<plist version="1.0">');
  lines.push("<dict>");
  lines.push("    <key>Label</key>");
  lines.push(`    <string>${esc(label)}</string>`);
  lines.push("    <key>ProgramArguments</key>");
  lines.push("    <array>");
  lines.push(`        <string>${esc(command)}</string>`);
  lines.push("    </array>");

  if (interval) {
    const n = parseInt(interval, 10);
    if (!Number.isFinite(n) || n <= 0) {
      console.error("error: --interval must be a positive integer (seconds)");
      process.exit(2);
    }
    lines.push("    <key>StartInterval</key>");
    lines.push(`    <integer>${n}</integer>`);
  } else {
    const entries = buildCalendarEntries(cronSpec);
    lines.push("    <key>StartCalendarInterval</key>");
    if (entries.length === 1) {
      lines.push("    <dict>");
      for (const [k, v] of Object.entries(entries[0])) {
        lines.push(`        <key>${k}</key>`);
        lines.push(`        <integer>${v}</integer>`);
      }
      lines.push("    </dict>");
    } else {
      lines.push("    <array>");
      for (const e of entries) {
        lines.push("        <dict>");
        for (const [k, v] of Object.entries(e)) {
          lines.push(`            <key>${k}</key>`);
          lines.push(`            <integer>${v}</integer>`);
        }
        lines.push("        </dict>");
      }
      lines.push("    </array>");
    }
  }

  if (stdoutPath) {
    lines.push("    <key>StandardOutPath</key>");
    lines.push(`    <string>${esc(stdoutPath)}</string>`);
  }
  if (stderrPath) {
    lines.push("    <key>StandardErrorPath</key>");
    lines.push(`    <string>${esc(stderrPath)}</string>`);
  }
  lines.push("    <key>RunAtLoad</key>");
  lines.push(`    ${runAtLoad ? "<true/>" : "<false/>"}`);
  lines.push("</dict>");
  lines.push("</plist>");
  return lines.join("\n") + "\n";
}

try {
  process.stdout.write(emit());
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(2);
}
