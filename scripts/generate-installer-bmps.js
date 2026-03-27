/**
 * Generates branded BMP images for the NSIS installer.
 *
 * - Sidebar  (164 × 314 px) — shown on Welcome & Finish pages
 * - Header   (150 × 57 px)  — shown on every intermediate page
 *
 * Run:  node scripts/generate-installer-bmps.js
 */

const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')

// ── Brand palette (from icon.png) ──────────────────────────────────────────
const DEEP_NAVY = [10, 14, 39]       // #0A0E27
const MID_NAVY  = [18, 22, 52]       // #121634
const BLUE      = [68, 102, 255]     // #4466FF
const PURPLE    = [124, 107, 255]    // #7C6BFF
const LAVENDER  = [184, 160, 255]    // #B8A0FF
const WHITE     = [245, 245, 255]    // #F5F5FF

// ── BMP writer ─────────────────────────────────────────────────────────────

function writeBmp(path, width, height, pixelFn) {
  const rowBytes = width * 3
  const rowPad = (4 - (rowBytes % 4)) % 4
  const rowStride = rowBytes + rowPad
  const dataSize = rowStride * height
  const fileSize = 54 + dataSize

  const buf = Buffer.alloc(fileSize)

  // File header (14 bytes)
  buf.write('BM', 0)
  buf.writeUInt32LE(fileSize, 2)
  buf.writeUInt32LE(0, 6)        // reserved
  buf.writeUInt32LE(54, 10)      // pixel data offset

  // Info header (40 bytes)
  buf.writeUInt32LE(40, 14)
  buf.writeInt32LE(width, 18)
  buf.writeInt32LE(height, 22)   // positive = bottom-up
  buf.writeUInt16LE(1, 26)       // planes
  buf.writeUInt16LE(24, 28)      // bpp
  buf.writeUInt32LE(0, 30)       // compression
  buf.writeUInt32LE(dataSize, 34)
  buf.writeInt32LE(2835, 38)     // X ppi (~72 dpi)
  buf.writeInt32LE(2835, 42)     // Y ppi
  buf.writeUInt32LE(0, 46)       // colors used
  buf.writeUInt32LE(0, 50)       // important colors

  // Pixel data (bottom-up, BGR)
  for (let y = 0; y < height; y++) {
    const bmpRow = height - 1 - y // BMP is bottom-up, y=0 is top visually
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y, width, height)
      const offset = 54 + bmpRow * rowStride + x * 3
      buf[offset] = b
      buf[offset + 1] = g
      buf[offset + 2] = r
    }
  }

  writeFileSync(path, buf)
  console.log(`  ${path}  (${width}×${height})`)
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t)
}

function lerpColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]
}

// ── Sidebar (164 × 314) ───────────────────────────────────────────────────
// Vertical gradient: deep navy top → mid navy bottom
// Accent stripe near bottom (blue→purple horizontal gradient)
// Subtle glow spot in upper area

function sidebarPixel(x, y, w, h) {
  const ty = y / h // 0 at top, 1 at bottom

  // Base: vertical gradient
  let color = lerpColor(DEEP_NAVY, MID_NAVY, ty)

  // Subtle center glow (radial, centered at 40% from top, 50% horizontal)
  const cx = w * 0.5
  const cy = h * 0.35
  const dx = (x - cx) / w
  const dy = (y - cy) / h
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist < 0.45) {
    const glow = Math.pow(1 - dist / 0.45, 2.5) * 0.15
    color = lerpColor(color, PURPLE, glow)
  }

  // Accent stripe: horizontal band at y ≈ 78-82% of height
  const stripeCenter = 0.80
  const stripeHalf = 0.012
  const stripeDist = Math.abs(ty - stripeCenter)
  if (stripeDist < stripeHalf) {
    const stripeT = 1 - stripeDist / stripeHalf
    const stripeAlpha = Math.pow(stripeT, 1.5) * 0.85
    const stripeColor = lerpColor(BLUE, PURPLE, x / w)
    color = lerpColor(color, stripeColor, stripeAlpha)
  }

  // Second thinner accent stripe above
  const stripe2Center = 0.76
  const stripe2Half = 0.004
  const stripe2Dist = Math.abs(ty - stripe2Center)
  if (stripe2Dist < stripe2Half) {
    const s2T = 1 - stripe2Dist / stripe2Half
    const s2Alpha = Math.pow(s2T, 1.5) * 0.4
    color = lerpColor(color, LAVENDER, s2Alpha)
  }

  // Bottom edge: subtle gradient to slightly lighter
  if (ty > 0.92) {
    const bottomT = (ty - 0.92) / 0.08
    color = lerpColor(color, [15, 19, 45], bottomT * 0.5)
  }

  return color
}

// ── Header (150 × 57) ─────────────────────────────────────────────────────
// Horizontal gradient: deep navy left → mid navy right
// Thin accent line at bottom

function headerPixel(x, y, w, h) {
  const tx = x / w
  const ty = y / h

  // Base: horizontal gradient
  let color = lerpColor(DEEP_NAVY, MID_NAVY, tx)

  // Subtle diagonal glow
  const gx = (x - w * 0.7) / w
  const gy = (y - h * 0.3) / h
  const gDist = Math.sqrt(gx * gx + gy * gy)
  if (gDist < 0.5) {
    const glow = Math.pow(1 - gDist / 0.5, 3) * 0.12
    color = lerpColor(color, BLUE, glow)
  }

  // Bottom accent line (2px)
  if (ty > 0.93) {
    const lineT = (ty - 0.93) / 0.07
    const lineColor = lerpColor(BLUE, PURPLE, tx)
    color = lerpColor(color, lineColor, Math.pow(lineT, 0.5) * 0.9)
  }

  return color
}

// ── Generate ───────────────────────────────────────────────────────────────

const buildDir = join(__dirname, '..', 'build')
mkdirSync(buildDir, { recursive: true })

console.log('Generating installer images...')
writeBmp(join(buildDir, 'installerSidebar.bmp'), 164, 314, sidebarPixel)
writeBmp(join(buildDir, 'installerHeader.bmp'), 150, 57, headerPixel)
console.log('Done.')
