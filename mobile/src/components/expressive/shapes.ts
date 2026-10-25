// Material 3 Expressive shape library (cookie, clover, sunny, pill, …), built as
// point lists so any two shapes can be morphed point by point. Every shape has
// the same number of points, starts at angle 0 and fits a unit box (-1..1).

export const POINTS = 96

export type ShapeName =
  | 'circle'
  | 'square'
  | 'slanted'
  | 'arch'
  | 'pill'
  | 'oval'
  | 'triangle'
  | 'pentagon'
  | 'gem'
  | 'sunny'
  | 'verySunny'
  | 'cookie4'
  | 'cookie6'
  | 'cookie7'
  | 'cookie9'
  | 'cookie12'
  | 'clover4'
  | 'clover8'
  | 'flower'
  | 'burst'
  | 'softBurst'
  | 'puffy'
  | 'ghostish'

type Gen = (t: number) => [number, number]

const polar =
  (r: (t: number) => number): Gen =>
  (t) => {
    const v = r(t)
    return [v * Math.cos(t), v * Math.sin(t)]
  }

// Smooth bumps: round lobes, round valleys.
const cookie = (n: number, depth: number) => polar((t) => 1 - depth * (0.5 - 0.5 * Math.cos(n * t)))
// Round lobes with pinched valleys.
const clover = (n: number, depth: number, soft = 1) => polar((t) => 1 - depth + depth * Math.pow(Math.abs(Math.cos((n * t) / 2)), soft))
// Pointed tips with round valleys.
const sunny = (n: number, depth: number) => polar((t) => 1 - depth * Math.pow(Math.abs(Math.sin((n * t) / 2)), 0.8))
// Regular polygon with its corners pulled towards a circle.
const polygon = (n: number, round: number, turn = -Math.PI / 2) =>
  polar((t) => {
    const seg = (2 * Math.PI) / n
    const a = (((t - turn) % seg) + seg) % seg
    const flat = Math.cos(Math.PI / n) / Math.cos(a - Math.PI / n)
    return flat * (1 - round) + round * 0.9
  })
// Superellipse: squircles, pills and ovals.
const superellipse =
  (a: number, b: number, n: number): Gen =>
  (t) => {
    const c = Math.cos(t)
    const s = Math.sin(t)
    return [a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)]
  }
const rotate =
  (g: Gen, angle: number): Gen =>
  (t) => {
    const [x, y] = g(t)
    return [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)]
  }

const GENERATORS: Record<ShapeName, Gen> = {
  circle: polar(() => 1),
  square: superellipse(1, 1, 5),
  slanted: rotate(superellipse(1, 0.86, 4.5), -0.18),
  arch: (t) => {
    // Rounded top, flat-ish bottom.
    const [x, y] = superellipse(1, 1, 4)(t)
    return y < 0 ? [x, y] : [x * 0.98, Math.min(y, 0.92) + (y - Math.min(y, 0.92)) * 0.3]
  },
  pill: superellipse(1, 0.58, 3.2),
  oval: rotate(superellipse(1, 0.68, 2), -Math.PI / 4),
  triangle: polygon(3, 0.35),
  pentagon: polygon(5, 0.3),
  gem: rotate(superellipse(0.86, 1, 1.6), 0),
  sunny: sunny(8, 0.16),
  verySunny: sunny(8, 0.3),
  cookie4: cookie(4, 0.16),
  cookie6: cookie(6, 0.13),
  cookie7: cookie(7, 0.12),
  cookie9: cookie(9, 0.1),
  cookie12: cookie(12, 0.08),
  clover4: clover(4, 0.3, 1.1),
  clover8: clover(8, 0.24, 1.2),
  flower: clover(8, 0.3, 0.8),
  burst: sunny(12, 0.32),
  softBurst: cookie(10, 0.2),
  puffy: cookie(10, 0.07),
  ghostish: (t) => {
    const [x, y] = superellipse(0.9, 1, 3)(t)
    return y > 0.5 ? [x, y - 0.08 * Math.abs(Math.sin(6 * t))] : [x, y]
  },
}

const cache = new Map<ShapeName, number[]>()

// Flat [x0, y0, x1, y1, …] in the unit box, scaled so the shape touches its edges.
export function shapePoints(name: ShapeName): number[] {
  const hit = cache.get(name)
  if (hit) return hit
  const gen = GENERATORS[name]
  const pts: number[] = []
  let maxX = 0
  let maxY = 0
  for (let i = 0; i < POINTS; i++) {
    const [x, y] = gen((i / POINTS) * 2 * Math.PI)
    pts.push(x, y)
    maxX = Math.max(maxX, Math.abs(x))
    maxY = Math.max(maxY, Math.abs(y))
  }
  const k = 1 / Math.max(maxX, maxY)
  const out = pts.map((v) => v * k)
  cache.set(name, out)
  return out
}

// SVG path for points mapped into a size×size box.
export function pathFromPoints(pts: number[], size: number) {
  'worklet'
  const h = size / 2
  let d = ''
  for (let i = 0; i < pts.length; i += 2) d += (i === 0 ? 'M' : 'L') + (h + pts[i] * h).toFixed(2) + ' ' + (h + pts[i + 1] * h).toFixed(2)
  return d + 'Z'
}

export function shapePath(name: ShapeName, size: number) {
  return pathFromPoints(shapePoints(name), size)
}

// Order used by the Expressive loading indicator.
export const LOADER_SEQUENCE: ShapeName[] = ['softBurst', 'cookie9', 'pentagon', 'pill', 'sunny', 'cookie4', 'oval']
