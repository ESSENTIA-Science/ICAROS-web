/**
 * GLB 소프트웨어 렌더러 (P7-26 · G2 포스터).
 *
 * 왜 이걸 직접 짰는가 — 두 가지를 동시에 해결한다.
 *
 *   ① **검증.** 이 머신에 WebGL 도 Blender 도 없다. 그런데 감량 파이프라인이 형상을 망가뜨렸는지는
 *      숫자로 알 수 없다. "20 mm 미만 부품 583개를 버렸다"가 안전한 판단이었는지 확인하려면
 *      **그림을 봐야 한다.** GPU 없이 그림을 얻는 방법은 z-buffer 래스터라이저를 짜는 것뿐이다.
 *   ② **포스터.** 폴백 사다리 1단(G12·C12)은 포스터 이미지가 있어야 성립한다. 그 포스터는
 *      "3D 카메라와 같은 프레이밍"이어야 승격 순간에 이미지가 튀지 않는다(10-3d-assets.md §5.3).
 *      같은 카메라 파라미터를 받는 렌더러가 그 요구를 정의상 만족시킨다.
 *
 * 의도적으로 하지 않는 것: 그림자·환경맵·안티에일리어싱 필터·PBR. 포스터는 **첫 프레임의 대역**이지
 * 최종 품질이 아니다. 대신 SSAA(supersampling)만 넣어 계단을 없앤다 — 가장 싼 품질 개선이다.
 *
 *   npx tsx scripts/model/render-poster.ts <입력.glb> --out <출력.png>
 *     --width N --height N     출력 크기 (기본 900×1600)
 *     --ss N                   슈퍼샘플 배수 (기본 2)
 *     --yaw deg --pitch deg    카메라 궤도각 (기본 -28 / 8)
 *     --fov deg                (기본 28)
 *     --fit N                  화면 채움 비율 0..1 (기본 0.86)
 *     --bg r,g,b[,a]           배경. 기본은 투명 (0,0,0,0)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

import { NodeIO, getBounds, type Node as GltfNode } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

// ─────────────────────────────────────────────────────────────
// 인자
// ─────────────────────────────────────────────────────────────

interface Args {
  input: string
  output: string
  width: number
  height: number
  ss: number
  yaw: number
  pitch: number
  fov: number
  fit: number
  bg: [number, number, number, number]
}

function num(argv: readonly string[], i: number, flag: string): number {
  const raw = argv[i]
  if (raw === undefined) throw new Error(`${flag} 뒤에 숫자가 필요하다`)
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new Error(`${flag} 값이 숫자가 아니다: ${raw}`)
  return n
}

function parseArgs(argv: readonly string[]): Args {
  let input = ''
  let output = ''
  let width = 900
  let height = 1600
  let ss = 2
  let yaw = -28
  let pitch = 8
  let fov = 28
  let fit = 0.86
  let bg: [number, number, number, number] = [0, 0, 0, 0]

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === undefined) continue
    switch (a) {
      case '--out': {
        const next = argv[i + 1]
        if (next === undefined) throw new Error('--out 뒤에 경로가 필요하다')
        output = next
        i += 1
        break
      }
      case '--width': width = num(argv, i + 1, '--width'); i += 1; break
      case '--height': height = num(argv, i + 1, '--height'); i += 1; break
      case '--ss': ss = num(argv, i + 1, '--ss'); i += 1; break
      case '--yaw': yaw = num(argv, i + 1, '--yaw'); i += 1; break
      case '--pitch': pitch = num(argv, i + 1, '--pitch'); i += 1; break
      case '--fov': fov = num(argv, i + 1, '--fov'); i += 1; break
      case '--fit': fit = num(argv, i + 1, '--fit'); i += 1; break
      case '--bg': {
        const raw = argv[i + 1]
        if (raw === undefined) throw new Error('--bg 뒤에 r,g,b[,a] 가 필요하다')
        const parts = raw.split(',').map(Number)
        bg = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 255]
        i += 1
        break
      }
      default:
        if (a.startsWith('--')) throw new Error(`알 수 없는 옵션: ${a}`)
        input = a
    }
  }

  if (input === '') throw new Error('입력 GLB 경로가 필요하다')
  if (output === '') throw new Error('--out 이 필요하다')
  return { input: resolve(input), output: resolve(output), width, height, ss, yaw, pitch, fov, fit, bg }
}

// ─────────────────────────────────────────────────────────────
// 최소 선형대수. 열 우선(glTF 규약) 4×4.
// ─────────────────────────────────────────────────────────────

type Mat4 = Float64Array
type Vec3 = [number, number, number]

function identity(): Mat4 {
  const m = new Float64Array(16)
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1
  return m
}

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Float64Array(16)
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let s = 0
      for (let k = 0; k < 4; k += 1) s += (a[k * 4 + r] ?? 0) * (b[c * 4 + k] ?? 0)
      o[c * 4 + r] = s
    }
  }
  return o
}

/** glTF 노드의 TRS 를 4×4 로. 노드가 matrix 를 직접 들고 있으면 그걸 쓴다. */
function nodeMatrix(node: GltfNode): Mat4 {
  const t = node.getTranslation()
  const q = node.getRotation()
  const s = node.getScale()

  const [x, y, z, w] = q
  const x2 = x + x, y2 = y + y, z2 = z + z
  const xx = x * x2, xy = x * y2, xz = x * z2
  const yy = y * y2, yz = y * z2, zz = z * z2
  const wx = w * x2, wy = w * y2, wz = w * z2
  const [sx, sy, sz] = s

  const m = new Float64Array(16)
  m[0] = (1 - (yy + zz)) * sx
  m[1] = (xy + wz) * sx
  m[2] = (xz - wy) * sx
  m[4] = (xy - wz) * sy
  m[5] = (1 - (xx + zz)) * sy
  m[6] = (yz + wx) * sy
  m[8] = (xz + wy) * sz
  m[9] = (yz - wx) * sz
  m[10] = (1 - (xx + yy)) * sz
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1
  return m
}

