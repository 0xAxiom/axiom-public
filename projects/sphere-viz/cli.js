#!/usr/bin/env node

const { execSync, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const args = process.argv.slice(2);

function printHelp() {
  console.log(`
🔮 sphere-viz - Audio-Reactive 3D Sphere Visualizer

Usage:
  npx sphere-viz <input.mp3> <output.mp4> [options]

Options:
  --color <hex>      Sphere color (default: #00E5FF)
  --bg <hex>         Background color (default: #0A0C10)
  --detail <n>       Sphere detail level 8-64 (default: 32)
  --square           Output square format (1080x1080)
  --no-wireframe     Hide wireframe
  --no-points        Hide vertex points
  --help             Show this help

Examples:
  npx sphere-viz music.mp3 output.mp4
  npx sphere-viz audio.wav viz.mp4 --color "#FF00FF"
  npx sphere-viz podcast.mp3 social.mp4 --square

`);
}

if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  printHelp();
  process.exit(0);
}

// Parse arguments
const inputFile = args[0];
const outputFile = args[1] || "output.mp4";

if (!inputFile) {
  console.error("Error: Please provide an input audio file");
  printHelp();
  process.exit(1);
}

// Resolve input file path
const inputPath = path.resolve(inputFile);
if (!fs.existsSync(inputPath)) {
  console.error(`Error: Input file not found: ${inputPath}`);
  process.exit(1);
}

// Parse options
const getArg = (flag, defaultVal) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
};

const color = getArg("--color", "#00E5FF");
const bg = getArg("--bg", "#0A0C10");
const detail = parseInt(getArg("--detail", "32"), 10);
const square = args.includes("--square");
const noWireframe = args.includes("--no-wireframe");
const noPoints = args.includes("--no-points");

// Copy audio to public folder
const projectDir = __dirname;
const publicDir = path.join(projectDir, "public");
const audioDestPath = path.join(publicDir, "audio.mp3");

console.log("🎵 Processing audio file...");

// Use ffmpeg to convert to mp3 if needed (ensures compatibility)
try {
  execSync(`ffmpeg -y -i "${inputPath}" -acodec libmp3lame -q:a 2 "${audioDestPath}" 2>/dev/null`, {
    stdio: "pipe",
  });
} catch {
  // If ffmpeg fails, try direct copy
  fs.copyFileSync(inputPath, audioDestPath);
}

console.log("🔮 Rendering sphere visualization...");

// Build props
const props = JSON.stringify({
  audioSrc: "http://localhost:3000/public/audio.mp3",
  backgroundColor: bg,
  sphereColor: color,
  sphereDetail: detail,
  showWireframe: !noWireframe,
  showPoints: !noPoints,
});

const composition = square ? "SphereVizSquare" : "SphereViz";
const outputPath = path.resolve(outputFile);

// Run remotion render
const renderCmd = [
  "npx",
  "remotion",
  "render",
  composition,
  outputPath,
  "--props",
  props,
];

console.log(`📹 Composition: ${composition}`);
console.log(`🎨 Color: ${color} | Background: ${bg}`);

const render = spawn(renderCmd[0], renderCmd.slice(1), {
  cwd: projectDir,
  stdio: "inherit",
});

render.on("close", (code) => {
  if (code === 0) {
    console.log(`\n✅ Video saved to: ${outputPath}`);
  } else {
    console.error(`\n❌ Render failed with code ${code}`);
    process.exit(code);
  }
});
