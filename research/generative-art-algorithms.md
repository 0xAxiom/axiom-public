# Generative Art Algorithms — Deep Research

*Comprehensive algorithm documentation for implementation-ready generative art*

---

## Table of Contents

1. [Flow Fields](#flow-fields)
2. [Recursive Subdivision](#recursive-subdivision)
3. [Voronoi Diagrams & Poisson Disk Sampling](#voronoi-diagrams--poisson-disk-sampling)
4. [Parametric Geometry & 3D Projection](#parametric-geometry--3d-projection)
5. [Noise Functions](#noise-functions)
6. [Color Theory & Palette Selection](#color-theory--palette-selection)
7. [Project Case Studies](#project-case-studies)
8. [SVG vs Canvas: When to Use Each](#svg-vs-canvas-when-to-use-each)

---

## Flow Fields

### What They Are
Flow fields are grids of angle vectors that guide the movement of curves. At each point in a grid, you store an angle. Particles or lines flowing through this field follow the angles, creating organic, non-overlapping curves.

### How Tyler Hobbs Uses Them (Fidenza)

Tyler Hobbs has used flow fields more than possibly any other artist alive. His essay "Flow Fields" (2020) is the definitive guide.

**Core algorithm:**

```javascript
// 1. Initialize grid
const left_x = width * -0.5;  // Extra margin outside canvas
const right_x = width * 1.5;
const top_y = height * -0.5;
const bottom_y = height * 1.5;
const resolution = width * 0.01;  // 1% of image width

const num_columns = (right_x - left_x) / resolution;
const num_rows = (bottom_y - top_y) / resolution;

const grid = new Float32Array(num_columns * num_rows);

// 2. Fill grid with angles (using Perlin noise)
for (let col = 0; col < num_columns; col++) {
  for (let row = 0; row < num_rows; row++) {
    const scaled_x = col * 0.005;  // Perlin noise works best at ~0.005 step
    const scaled_y = row * 0.005;
    const noise_val = noise(scaled_x, scaled_y);  // 0.0 to 1.0
    const angle = noise_val * Math.PI * 2;  // Map to 0..2π
    grid[col * num_rows + row] = angle;
  }
}

// 3. Draw curves through field
let x = startX;
let y = startY;
const path = [{ x, y }];

for (let i = 0; i < num_steps; i++) {
  // Look up grid angle
  const x_offset = x - left_x;
  const y_offset = y - top_y;
  const col_index = Math.floor(x_offset / resolution);
  const row_index = Math.floor(y_offset / resolution);
  
  const grid_angle = grid[col_index * num_rows + row_index];
  
  // Move in that direction
  const x_step = step_length * Math.cos(grid_angle);
  const y_step = step_length * Math.sin(grid_angle);
  
  x += x_step;
  y += y_step;
  path.push({ x, y });
}
```

### Key Parameters

**Resolution**: Higher = smoother curves, but slower. Tyler uses ~0.5% to 1% of image width.

**Step Length**: Controls curve smoothness. Too large = visible corners. Tyler uses 0.1% to 0.5% of image width.

**Num Steps**: Short curves = "fur" texture, more uniform. Long curves = fluid, dramatic lines.

**Starting Points**: Three main approaches:
- **Grid**: Simple but stiff
- **Uniformly Random**: Loose but clumpy/sparse
- **Circle Packing / Poisson Disk**: Best balance — evenly spaced but organic

### Controlling Density Without Clutter

1. **Short curve lengths** preserve distinct color regions (no excessive blending)
2. **Collision detection** — stop curves when they get too close to existing ones (see Mirror Removal)
3. **Minimum spacing checks** at each step
4. **Controlled turbulence** — scale noise appropriately. Too much = chaos, too little = boring

### Making It Evolve (Simple → Refined)

Tyler's approach in **Fidenza**:
- Start with sparse, large shapes
- Use **collision checking** so shapes never overlap messily
- Apply **probabilistic color palettes** — choose colors with weighted probabilities
- Add **scale variation** — Fidenza has 7 scale modes (Small, Medium, Large, Jumbo, Jumbo XL, Uniform, Micro-Uniform)
- **Turbulence levels** — None, Low, Medium, High. "None" produces straight geometric forms
- **Sharp edge mode** — snap angles to multiples of π/10 or π/4 for sculpted, rocky forms

### Distortion Techniques (Beyond Perlin Noise)

**Continuous distortions** (smooth transitions):
- Perlin/Simplex noise (most common)
- Custom smooth distortions (Tyler's secret sauce)
- Result: curves never cross, organic flow

**Non-continuous distortions** (abrupt transitions):
- Round angles to multiples (π/10, π/4, etc.) → sculpted forms
- Random angle per row → horizontal banding
- Random angle per vector → total chaos, overlapping lines
- Result: sharp edges, moiré patterns, crossings

### Color Selection in Flow Fields

**For short curves:** Use distinct colors to avoid muddy blending.

**For long curves with similar colors:** Longer curves can drag colors together — works well with subtle palettes (see Loxodography).

**Blending techniques:**
- Assign colors per "patch" in Patchwork mode (see Subscapes)
- Use diffuse lighting to interpolate colors along curves
- Probabilistic palettes with weighted color selection

### SVG vs Canvas

**Flow fields work well in both.**
- **Canvas (raster)**: Better for dense, overlapping curves with alpha blending
- **SVG (vector)**: Excellent for clean, non-overlapping curves, perfect for plotters
- Tyler Hobbs often outputs to SVG for plotter prints

### Advanced Tricks

1. **Enforcing minimum distance** between curves (Mirror Removal, 2019)
2. **Drawing dots instead of curves** + collision checks (Side Effects Include\d, 2019)
3. **Distorting grid between rounds** for variety (Festival Notes)
4. **Interpolating between neighboring curves** to create polygon outlines (Stripes)
5. **Objects that distort the field** around them — fluid wrapping (Ectogenesis)

---

## Recursive Subdivision

### Triangle Subdivision (Tyler Hobbs, 2017)

Recursive subdivision is about splitting shapes into smaller shapes repeatedly. The challenge: **avoid creating skewed, ugly shapes**.

### Basic Algorithm

```javascript
function subdivideTriangle(A, B, C, depth = 0, maxDepth = 10) {
  if (shouldStop(depth, maxDepth)) {
    drawTriangle(A, B, C);
    return;
  }
  
  // Find longest side
  const [P1, P2, P3] = findLongestSide(A, B, C);
  
  // Pick random point on longest side
  const t = gaussianRandom(0.5, 0.15);  // Center on 0.5, std dev 0.15
  const D = lerp(P2, P3, clamp(t, 0.1, 0.9));  // Don't get too close to corners
  
  // Split into two triangles
  subdivideTriangle(P1, P2, D, depth + 1, maxDepth);
  subdivideTriangle(P1, D, P3, depth + 1, maxDepth);
}

function findLongestSide(A, B, C) {
  const ab = distance(A, B);
  const bc = distance(B, C);
  const ca = distance(C, A);
  
  if (ab >= bc && ab >= ca) return [C, A, B];
  if (bc >= ca) return [A, B, C];
  return [B, C, A];
}
```

**Key insight:** Always split the **longest side**. This creates self-balancing subdivision that avoids stretched, ugly triangles.

### Grid Subdivision (Kjetil Golid — Archetype)

Kjetil Golid's **Archetype** uses **recursive grid subdivision** (quadtrees).

```javascript
function subdivideRect(x, y, width, height, depth = 0) {
  if (shouldStop(depth)) {
    drawRect(x, y, width, height);
    return;
  }
  
  // Pick split axis (horizontal or vertical)
  const splitHorizontal = random() < 0.5;
  
  // Pick split position (gaussian around center)
  const t = gaussianRandom(0.5, 0.15);
  
  if (splitHorizontal) {
    const splitY = y + height * t;
    subdivideRect(x, y, width, splitY - y, depth + 1);
    subdivideRect(x, splitY, width, y + height - splitY, depth + 1);
  } else {
    const splitX = x + width * t;
    subdivideRect(x, y, splitX - x, height, depth + 1);
    subdivideRect(splitX, y, x + width - splitX, height, depth + 1);
  }
}
```

### Preventing Overcrowding

**1. Probabilistic stopping:**
```javascript
function shouldStop(depth, maxDepth) {
  if (depth >= maxDepth) return true;
  // Increase probability of stopping as depth increases
  const stopChance = rescale(depth, 0, maxDepth, 0.0, 0.12);
  return random() < stopChance;
}
```

**2. Inherited depth (creates "big shapes"):**
- At early depths (0-3), pick a random target depth for this branch
- Children can adjust by ±1 level with decreasing probability
- Creates coherent regions of similar subdivision density

**3. Area-based stopping:**
```javascript
function shouldStop(width, height, minArea) {
  return (width * height) < minArea;
}
```

### Making It Evolve

**Simple → Refined:**
1. Start with large shapes (low depth)
2. Add probabilistic variation in depth
3. Use inherited depth to create "regions" of detail
4. Apply constraints (min area, max depth) to prevent over-subdivision

**Visual progression:**
- Depth 3: Bold, geometric
- Depth 6: Medium detail, still readable
- Depth 10+: Dense, textile-like

### Curves Instead of Lines

Tyler's **"Voyage"** (2017): Replace triangle edges with curves.
- Each edge is a multi-segment curve
- Apply Gaussian noise to midpoints
- Smooth with Chaikin curve algorithm
- Result: Organic, flowing subdivisions

### SVG vs Canvas

- **SVG**: Perfect for recursive subdivision — clean lines, easy fills, scales infinitely
- **Canvas**: Works fine but offers no advantage over SVG here

---

## Voronoi Diagrams & Poisson Disk Sampling

### Voronoi Diagrams

Voronoi diagrams create **organic cell patterns**. Each point (seed) owns the region closest to it.

**Algorithm (Fortune's algorithm — O(n log n)):**

```javascript
// Simplified concept (full implementation is complex)
function voronoi(seeds, width, height) {
  const cells = [];
  
  for (const seed of seeds) {
    const cell = [];
    
    // For each pixel, check if this seed is closest
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (isClosestSeed(x, y, seed, seeds)) {
          cell.push({ x, y });
        }
      }
    }
    
    cells.push(cell);
  }
  
  return cells;
}
```

**Practical usage:** Use a library like `d3-voronoi` or `d3-delaunay` (modern replacement).

### Poisson Disk Sampling

Creates **evenly spaced points** without clumping or gaps. Much better than random for placing objects.

**Bridson's Algorithm:**

```javascript
function poissonDiskSampling(width, height, minDist, maxAttempts = 30) {
  const cellSize = minDist / Math.sqrt(2);
  const gridWidth = Math.ceil(width / cellSize);
  const gridHeight = Math.ceil(height / cellSize);
  const grid = new Array(gridWidth * gridHeight);
  
  const points = [];
  const active = [];
  
  // Start with random point
  const firstPoint = { x: random(width), y: random(height) };
  points.push(firstPoint);
  active.push(firstPoint);
  addToGrid(firstPoint, grid, cellSize);
  
  while (active.length > 0) {
    const randomIndex = Math.floor(random(active.length));
    const point = active[randomIndex];
    let found = false;
    
    for (let i = 0; i < maxAttempts; i++) {
      const angle = random(Math.PI * 2);
      const radius = minDist + random(minDist);
      const newPoint = {
        x: point.x + radius * Math.cos(angle),
        y: point.y + radius * Math.sin(angle)
      };
      
      if (newPoint.x >= 0 && newPoint.x < width &&
          newPoint.y >= 0 && newPoint.y < height &&
          isFarEnough(newPoint, grid, cellSize, minDist)) {
        points.push(newPoint);
        active.push(newPoint);
        addToGrid(newPoint, grid, cellSize);
        found = true;
        break;
      }
    }
    
    if (!found) {
      active.splice(randomIndex, 1);
    }
  }
  
  return points;
}
```

### Usage in Generative Art

**Subscapes (Matt DesLauriers):** Uses Poisson disk for stroke placement → organic, even distribution.

**Comparison:**
- **Grid**: Stiff, mechanical
- **Random**: Clumpy and sparse areas
- **Poisson Disk**: Natural, even spacing (best for most cases)

### Controlling Density

**minDist parameter**: Controls spacing.
- Large minDist = sparse, airy
- Small minDist = dense, crowded

**Adaptive spacing**: Vary minDist based on position, noise, or other factors.

### Evolution Strategy

Simple → Refined:
1. Start with large minDist (sparse points)
2. Run Voronoi to create cells
3. For each cell, optionally subdivide with smaller Poisson disk sampling
4. Result: Hierarchical cellular structure with controlled density

---

## Parametric Geometry & 3D Projection

### What Parametric Geometry Is

Instead of storing vertices, **define surface as a function**:

```javascript
function parametricTerrain(u, v) {
  // u and v are in range 0..1
  const x = u * 2 - 1;  // -1..1
  const z = v * 2 - 1;
  
  // Height from noise
  const y = calculateTerrainHeight(x, z);
  
  return [x, y, z];
}

function calculateTerrainHeight(x, z) {
  // Sum multiple octaves of simplex noise
  let height = 0;
  let amplitude = 1.0;
  let frequency = 1.0;
  
  for (let i = 0; i < 4; i++) {
    height += amplitude * simplex2D(x * frequency, z * frequency);
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  
  return height;
}
```

### Generating Mesh

```javascript
function generateMesh(parametricFunc, subdivisions) {
  const vertices = [];
  const cells = [];  // Triangle indices
  
  for (let i = 0; i <= subdivisions; i++) {
    for (let j = 0; j <= subdivisions; j++) {
      const u = i / subdivisions;
      const v = j / subdivisions;
      const vertex = parametricFunc(u, v);
      vertices.push(vertex);
    }
  }
  
  // Create triangle indices (two triangles per grid square)
  const cols = subdivisions + 1;
  for (let i = 0; i < subdivisions; i++) {
    for (let j = 0; j < subdivisions; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      
      cells.push([a, c, b]);  // Triangle 1
      cells.push([b, c, d]);  // Triangle 2
    }
  }
  
  return { vertices, cells };
}
```

### 3D to 2D Projection

**Isometric projection** (parallel projection, no perspective):

```javascript
function createIsometricCamera(position, target, width, height) {
  const viewMatrix = lookAt(position, target, [0, 1, 0]);
  const projMatrix = orthographic(-1, 1, -1, 1, 0.1, 100);
  const vpMatrix = multiply(projMatrix, viewMatrix);
  
  return function project(point3D) {
    let p = transformPoint(vpMatrix, point3D);
    
    // Map -1..1 to screen space
    const x = (p[0] + 1) * 0.5 * width;
    const y = (1 - p[1]) * 0.5 * height;  // Flip Y
    
    return [x, y];
  };
}
```

**Usage in Subscapes:**
- Parametric terrain with noise
- Isometric camera for 2.5D tiles
- Strokes drawn on terrain surface using flow fields

### Occlusion & Raycasting

**Problem:** Back-facing and occluded triangles shouldn't be drawn.

**Solution:**

1. **Back-face culling:**
```javascript
function isFrontFacing(triangle, cameraPos) {
  const normal = calculateNormal(triangle);
  const toCamera = subtract(cameraPos, triangle[0]);
  return dot(normal, toCamera) > 0;
}
```

2. **Raycasting for occlusion:**
```javascript
function isOccluded(point, cameraPos, allTriangles) {
  const ray = { origin: point, direction: normalize(subtract(cameraPos, point)) };
  
  for (const triangle of allTriangles) {
    if (rayIntersectsTriangle(ray, triangle)) {
      return true;  // Something blocks the view
    }
  }
  
  return false;
}
```

**Note:** Raycasting is expensive. Subscapes uses low-resolution raycast to maintain speed, causing some artifacts.

### Diffuse Lighting (Lambertian Shading)

```javascript
function calculateDiffuse(point, normal, lightDirection) {
  // Lambert's cosine law
  const diffuse = Math.max(0, dot(normal, lightDirection));
  return diffuse;
}

// Usage: interpolate color based on diffuse
function getStrokeColor(point, normal, lightDir, palette) {
  const diffuse = calculateDiffuse(point, normal, lightDir);
  
  // "Step" the diffuse to discrete levels (more illustrative)
  const steppedDiffuse = Math.floor(diffuse * 4) / 4;
  
  // Interpolate through palette
  const colorIndex = Math.floor(steppedDiffuse * (palette.length - 1));
  return palette[colorIndex];
}
```

**Subscapes:** Uses diffuse lighting for stroke color + thickness variation, creating "metallic" styles.

---

## Noise Functions

### Why Noise?

Noise provides **smooth, organic randomness** instead of harsh, uniform randomness.

### Types of Noise

**1. Perlin Noise (1983)**
- Gradient noise, smooth, continuous
- Can produce "banding" artifacts at certain angles
- Available in Processing as `noise()`

**2. Simplex Noise (2001)**
- Ken Perlin's improved algorithm
- Fewer directional artifacts
- Slightly faster, especially in higher dimensions
- Use this if you can

**3. OpenSimplex2 (2021)**
- Even more improvements, patent-free

### Implementation (Conceptual)

```javascript
// Pseudocode (use a library like simplex-noise.js)
import SimplexNoise from 'simplex-noise';

const simplex = new SimplexNoise(seed);

function noise2D(x, y) {
  return simplex.noise2D(x, y);  // Returns -1 to 1
}

// Scale to 0..1
function noise01(x, y) {
  return (noise2D(x, y) + 1) * 0.5;
}
```

### Octaves (Fractal Noise)

**Sum multiple frequencies for more detail:**

```javascript
function fbm(x, y, octaves = 4) {
  let value = 0;
  let amplitude = 1.0;
  let frequency = 1.0;
  let maxValue = 0;
  
  for (let i = 0; i < octaves; i++) {
    value += amplitude * noise2D(x * frequency, y * frequency);
    maxValue += amplitude;
    amplitude *= 0.5;  // Persistence
    frequency *= 2.0;  // Lacunarity
  }
  
  return value / maxValue;  // Normalize
}
```

**Parameters:**
- **Octaves**: Number of layers (more = finer detail)
- **Persistence**: How much each octave contributes (0.5 = each is half the previous)
- **Lacunarity**: Frequency multiplier (2.0 = each octave is twice the frequency)

### Usage in Generative Art

**Flow fields:** Noise determines angle at each grid point.

**Terrain:** Noise determines height (see Subscapes).

**Turbulence:** Sum absolute values of noise for cloud-like turbulence.

**Domain warping:** Use noise to offset coordinates fed into another noise function.

```javascript
function domainWarpedNoise(x, y) {
  const offsetX = noise2D(x, y) * warpAmount;
  const offsetY = noise2D(x + 5.2, y + 1.3) * warpAmount;
  return noise2D(x + offsetX, y + offsetY);
}
```

---

## Color Theory & Palette Selection

### Tyler Hobbs' Approach

**14 probabilistic palettes in Fidenza:**
- Each color assigned a probability
- Example: 50% blue, 25% red, 10% yellow, etc.
- Most common: **Luxe** (16 colors)
- **Luxe-Derived**: Randomly subset Luxe palette, reassign probabilities (unpredictable, rarest)

### Matt DesLauriers (Subscapes)

**Three color selection strategies:**

1. **Predefined palettes** (hand-crafted or from libraries like chromotome)
2. **Predefined colors** (riso-colors, paper-colors)
3. **Procedural palettes** (OKLAB color space)

### OKLAB Color Space

**Why OKLAB?**
- Perceptually uniform (equal distances look equally different)
- Computationally cheap
- Great for procedural generation

**LCh coordinates** (cylindrical OKLAB):
- **L**: Lightness (0-100)
- **C**: Chroma (saturation, ~0-30)
- **h**: Hue (0-360°)

```javascript
// Screenprint style (Subscapes)
const L = 50;  // Medium lightness
const C = random(5, 20);  // Moderate chroma
const h = random(0, 360);  // Any hue
const backgroundColor = oklabToRGB(L, C, h);
const foregroundColor = 'white';

// Lino style
const L = 92;  // Very light
const C = 5;  // Low chroma
const h = random(0, 360);
const backgroundColor = oklabToRGB(L, C, h);
const foregroundColor = 'black';
```

### High Contrast Palettes

**Use WCAG contrast ratio:**

```javascript
function luminance(r, g, b) {
  // r, g, b in 0..1
  const rsRGB = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  const gsRGB = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  const bsRGB = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
  return 0.2126 * rsRGB + 0.7152 * gsRGB + 0.0722 * bsRGB;
}

function contrastRatio(color1, color2) {
  const L1 = luminance(...color1);
  const L2 = luminance(...color2);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

// WCAG AA requires 4.5:1 for normal text
// For art, aim for 3:1 minimum to avoid washed-out palettes
function hasGoodContrast(fg, bg) {
  return contrastRatio(fg, bg) >= 3.0;
}
```

### Palette Libraries

**Kjetil Golid's chromotome:**
- https://github.com/kgolid/chromotome
- Hand-curated color palettes from various sources
- Includes Sanza Wada's "Dictionary of Colour Combinations"

**riso-colors:**
- https://github.com/mattdesl/riso-colors
- Risograph printing colors (vivid, high-contrast)

**paper-colors:**
- https://github.com/mattdesl/paper-colors
- Background colors for colored paper stocks

### Color Selection Strategies

**1. Small palette, high repetition:**
- 3-5 colors
- High contrast
- Result: Bold, graphic

**2. Large palette, low repetition:**
- 10-16 colors
- Varied saturation/brightness
- Result: Rich, complex (Fidenza's Luxe palette)

**3. Analogous colors:**
- Colors close on hue wheel
- Varies lightness/saturation
- Result: Harmonious, subtle

**4. Complementary colors:**
- Opposite on hue wheel
- High energy, vibration
- Example: Blue + Orange, Red + Green

### Blending & Gradients

**Linear interpolation (LERP):**
```javascript
function lerpColor(c1, c2, t) {
  return {
    r: lerp(c1.r, c2.r, t),
    g: lerp(c1.g, c2.g, t),
    b: lerp(c1.b, c2.b, t)
  };
}
```

**Better: OKLAB interpolation:**
```javascript
function lerpColorOKLAB(c1, c2, t) {
  const lab1 = rgbToOKLAB(c1);
  const lab2 = rgbToOKLAB(c2);
  
  const lerpedLAB = {
    L: lerp(lab1.L, lab2.L, t),
    a: lerp(lab1.a, lab2.a, t),
    b: lerp(lab1.b, lab2.b, t)
  };
  
  return oklabToRGB(lerpedLAB);
}
```

### Evolution: Simple → Refined

**Simple:**
- 2-3 colors
- No gradients
- Hard edges

**Refined:**
- 8-12 colors with gradients
- Perceptually uniform blending (OKLAB)
- Diffuse lighting for shading
- Stepped intensity levels (discrete, not continuous) for more illustrative look

---

## Project Case Studies

### 1. Fidenza (Tyler Hobbs, 2021)

**Algorithm:** Flow field with thick curved rectangles

**Key features:**
- 7 scale modes (Small to Jumbo XL, Uniform, Micro-Uniform)
- Variable turbulence (None, Low, Medium, High)
- Collision checking (No Overlap, Relaxed, Anything Goes)
- Stroke styles: Standard, Super Blocks, Outlines, Soft Shapes
- Sharp edges mode (snapping to π * 0.2 increments)
- Spiral mode
- 14 probabilistic color palettes

**Density control:**
- Collision detection prevents overlap
- Scale mode controls size distribution
- Margin mode controls edge treatment

**Evolution:**
- Starts with flow field grid
- Adds chunky non-overlapping shapes
- Applies probabilistic colors
- Special modes (spiral, sharp edges) for variety

**Why it's beautiful:**
- Organic curves from flow field
- Clean spacing from collision detection
- Variety from probabilistic selection
- Balance between chaos and control

---

### 2. Subscapes (Matt DesLauriers, 2021)

**Algorithm:** Parametric 3D terrain + flow fields + isometric projection

**Key techniques:**
- Parametric geometry with simplex noise for terrain
- Quadtree subdivision for "patchwork" surface texture
- Poisson disk sampling for stroke placement (not grid!)
- Flow fields for stroke direction
- Raycasting for occlusion
- Diffuse lighting for color/thickness variation

**Traits:**
- 12 Styles (Acrylic, Pencil, Warhol, Neon, Riso, etc.)
- 5 Landscape types (Mountains, Hills, Coast, Summit, Waterfall)
- Patchwork on/off
- Blended colors (diffuse-based interpolation)
- Brushed (impressionistic thick strokes)
- Stippled (dots instead of lines)
- Grid placement vs Poisson disk
- Wireframe mode
- Lattice mode (rounded coordinates)

**Density control:**
- Patchwork cells have different stroke densities
- Poisson disk prevents clumping
- Raycasting prevents drawing occluded areas

**Color approach:**
- 18 named palettes (predefined)
- Procedural palettes using OKLAB LCh
- Multiply blend mode for Pencil style
- Riso colors (vivid, limited palette)

**Implementation size:** 17KB minified JavaScript (!)

**Why it's beautiful:**
- Topographic map aesthetic
- Clean isometric 2.5D
- Organic terrain meets illustrative strokes
- Variety from probabilistic traits

---

### 3. Meridian (Matt DesLauriers, 2021-2022)

**Aesthetic:** Minimal geometric forms, clean lines

**Techniques (inferred from visual analysis):**
- Geometric primitives (circles, lines, arcs)
- Precise alignment and spacing
- Limited color palettes (2-4 colors typically)
- Golden ratio proportions likely used
- Clean SVG output for book prints

**How to achieve the look:**
- Start with geometric constraints (grid, golden ratio)
- Use precise mathematical curves (arcs, circles)
- Limit color drastically
- Embrace negative space
- Use high contrast
- Export to SVG for crisp lines

---

### 4. Archetype (Kjetil Golid)

**Algorithm:** Recursive grid subdivision (quadtree)

**How subdivision works:**
1. Start with rectangle
2. Choose split axis (horizontal/vertical) randomly
3. Choose split position (gaussian around center)
4. Recurse on both child rectangles
5. Stop based on depth or area threshold

**Preventing overcrowding:**
- Max depth limit
- Min area threshold
- Probabilistic stopping (increases with depth)
- Inherited depth (creates regions of similar detail)

**Visual effect:**
- Patchwork quilt texture
- Varied cell sizes create rhythm
- Can apply different colors/patterns per cell

---

### 5. Ringers (Dmitri Cherniak)

**Algorithm:** Wrapping strings around pegs

**Concept:**
- Place pegs (points) in circle or other arrangement
- Wrap string around pegs following rules
- Simple rules → complex emergent patterns

**Pseudocode:**
```javascript
// Simplified concept
const pegs = placePegsInCircle(numPegs, radius);
const visited = new Set();
let currentPeg = 0;

const path = [pegs[currentPeg]];

for (let i = 0; i < numWraps; i++) {
  const nextPeg = chooseNextPeg(currentPeg, pegs, visited);
  path.push(pegs[nextPeg]);
  visited.add(`${currentPeg}-${nextPeg}`);
  currentPeg = nextPeg;
}

drawPath(path);
```

**Why it works:**
- Constraints (peg positions) + simple rules = emergent beauty
- Symmetry from circular arrangement
- Variety from different wrap patterns

---

### 6. Terraforms (Mathcastles)

**Algorithm:** Fully onchain, text-based, evolving

**Key features:**
- Generated entirely from blockchain data
- ASCII/Unicode art
- Evolves over time (uses block data)
- Fully deterministic from seed

**Techniques:**
- Cellular automata
- Procedural symbol selection
- Grid-based rendering
- Uses block hash as entropy source

---

### 7. Autoglyphs (Larva Labs, 2019)

**Algorithm:** First onchain generative art, simple ASCII

**How it works:**
- Algorithm stored in Ethereum smart contract
- Each mint executes algorithm on-chain
- Output: ASCII art patterns (e.g., interference patterns)
- Limited to 512 editions

**Aesthetic constraints:**
- Must fit in single transaction (tiny code!)
- ASCII characters only
- Interference/moiré patterns
- Simple but rich in variation

**Historical significance:**
- First art where the algorithm IS the artwork (fully onchain)
- Launched entire onchain generative art movement

---

## Advanced Algorithms

### Reaction-Diffusion (Turing Patterns)

**What it is:** Simulates chemical reactions that create organic patterns (spots, stripes, labyrinth patterns).

**Gray-Scott Model:**

```javascript
function reactionDiffusion(grid, iterations) {
  const next = copyGrid(grid);
  
  for (let iter = 0; iter < iterations; iter++) {
    for (let x = 1; x < width - 1; x++) {
      for (let y = 1; y < height - 1; y++) {
        const A = grid[x][y].A;
        const B = grid[x][y].B;
        
        // Laplacian (diffusion)
        const laplaceA = laplacian(grid, x, y, 'A');
        const laplaceB = laplacian(grid, x, y, 'B');
        
        // Reaction
        const reaction = A * B * B;
        
        // Update
        next[x][y].A = A + (DA * laplaceA - reaction + F * (1 - A)) * dt;
        next[x][y].B = B + (DB * laplaceB + reaction - (K + F) * B) * dt;
      }
    }
    
    grid = next;
  }
  
  return grid;
}

function laplacian(grid, x, y, chemical) {
  const center = grid[x][y][chemical];
  const neighbors = 
    grid[x-1][y][chemical] +
    grid[x+1][y][chemical] +
    grid[x][y-1][chemical] +
    grid[x][y+1][chemical];
  
  return neighbors - 4 * center;
}
```

**Parameters:**
- `DA`, `DB`: Diffusion rates
- `F`: Feed rate
- `K`: Kill rate

**Tuning F and K produces different patterns:**
- Spots
- Stripes
- Labyrinth/maze
- Coral-like growth

**Use in art:**
- Organic textures
- Natural-looking patterns
- Evolving animations

**SVG vs Canvas:** Raster only (Canvas). Requires pixel-level simulation.

---

### Interference/Moiré Patterns

**What they are:** Overlapping wave functions create complex patterns.

```javascript
function moirePattern(x, y) {
  const freq1 = 20;
  const freq2 = 22;  // Slightly different
  const angle1 = 0;
  const angle2 = Math.PI / 12;  // Slight rotation
  
  const wave1 = Math.sin((x * Math.cos(angle1) + y * Math.sin(angle1)) * freq1);
  const wave2 = Math.sin((x * Math.cos(angle2) + y * Math.sin(angle2)) * freq2);
  
  return (wave1 + wave2) * 0.5;
}
```

**Creating moiré:**
- Overlay slightly different frequencies
- Rotate one pattern slightly
- Use different waveforms (sine, square, etc.)

**Seen in:** Autoglyphs, Subscapes #210 (accidental emergent pattern)

---

### Sacred Geometry

**Golden Ratio (φ ≈ 1.618):**

```javascript
const PHI = (1 + Math.sqrt(5)) / 2;

function goldenSpiral(iterations) {
  let size = 1;
  const points = [];
  
  for (let i = 0; i < iterations; i++) {
    // Draw quarter circle arc
    points.push(createArc(size));
    size *= PHI;
  }
  
  return points;
}
```

**Fibonacci tiling:**
- Subdivide rectangles using Fibonacci numbers
- Each rectangle's dimensions follow Fibonacci sequence
- Creates natural, pleasing proportions

**Platonic solids:**
- Tetrahedron, cube, octahedron, dodecahedron, icosahedron
- Project 3D wireframes to 2D
- Use as underlying grids for generative patterns

---

## SVG vs Canvas: When to Use Each

### Use SVG When:

✅ **Vector graphics are essential**
- Plotter output
- Prints that need infinite scaling
- Clean geometric art

✅ **You need individual element manipulation**
- Each shape as separate DOM element
- Easy to add interactivity
- Can inspect/edit in browser

✅ **File size is small**
- Few thousand paths max
- Clean, non-overlapping shapes
- Simple shapes (circles, lines, polygons)

✅ **Algorithms:**
- Recursive subdivision
- Flow fields (non-overlapping curves)
- Geometric compositions
- Voronoi diagrams
- Pen plotter art

### Use Canvas When:

✅ **Raster effects needed**
- Blurring, blending modes, alpha compositing
- Texture overlays
- Pixel-level manipulation

✅ **Performance is critical**
- Tens of thousands of shapes
- Real-time animation
- Dense, overlapping elements

✅ **Algorithms:**
- Dense flow fields with overlap
- Reaction-diffusion
- Pixel-based noise visualizations
- Particle systems
- Image manipulation

### Hybrid Approach

**Best of both worlds:**
1. Generate with Canvas for performance/effects
2. Export to SVG using libraries like `canvas2svg`
3. Or: Generate vector data, render to both Canvas and SVG

**Example:**
```javascript
// Generate once
const paths = generateFlowFieldPaths();

// Render to Canvas for preview
renderToCanvas(paths, canvasCtx);

// Export to SVG for plotter
exportToSVG(paths, 'output.svg');
```

---

## Implementation Checklist

### Starting a New Generative Art Project

**1. Choose your algorithm(s):**
- Flow fields for organic curves?
- Recursive subdivision for geometric patterns?
- Parametric 3D for landscape/topography?
- Combination?

**2. Set up your environment:**
- p5.js for quick sketching
- Custom canvas/SVG for production
- Noise library (simplex-noise)
- Color library (chroma.js or custom OKLAB)

**3. Core loop:**
```javascript
function generate(seed) {
  random.setSeed(seed);
  
  // 1. Generate structure
  const structure = generateStructure();
  
  // 2. Apply variation/traits
  const traits = selectTraits();
  
  // 3. Choose colors
  const palette = selectPalette(traits);
  
  // 4. Render
  render(structure, traits, palette);
}
```

**4. Density control:**
- Start sparse, iterate to desired density
- Use collision detection or minimum distance checks
- Apply stopping conditions (depth, area, probability)

**5. Evolution (simple → refined):**
- Low depth/iterations first
- Add details progressively
- Use hierarchical structures (big shapes contain small shapes)
- Apply probabilistic variation carefully

**6. Color:**
- Start with 2-3 colors
- Test high contrast first
- Add more colors gradually
- Use OKLAB for procedural generation

**7. Test & iterate:**
- Generate 100+ outputs
- Identify problems (too cluttered? too sparse?)
- Adjust parameters
- Repeat

---

## Key Principles for Beautiful Generative Art

### 1. Constraint Breeds Creativity
- Limited color palettes
- Simple geometric rules
- Tight code size (like onchain art)

### 2. Balance Randomness and Control
- Use seeds for reproducibility
- Weighted probabilities, not pure random
- Add constraints that prevent "ugly" outputs

### 3. Negative Space Is Essential
- Don't fill every pixel
- Margins and breathing room
- Sparse can be more powerful than dense

### 4. Evolution Over Repetition
- Start simple, add complexity
- Create regions of coherence
- Use inheritance/hierarchy

### 5. Study Nature and Art History
- Flow fields = fluid dynamics
- Reaction-diffusion = animal patterns
- Sacred geometry = classical proportions
- Learn from masters (Vera Molnár, Bridget Riley, etc.)

### 6. The Algorithm IS the Art
- Code quality matters
- Generative process is part of the work
- Onchain art: code is permanent artifact

---

## Further Reading

**Tyler Hobbs' Essays:**
- "Flow Fields" (2020) — https://tylerxhobbs.com/words/flow-fields
- "Aesthetically Pleasing Triangle Subdivision" (2017)
- "A Randomized Approach to Circle Packing"

**Matt DesLauriers' Substack:**
- Subscapes (Parts 1-3) — Technical deep dive into parametric terrain
- GitHub: https://github.com/mattdesl/subscapes

**Books:**
- "The Nature of Code" by Daniel Shiffman
- "Generative Design" by Bohnacker, Gross, Laub
- "The Computational Beauty of Nature" by Gary Flake

**Libraries:**
- simplex-noise (https://github.com/jwagner/simplex-noise.js)
- chroma.js (color manipulation)
- d3-delaunay (Voronoi/Delaunay)
- p5.js (creative coding framework)

**Kjetil Golid:**
- Generated.space — https://generated.space
- GitHub: https://github.com/kgolid
- chromotome (color palettes): https://github.com/kgolid/chromotome

---

**This document is implementation-ready. Every algorithm includes pseudocode or actual code snippets. Use this as a foundation to build your own generative art algorithms.**

**Good luck, and remember: the beauty emerges from the balance between randomness and control, chaos and constraint.**
