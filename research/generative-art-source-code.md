# Generative Art Source Code Research
**Research Date:** February 25, 2026  
**Purpose:** Implementation-level study of onchain generative art renderers and clean generative art techniques

---

## Table of Contents
1. [Tyler Hobbs: Flow Fields & Techniques](#tyler-hobbs-flow-fields--techniques)
2. [Autoglyphs: Onchain ASCII Art](#autoglyphs-onchain-ascii-art)
3. [Matt DesLauriers: Creative Coding Resources](#matt-deslauriers-creative-coding-resources)
4. [P5.js Flow Field Implementations](#p5js-flow-field-implementations)
5. [Onchain SVG Resources](#onchain-svg-resources)
6. [Daniel Shiffman / Coding Train](#daniel-shiffman--coding-train)
7. [Key Takeaways](#key-takeaways)

---

## Tyler Hobbs: Flow Fields & Techniques

### Flow Fields Essay
**URL:** https://www.tylerxhobbs.com/words/flow-fields

#### Core Concept: Grid of Angles

```javascript
// Initialize flow field grid (pseudocode from Tyler's essay)
left_x = int(width * -0.5)
right_x = int(width * 1.5)
top_y = int(height * -0.5)
bottom_y = int(height * 1.5)
resolution = int(width * 0.01)
num_columns = (right_x - left_x) / resolution
num_rows = (bottom_y - top_y) / resolution
grid = float[num_columns][num_rows]

// Initialize with angles
default_angle = PI * 0.25
for (column in num_columns) {
  for (row in num_rows) {
    grid[column][row] = default_angle
  }
}
```

**Key Parameters:**
- **Resolution:** ~0.5% of image width (balance between detail and performance)
- **Grid bounds:** 50% margin outside image (allows curves to flow back into frame)
- **Step length:** 0.1% to 0.5% of image width (avoid sharp points)

#### Drawing Curves Through the Field

```javascript
// Draw a curve through the flow field
x = 500
y = 100
begin_curve()
for (n in [0..num_steps]) {
  draw_vertex(x, y)
  
  x_offset = x - left_x
  y_offset = y - top_y
  column_index = int(x_offset / resolution)
  row_index = int(y_offset / resolution)
  
  grid_angle = grid[column_index][row_index]
  
  x_step = step_length * cos(grid_angle)
  y_step = step_length * sin(grid_angle)
  
  x = x + x_step
  y = y + y_step
}
end_curve()
```

#### Distortion Techniques

**Perlin Noise (most common, but overdone):**
```javascript
for (column in num_columns) {
  for (row in num_rows) {
    // Processing's noise() works best when step is ~0.005
    scaled_x = column * 0.005
    scaled_y = row * 0.005
    
    noise_val = noise(scaled_x, scaled_y)
    
    // Translate noise (0.0-1.0) to angle (0-2π)
    angle = map(noise_val, 0.0, 1.0, 0.0, PI * 2.0)
    
    grid[column][row] = angle
  }
}
```

**Non-Continuous Distortions (for more structured forms):**
- Round angles to multiples of π/10 or π/4
- Random angle per row or per cell
- Creates more geometric, crystalline structures

#### Curve Length Effects
- **Short curves (low num_steps):** "fur" texture, rougher, flatter feeling
- **Long curves (high num_steps):** fluid, smoother, visible flow lines
- **Color blending:** Short curves keep colors separate; long curves blend extensively

#### Starting Point Strategies
1. **Regular grid:** Simple, can feel stiff
2. **Uniformly random:** Looser but creates clumps/sparse areas
3. **Circle packing:** Best balance—even spacing with organic variation

**Tyler's Recommendation:** Don't rely on Perlin noise. Create custom distortion techniques for unique results.

---

### Watercolor Simulation Essay
**URL:** https://www.tylerxhobbs.com/words/a-guide-to-simulating-watercolor-paint-with-generative-art

#### Core Technique: Recursive Polygon Deformation

**Algorithm:**
1. For each line A → C in polygon, find midpoint B
2. From Gaussian distribution centered on B, pick new point B'
3. Replace line A → C with two lines: A → B' and B' → C
4. Recurse until max depth

#### Implementation Process

**Step 1: Create Base Polygon**
- Run deformation ~7 times on input polygon
- This becomes the "base polygon" for all layers

**Step 2: Layer Stacking**
- Start with base polygon
- Deform 4-5 more times per layer
- Draw with ~4% opacity
- Repeat for 30-100 layers

**Result:** Soft edges from accumulated semi-transparent layers

#### Refinement: Variable Variance

```clojure
; Assign variance to each segment
; High variance = large changes, soft edges
; Low variance = small changes, sharp edges
; Children inherit parent variance (with decay + randomization)
```

#### Refinement: Texture Masking

```clojure
; Draw watercolor blob shape
(with-graphics the-blob-mask
  (background 0 0 0)
  (stroke 0 0 layer-alpha)
  (fill 0 0 layer-alpha)
  (begin-shape)
  (doseq [[x y] final-poly]
    (vertex x y))
  (end-shape))

; Draw random circles onto texture mask
(with-graphics the-texture-mask
  (background 0 0 0)
  (no-stroke)
  (fill 0 0 layer-alpha)
  (doseq [j (range 900)]
    (let [x (random 0 (w))
          y (random 0 (h))
          len (abs-gauss (w 0.03) (w 0.02))
          [hue sat bright] (color-fn)]
      (fill hue sat bright)
      (ellipse x y len len)))
      
; Blend blob with texture using :darkest mode
(blend the-blob-mask 0 0 (w) (h) 0 0 (w) (h) :darkest))

; Apply combined mask
(with-graphics the-overlay
  (background 5 80 80)
  (mask-image the-texture-mask))
  
; Apply to canvas
(image the-overlay 0 0)
```

**Color Blending:**
- Interleave layers of different colors (5 red, 5 yellow, 5 red...)
- Creates organic blending without full mixing
- Short curves preserve color separation

**Examples:**
- Isohedral XI (2017) - Watercolor with geometric patterns
- Linear II (2017) - Linear elements with watercolor texture

---

## Autoglyphs: Onchain ASCII Art

**Contract Address:** `0xd4e4078ca3495DE5B1d4dB434BEbc5a986197782`  
**Blockchain:** Ethereum Mainnet  
**Creators:** Matt Hall & John Watkinson (Larva Labs)  
**URL:** https://etherscan.io/address/0xd4e4078ca3495DE5B1d4dB434BEbc5a986197782#code

### Drawing Instructions

The output is a 64×64 grid of symbols. Each symbol corresponds to drawing instructions:

- `.` Draw nothing
- `O` Draw circle bounded by cell
- `+` Centered vertical + horizontal lines
- `X` Diagonal lines (corners)
- `|` Centered vertical line
- `-` Centered horizontal line
- `\` Top-left to bottom-right diagonal
- `/` Bottom-left to top-right diagonal
- `#` Fill cell completely

### Core Drawing Algorithm (Solidity)

```solidity
int constant ONE = int(0x100000000);
uint constant USIZE = 64;
int constant SIZE = int(USIZE);
int constant HALF_SIZE = SIZE / int(2);

int constant SCALE = int(0x1b81a81ab1a81a823);
int constant HALF_SCALE = SCALE / int(2);

bytes prefix = "data:text/plain;charset=utf-8,";

function draw(uint id) public view returns (string) {
    uint a = uint(uint160(keccak256(abi.encodePacked(idToSeed[id]))));
    bytes memory output = new bytes(USIZE * (USIZE + 3) + 30);
    uint c;
    
    // Add prefix
    for (c = 0; c < 30; c++) {
        output[c] = prefix[c];
    }
    
    int x = 0;
    int y = 0;
    uint v = 0;
    uint value = 0;
    uint mod = (a % 11) + 5;
    bytes5 symbols;
    
    // Select symbol scheme based on id
    if (idToSymbolScheme[id] == 1) {
        symbols = 0x2E582F5C2E; // X/\.
    } else if (idToSymbolScheme[id] == 2) {
        symbols = 0x2E2B2D7C2E; // +-|.
    } else if (idToSymbolScheme[id] == 3) {
        symbols = 0x2E2F5C2E2E; // /\.
    } else if (idToSymbolScheme[id] == 4) {
        symbols = 0x2E5C7C2D2F; // \|-/
    } else if (idToSymbolScheme[id] == 5) {
        symbols = 0x2E4F7C2D2E; // O|-.
    } else if (idToSymbolScheme[id] == 6) {
        symbols = 0x2E5C5C2E2E; // \\.
    } else if (idToSymbolScheme[id] == 7) {
        symbols = 0x2E237C2D2B; // #|-+
    } else if (idToSymbolScheme[id] == 8) {
        symbols = 0x2E4F4F2E2E; // OO.
    } else if (idToSymbolScheme[id] == 9) {
        symbols = 0x2E232E2E2E; // #.
    } else {
        symbols = 0x2E234F2E2E; // #O.
    }
    
    // Generate pattern
    for (int i = int(0); i < SIZE; i++) {
        y = (2 * (i - HALF_SIZE) + 1);
        if (a % 3 == 1) {
            y = -y;
        } else if (a % 3 == 2) {
            y = abs(y);
        }
        y = y * int(a);
        
        for (int j = int(0); j < SIZE; j++) {
            x = (2 * (j - HALF_SIZE) + 1);
            if (a % 2 == 1) {
                x = abs(x);
            }
            x = x * int(a);
            
            v = uint(x * y / ONE) % mod;
            if (v < 5) {
                value = uint(symbols[v]);
            } else {
                value = 0x2E;
            }
            output[c] = byte(bytes32(value << 248));
            c++;
        }
        
        // Add line break (%0A)
        output[c] = byte(0x25);
        c++;
        output[c] = byte(0x30);
        c++;
        output[c] = byte(0x41);
        c++;
    }
    
    string memory result = string(output);
    return result;
}
```

### Scheme Selection Algorithm

```solidity
function getScheme(uint a) internal pure returns (uint8) {
    uint index = a % 83;
    uint8 scheme;
    if (index < 20) {
        scheme = 1;
    } else if (index < 35) {
        scheme = 2;
    } else if (index < 48) {
        scheme = 3;
    } else if (index < 59) {
        scheme = 4;
    } else if (index < 68) {
        scheme = 5;
    } else if (index < 73) {
        scheme = 6;
    } else if (index < 77) {
        scheme = 7;
    } else if (index < 80) {
        scheme = 8;
    } else if (index < 82) {
        scheme = 9;
    } else {
        scheme = 10;
    }
    return scheme;
}
```

### Key Insights from Autoglyphs

1. **Deterministic from seed:** Every glyph generated from `keccak256(seed)`
2. **Mathematical pattern generation:** Uses `x * y / ONE % mod` for grid pattern
3. **Symbol palette per scheme:** 10 different schemes, each with 5 symbols
4. **Symmetry variations:** Conditional negation/abs() based on seed modulo
5. **Data URI output:** Returns data URL that can be rendered directly
6. **Fully onchain:** No external dependencies, entirely self-contained

**Contract Size:** The entire generative algorithm fits in a single Solidity contract (~1000 lines)

---

## Matt DesLauriers: Creative Coding Resources

**GitHub:** https://github.com/mattdesl  
**Website:** https://mattdesl.com/  
**Twitter:** @mattdesl

### canvas-sketch Framework

**Repository:** https://github.com/mattdesl/canvas-sketch  
**Stars:** 5.2k  
**Description:** "[beta] A framework for making generative artwork in JavaScript and the browser."

**Why It's Important:**
- Industry-standard tool for generative art
- Used by professionals at Art Blocks, fxhash, etc.
- Clean API for canvas/WebGL rendering
- Built-in export to high-res images
- Time-based animations
- Hot reloading during development

**Example Projects:**
- lcms-wasm - Color processing for browser
- Numerous generative art tools and utilities

### Notable Repositories to Study

**Recommended Matt DesLauriers GitHub exploration:**
1. **canvas-sketch** - Main framework
2. **canvas-sketch-util** - Utilities for generative art (random, math, color)
3. Check his 638 repositories for examples
4. Look at his pinned repos for current focus

---

## P5.js Flow Field Implementations

**GitHub Search:** https://github.com/search?q=p5.js+flow+field&type=repositories

### Notable Repos Found

1. **ZevaGuillo/Flow-Field**
   - URL: https://github.com/ZevaGuillo/Flow-Field
   - Description: Generator of a FlowField based on particles created with P5.js
   - Language: JavaScript
   - Good for: Basic flow field particle systems

2. **SerotoninShane/Flow-Field**
   - URL: https://github.com/SerotoninShane/Flow-Field
   - Description: Experimentation with p5.js
   - Recently updated (April 2025)

### General Pattern in P5.js Flow Fields

```javascript
// Typical p5.js flow field structure
let particles = [];
let flowField = [];
let cols, rows;
let scale = 20;

function setup() {
  createCanvas(800, 800);
  cols = floor(width / scale);
  rows = floor(height / scale);
  
  // Initialize flow field
  flowField = new Array(cols * rows);
  for (let i = 0; i < 1000; i++) {
    particles[i] = new Particle();
  }
  background(255);
}

function draw() {
  // Update flow field (often using Perlin noise)
  let yoff = 0;
  for (let y = 0; y < rows; y++) {
    let xoff = 0;
    for (let x = 0; x < cols; x++) {
      let index = x + y * cols;
      let angle = noise(xoff, yoff, frameCount * 0.001) * TWO_PI * 2;
      let v = p5.Vector.fromAngle(angle);
      v.setMag(0.5);
      flowField[index] = v;
      xoff += 0.1;
    }
    yoff += 0.1;
  }
  
  // Update and display particles
  for (let i = 0; i < particles.length; i++) {
    particles[i].follow(flowField);
    particles[i].update();
    particles[i].show();
  }
}

class Particle {
  constructor() {
    this.pos = createVector(random(width), random(height));
    this.vel = createVector(0, 0);
    this.acc = createVector(0, 0);
    this.maxSpeed = 2;
  }
  
  follow(vectors) {
    let x = floor(this.pos.x / scale);
    let y = floor(this.pos.y / scale);
    let index = x + y * cols;
    let force = vectors[index];
    this.applyForce(force);
  }
  
  applyForce(force) {
    this.acc.add(force);
  }
  
  update() {
    this.vel.add(this.acc);
    this.vel.limit(this.maxSpeed);
    this.pos.add(this.vel);
    this.acc.mult(0);
  }
  
  show() {
    stroke(0, 5);
    strokeWeight(1);
    point(this.pos.x, this.pos.y);
  }
}
```

---

## Onchain SVG Resources

### Search Results

**GitHub Code Search:** https://github.com/search?q=onchain+svg+generative+art+solidity&type=code
- Found 800 code results (repository-level search returned 0, but code search found implementations)

### Nouns NFT Descriptor

**Monorepo:** https://github.com/nouns-monorepo/nouns-monorepo  
**Contracts:** `/packages/nouns-contracts/contracts/`

**Key Files to Study:**
- `NounsDescriptor.sol` - Main SVG assembly logic
- `SVGRenderer.sol` - SVG string building
- `NFTDescriptor.sol` - Metadata generation

**Pattern for Onchain SVG:**

```solidity
// Typical onchain SVG pattern
function tokenURI(uint256 tokenId) external view returns (string memory) {
    string memory svg = generateSVG(tokenId);
    string memory json = string(abi.encodePacked(
        '{"name": "Token #', tokenId.toString(), '",',
        '"description": "Onchain generative art",',
        '"image": "data:image/svg+xml;base64,', Base64.encode(bytes(svg)), '"}'
    ));
    return string(abi.encodePacked(
        'data:application/json;base64,',
        Base64.encode(bytes(json))
    ));
}

function generateSVG(uint256 tokenId) internal view returns (string memory) {
    bytes memory svg = abi.encodePacked(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">',
        // Generate shapes based on tokenId
        '</svg>'
    );
    return string(svg);
}
```

### Terraforms Renderer

**Known pattern:** Terraforms uses onchain HTML/SVG with embedded JavaScript for dynamic rendering
- Research URL: Search for "Terraforms Mathcastles" contract

---

## Daniel Shiffman / Coding Train

**Website:** https://thecodingtrain.com/challenges  
**YouTube:** The Coding Train channel  
**GitHub:** https://github.com/CodingTrain

### Flow Field Specific Tutorials

**Search for:**
- "Coding Challenge #24: Perlin Noise Flow Field"
- "Coding Challenge #132: Fluid Simulation"

**Teaching Style:**
- Step-by-step live coding
- Explains concepts in plain English
- Shows mistakes and debugging process
- Perfect for understanding implementation details

### Recommended Coding Train Challenges for Clean Generative Art

1. **Flow Fields** - Perlin noise-based particle systems
2. **10PRINT** - Recursive maze-like patterns (very clean)
3. **Space Colonization** - Tree/branch generation
4. **Reaction Diffusion** - Turing patterns
5. **Circle Packing** - Organic space filling
6. **Fractal Trees** - Recursive structures
7. **L-Systems** - Lindenmayer systems for plant-like forms

**Why Coding Train:**
- All code available on GitHub
- p5.js web editor links
- Community examples and variations

---

## Key Takeaways

### For Onchain Rendering

1. **Keep it deterministic:** Use seed → keccak256 → modulo arithmetic
2. **Symbol-based approach works:** Autoglyphs proves ASCII art is viable
3. **SVG is powerful:** Nouns shows complex SVG assembly onchain
4. **Gas considerations:** Pre-calculate where possible, store palettes efficiently
5. **Data URIs:** Return base64-encoded SVG/JSON directly

### For Clean Generative Output

1. **Less is more:**
   - Limit color palettes (2-5 colors)
   - Use negative space deliberately
   - Don't fill every pixel

2. **Flow fields work best when:**
   - Custom distortion (not just Perlin noise)
   - Thoughtful starting point distribution (circle packing)
   - Appropriate curve length for desired texture

3. **Watercolor technique for soft aesthetics:**
   - Many semi-transparent layers (30-100)
   - Recursive polygon deformation
   - Texture masking with random elements
   - Variable variance for sharp + soft edges

4. **Structure through mathematics:**
   - Symmetry operations (flip, rotate, mirror)
   - Modulo patterns (like Autoglyphs)
   - Recursive subdivision
   - Circle packing for organic spacing

### Implementation Strategy

**For a clean onchain renderer:**

1. Choose a mathematical core (flow field, subdivision, grid pattern)
2. Limit the symbol/shape palette (3-10 elements)
3. Use seed for all randomness
4. Output SVG or data URI
5. Test gas costs early
6. Make it deterministic and reproducible

**Recommended starting point:**
- Study Autoglyphs for simplicity
- Study Tyler Hobbs for aesthetic refinement
- Study Matt DesLauriers' canvas-sketch for modern workflow
- Study Coding Train for learning implementation

---

## Additional Resources to Explore

### Books
- "Generative Design" by Benedikt Groß (p5.js examples online)
- "The Nature of Code" by Daniel Shiffman (free online)

### Platforms with Open Source
- **Art Blocks:** Look for "view source" links
- **fxhash:** Many artists share code
- **OpenProcessing:** p5.js sketches with source

### GitHub Topics to Search
- `generative-art`
- `creative-coding`
- `p5js`
- `canvas-sketch`
- `onchain-nft`
- `solidity-art`

---

**End of Research Document**

*This document represents implementation-level findings from generative art source code, focusing on clean output and onchain rendering capabilities.*
