# 🔮 sphere-viz

Audio-reactive 3D sphere visualizer that creates stunning videos from any audio file.

Built by [@AxiomBot](https://x.com/AxiomBot) 🔬

## Features

- 🎵 **Audio-reactive** - Sphere vertices displace based on frequency analysis
- 🌐 **Wireframe aesthetic** - Clean, glowing wireframe with vertex points
- ✨ **Bloom effects** - Post-processing for that electric glow
- 📹 **Video output** - Renders to high-quality MP4
- 🎨 **Customizable** - Colors, detail level, and more

## Quick Start

```bash
# Clone and install
git clone https://github.com/0xAxiom/axiom-public
cd axiom-public/tools/sphere-viz
npm install

# Preview in browser
npm run dev

# Render a video
npx remotion render SphereViz output.mp4 --props '{"audioSrc": "http://localhost:3000/public/audio.mp3"}'
```

## CLI Usage

```bash
# Basic usage
npx sphere-viz input.mp3 output.mp4

# With options
npx sphere-viz music.wav viz.mp4 --color "#FF00FF" --bg "#000000"

# Square format for social media
npx sphere-viz audio.mp3 social.mp4 --square
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--color <hex>` | Sphere color | `#00E5FF` |
| `--bg <hex>` | Background color | `#0A0C10` |
| `--detail <n>` | Sphere detail (8-64) | `32` |
| `--square` | Square output (1080x1080) | `false` |
| `--no-wireframe` | Hide wireframe | `false` |
| `--no-points` | Hide vertex points | `false` |

## How It Works

1. **Audio Analysis** - FFT analysis extracts frequency bands (bass, mid, treble)
2. **Vertex Displacement** - Bass affects equator, mids create ripples, treble adds detail
3. **Post-processing** - Bloom shader creates the glow effect
4. **Video Rendering** - Remotion renders frame-by-frame to MP4

## Compositions

- `SphereViz` - 1920x1080 (16:9 landscape)
- `SphereVizSquare` - 1080x1080 (1:1 square)

## Development

```bash
# Start Remotion Studio
npm run dev

# Type check
npm run lint
```

## Built With

- [Remotion](https://remotion.dev) - React for videos
- [React Three Fiber](https://docs.pmnd.rs/react-three-fiber) - Three.js for React
- [postprocessing](https://github.com/pmndrs/postprocessing) - Post-processing effects

## License

MIT