function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    (m[0] ?? 0) * p[0] + (m[4] ?? 0) * p[1] + (m[8] ?? 0) * p[2] + (m[12] ?? 0),
    (m[1] ?? 0) * p[0] + (m[5] ?? 0) * p[1] + (m[9] ?? 0) * p[2] + (m[13] ?? 0),
    (m[2] ?? 0) * p[0] + (m[6] ?? 0) * p[1] + (m[10] ?? 0) * p[2] + (m[14] ?? 0),
  ]
}

// ─────────────────────────────────────────────────────────────
// 삼각형 수집
// ─────────────────────────────────────────────────────────────

interface Tri {
  a: Vec3
  b: Vec3
  c: Vec3
  color: Vec3
}

const args = parseArgs(process.argv.slice(2))

await MeshoptDecoder.ready
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })

const doc = await io.read(args.input)
const root = doc.getRoot()
const scene = root.listScenes()[0]
if (scene === undefined) throw new Error('씬이 없다')

const tris: Tri[] = []

function walk(node: GltfNode, parent: Mat4): void {
  const world = mul(parent, nodeMatrix(node))
  const mesh = node.getMesh()
  if (mesh !== null) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      if (pos === null) continue
      const idx = prim.getIndices()
      const mat = prim.getMaterial()
      const base = mat ? mat.getBaseColorFactor() : [0.7, 0.7, 0.7, 1]
      const color: Vec3 = [base[0] ?? 0.7, base[1] ?? 0.7, base[2] ?? 0.7]

      const count = idx !== null ? idx.getCount() : pos.getCount()
      const scratch = [0, 0, 0]
      for (let i = 0; i + 2 < count; i += 3) {
        const i0 = idx !== null ? idx.getScalar(i) : i
        const i1 = idx !== null ? idx.getScalar(i + 1) : i + 1
        const i2 = idx !== null ? idx.getScalar(i + 2) : i + 2
        pos.getElement(i0, scratch)
        const a = transformPoint(world, [scratch[0] ?? 0, scratch[1] ?? 0, scratch[2] ?? 0])
        pos.getElement(i1, scratch)
        const b = transformPoint(world, [scratch[0] ?? 0, scratch[1] ?? 0, scratch[2] ?? 0])
        pos.getElement(i2, scratch)
        const c = transformPoint(world, [scratch[0] ?? 0, scratch[1] ?? 0, scratch[2] ?? 0])
        tris.push({ a, b, c, color })
      }
    }
  }
  for (const child of node.listChildren()) walk(child, world)
}

for (const child of scene.listChildren()) walk(child, identity())

process.stdout.write(`삼각형 ${tris.length.toLocaleString()} 수집\n`)

// ─────────────────────────────────────────────────────────────
// 카메라
// ─────────────────────────────────────────────────────────────

const box = getBounds(scene)
const center: Vec3 = [
  (((box.min[0] ?? 0) + (box.max[0] ?? 0)) / 2),
  (((box.min[1] ?? 0) + (box.max[1] ?? 0)) / 2),
  (((box.min[2] ?? 0) + (box.max[2] ?? 0)) / 2),
]
const extent: Vec3 = [
  (box.max[0] ?? 0) - (box.min[0] ?? 0),
  (box.max[1] ?? 0) - (box.min[1] ?? 0),
  (box.max[2] ?? 0) - (box.min[2] ?? 0),
]
const radius = Math.hypot(extent[0], extent[1], extent[2]) / 2

const W = Math.round(args.width * args.ss)
const H = Math.round(args.height * args.ss)
const aspect = W / H
const fovY = (args.fov * Math.PI) / 180
const fovX = 2 * Math.atan(Math.tan(fovY / 2) * aspect)

const yawR = (args.yaw * Math.PI) / 180
const pitchR = (args.pitch * Math.PI) / 180
/** 카메라가 놓일 방향(중심에서 밖으로). 거리는 아래에서 프레이밍으로 정한다. */
const dir: Vec3 = [
  Math.cos(pitchR) * Math.sin(yawR),
  Math.sin(pitchR),
  Math.cos(pitchR) * Math.cos(yawR),
]

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/**
 * 바운딩 **구**로 거리를 잡으면 안 된다. 이 기체는 0.46 × 1.66 × 0.46 로 극단적으로 길쭉해서
 * 구 반경(0.89)이 세로 높이에 지배되는데, 좁은 가로 FOV 로 그 구를 담으려다 카메라가
 * 필요한 거리의 두 배까지 물러난다(첫 렌더에서 실제로 그랬다).
 * AABB 8꼭짓점을 카메라 축으로 투영해 가로·세로 각각의 구속을 따로 푼다.
 */
const forward = normalize([-dir[0], -dir[1], -dir[2]])
const right = normalize(cross(forward, [0, 1, 0]))
const upv = cross(right, forward)

const tanX = Math.tan(fovX / 2) * args.fit
const tanY = Math.tan(fovY / 2) * args.fit
let distance = 0
for (let i = 0; i < 8; i += 1) {
  const corner: Vec3 = [
    (i & 1 ? box.max[0] : box.min[0]) ?? 0,
    (i & 2 ? box.max[1] : box.min[1]) ?? 0,
    (i & 4 ? box.max[2] : box.min[2]) ?? 0,
  ]
  const d = sub(corner, center)
  const u = Math.abs(dot(d, right))
  const v = Math.abs(dot(d, upv))
  // forward 방향 성분만큼 카메라가 더 물러나야 한다
  const w = dot(d, forward)
  distance = Math.max(distance, u / tanX + w, v / tanY + w)
}

const eye: Vec3 = [
  center[0] + dir[0] * distance,
  center[1] + dir[1] * distance,
  center[2] + dir[2] * distance,
]

/** 월드 → 뷰. 오른손 좌표, −Z 가 전방(OpenGL 규약). */
function toView(p: Vec3): Vec3 {
  const d = sub(p, eye)
  return [dot(d, right), dot(d, upv), -dot(d, forward)]
}

const focal = 1 / Math.tan(fovY / 2)

// ─────────────────────────────────────────────────────────────
// 래스터라이즈
// ─────────────────────────────────────────────────────────────

const depth = new Float32Array(W * H).fill(Infinity)
const rgb = new Float32Array(W * H * 3)
const cover = new Uint8Array(W * H)

const KEY = normalize([-0.45, 0.8, 0.7])
const RIM = normalize([0.6, -0.15, -0.75])

let drawn = 0
for (const t of tris) {
  const va = toView(t.a)
  const vb = toView(t.b)
  const vc = toView(t.c)
  // 카메라 앞(뷰 공간 z < 0)에 완전히 있는 것만 그린다. 근평면 클리핑은 생략 — 모델이 항상 앞에 있다.
  if (va[2] >= -1e-4 || vb[2] >= -1e-4 || vc[2] >= -1e-4) continue

  const project = (v: Vec3): [number, number, number] => {
    const invZ = -1 / v[2]
    return [
      (v[0] * focal * invZ / aspect * 0.5 + 0.5) * W,
      (0.5 - v[1] * focal * invZ * 0.5) * H,
      -v[2],
    ]
  }
  const pa = project(va)
  const pb = project(vb)
  const pc = project(vc)

  const area = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0])
  if (area === 0) continue

  // 면 법선은 월드 공간에서 구한다 — 조명이 카메라를 따라 돌면 안 된다.
  const e1 = sub(t.b, t.a)
  const e2 = sub(t.c, t.a)
  let n = normalize(cross(e1, e2))
  // CAD 조립체는 면 방향이 일관되지 않다. 카메라를 향하도록 뒤집어 양면 조명한다.
  if (dot(n, sub(eye, t.a)) < 0) n = [-n[0], -n[1], -n[2]]

  const lambert = Math.max(0, dot(n, KEY))
  const rim = Math.pow(Math.max(0, dot(n, RIM)), 2)
  const shade = 0.16 + 0.78 * lambert + 0.22 * rim

  const minX = Math.max(0, Math.floor(Math.min(pa[0], pb[0], pc[0])))
  let maxX = Math.min(W - 1, Math.ceil(Math.max(pa[0], pb[0], pc[0])))
  const minY = Math.max(0, Math.floor(Math.min(pa[1], pb[1], pc[1])))
  let maxY = Math.min(H - 1, Math.ceil(Math.max(pa[1], pb[1], pc[1])))
  if (minX > maxX || minY > maxY) continue

  // 1픽셀보다 작은 삼각형이 대부분이라, 바운딩 박스가 비면 중심 픽셀 하나라도 찍는다
  if (maxX - minX < 1) { maxX = minX }
  if (maxY - minY < 1) { maxY = minY }

  const invArea = 1 / area
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5
      const py = y + 0.5
      let w0 = ((pb[0] - pa[0]) * (py - pa[1]) - (pb[1] - pa[1]) * (px - pa[0])) * invArea
      let w1 = ((pc[0] - pb[0]) * (py - pb[1]) - (pc[1] - pb[1]) * (px - pb[0])) * invArea
      let w2 = ((pa[0] - pc[0]) * (py - pc[1]) - (pa[1] - pc[1]) * (px - pc[0])) * invArea
      if (w0 < 0 || w1 < 0 || w2 < 0) continue
      // 무게중심 좌표 (w1,w2,w0) → a,b,c
      const sum = w0 + w1 + w2
      w0 /= sum; w1 /= sum; w2 /= sum
      const z = w1 * pa[2] + w2 * pb[2] + w0 * pc[2]
      const o = y * W + x
      if (z >= (depth[o] ?? Infinity)) continue
      depth[o] = z
      rgb[o * 3] = t.color[0] * shade
      rgb[o * 3 + 1] = t.color[1] * shade
      rgb[o * 3 + 2] = t.color[2] * shade
      cover[o] = 1
    }
  }
  drawn += 1
}

process.stdout.write(`래스터 ${drawn.toLocaleString()} 삼각형 · ${W}×${H} (SSAA ${args.ss}×)\n`)

// ─────────────────────────────────────────────────────────────
// 다운샘플 + PNG
// ─────────────────────────────────────────────────────────────

const OW = args.width
const OH = args.height
const outRGBA = Buffer.alloc(OW * OH * 4)
const ss = args.ss
const [bgR, bgG, bgB, bgA] = args.bg

for (let y = 0; y < OH; y += 1) {
  for (let x = 0; x < OW; x += 1) {
    let r = 0, g = 0, b = 0, a = 0
    for (let sy = 0; sy < ss; sy += 1) {
      for (let sx = 0; sx < ss; sx += 1) {
        const o = (y * ss + sy) * W + (x * ss + sx)
        if (cover[o] === 1) {
          r += rgb[o * 3] ?? 0
          g += rgb[o * 3 + 1] ?? 0
          b += rgb[o * 3 + 2] ?? 0
          a += 1
        }
      }
    }
    const n = ss * ss
    const cvg = a / n
    // 커버된 부분만 평균한 색 위에 배경을 알파 합성한다 (가장자리 색 번짐 방지)
    const fr = a > 0 ? r / a : 0
    const fg = a > 0 ? g / a : 0
    const fb = a > 0 ? b / a : 0
    const srgb = (v: number): number => Math.round(255 * Math.min(1, Math.max(0, Math.pow(v, 1 / 2.2))))
    const outA = cvg + (bgA / 255) * (1 - cvg)
    const o = (y * OW + x) * 4
    if (outA <= 0) {
      outRGBA[o] = 0; outRGBA[o + 1] = 0; outRGBA[o + 2] = 0; outRGBA[o + 3] = 0
    } else {
      const mixR = (srgb(fr) * cvg + bgR * (bgA / 255) * (1 - cvg)) / outA
      const mixG = (srgb(fg) * cvg + bgG * (bgA / 255) * (1 - cvg)) / outA
      const mixB = (srgb(fb) * cvg + bgB * (bgA / 255) * (1 - cvg)) / outA
      outRGBA[o] = Math.round(mixR)
      outRGBA[o + 1] = Math.round(mixG)
      outRGBA[o + 2] = Math.round(mixB)
      outRGBA[o + 3] = Math.round(outA * 255)
    }
  }
}

/** PNG 인코더. 의존성 없이 zlib 만 쓴다 — RGBA8, 필터 0(None). */
function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const idat = deflateSync(raw, { level: 9 })

  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0, 0)
    return Buffer.concat([len, body, crc])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8      // bit depth
  ihdr[9] = 6      // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const png = encodePng(OW, OH, outRGBA)
mkdirSync(dirname(args.output), { recursive: true })
writeFileSync(args.output, png)

process.stdout.write(
  [
    `모델 AABB   ${extent.map((v) => v.toFixed(3)).join(' × ')}  (반경 ${radius.toFixed(3)})`,
    `카메라      eye=[${eye.map((v) => v.toFixed(3)).join(', ')}] target=[${center.map((v) => v.toFixed(3)).join(', ')}] fov=${args.fov}°`,
    `출력        ${args.output}  ${OW}×${OH}  ${(png.length / 1024).toFixed(0)} KB`,
    '',
  ].join('\n')
)
