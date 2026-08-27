/**
 * 산출물 GLB 를 **런타임과 같은 코드 경로**로 열어 본다 (P7-26 검증).
 *
 * `inspect-glb.ts` 는 `@gltf-transform` 으로 읽는다 — 파이프라인 쪽 파서다. 그런데 브라우저에서
 * 실제로 읽는 것은 `three` 의 `GLTFLoader` + `MeshoptDecoder` 이고, 둘은 **다른 구현**이다.
 * EXT_meshopt_compression 은 필터·양자화 조합이 많아서 "gltf-transform 이 쓴 것을 three 가 못 읽는"
 * 경우가 실제로 생긴다. 그 실패는 배포 후 브라우저 콘솔에서야 드러난다.
 *
 * 이 스크립트는 WebGL 없이 그 경로를 검사한다 — `GLTFLoader.parse()` 는 렌더러를 요구하지 않는다.
 * 통과하면 "브라우저에서 파싱은 된다"가 실측으로 확정된다. **화면에 어떻게 보이는지는 여전히
 * 확인하지 못한다** — 그건 `render-poster.ts` 가 따로 답한다.
 *
 * 두 번째로, **고정 캔버스 프레이밍**을 검증한다. `src/components/three/framing.ts` 는 순수 함수라
 * 브라우저 없이 그대로 부를 수 있다. 뷰포트·타깃 박스를 몇 가지 주고 `applyStageCamera()` 를 돌린 뒤,
 * 모델 AABB 8꼭짓점을 캔버스 좌표로 투영해 **정말 그 박스 안에 들어가는지** 픽셀로 확인한다.
 * 렌더 루프에서만 도는 코드가 검증되지 않은 채 남는 것을 막는 장치다.
 *
 *   npx tsx scripts/model/verify-runtime-load.ts [파일.glb]
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// three 예제 모듈은 브라우저를 전제한다. FBX 단계와 같은 이유로 최소 shim 을 먼저 깐다.
if (!('window' in globalThis)) {
  Reflect.set(globalThis, 'window', { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1 })
}
if (!('self' in globalThis)) {
  Reflect.set(globalThis, 'self', globalThis)
}

const { applyStageCamera, projectToCanvas } = await import('../../src/components/three/framing')
const { DEFAULT_STAGE } = await import('../../src/components/three/config')
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js')
const THREE = await import('three')

const file = resolve(process.argv[2] ?? 'public/assets/models/icx-2.glb')
const buf = readFileSync(file)
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)

await MeshoptDecoder.ready

const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)

const t0 = Date.now()
const gltf = await loader.parseAsync(ab, '')
const ms = Date.now() - t0

let meshes = 0
let drawCalls = 0
let triangles = 0
let vertices = 0
let nan = 0
const materials = new Set<string>()

gltf.scene.traverse((obj) => {
  if (!(obj instanceof THREE.Mesh)) return
  meshes += 1
  const geo = obj.geometry
  const index = geo.getIndex()
  const pos = geo.getAttribute('position')
  const count = index !== null ? index.count : (pos?.count ?? 0)
  triangles += count / 3
  vertices += pos?.count ?? 0
  drawCalls += geo.groups.length > 0 ? geo.groups.length : 1

  // 디코더가 어긋나면 좌표가 NaN 이 되고, 화면에서는 "아무것도 안 보임"으로만 나타난다.
  if (pos !== undefined) {
    const arr = pos.array
    for (let i = 0; i < arr.length; i += 1) {
      const v = arr[i]
      if (v === undefined || !Number.isFinite(v)) {
        nan += 1
        break
      }
    }
  }

  const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
  for (const m of mats) materials.add(m.uuid)
})

const box = new THREE.Box3().setFromObject(gltf.scene)
const size = box.getSize(new THREE.Vector3())
const center = box.getCenter(new THREE.Vector3())

const ok = nan === 0 && meshes > 0 && Number.isFinite(size.length()) && size.length() > 0

process.stdout.write(
  [
    `파일          ${file}  (${(buf.length / 1024 / 1024).toFixed(2)} MiB)`,
    `파싱          ${ms} ms  (GLTFLoader + MeshoptDecoder)`,
    `Mesh          ${meshes}  draw call ${drawCalls}  material ${materials.size}`,
    `삼각형        ${triangles.toLocaleString()}  정점 ${vertices.toLocaleString()}`,
    `AABB          ${size.toArray().map((v) => v.toFixed(3)).join(' × ')} m`,
    `중심          ${center.toArray().map((v) => v.toFixed(3)).join(', ')}`,
    `NaN 지오메트리 ${nan}`,
    `애니메이션    ${gltf.animations.length}`,
    '',
    ok ? '✅ 브라우저 런타임 파싱 경로 통과' : '❌ 실패 — 위 수치를 확인하라',
    '',
  ].join('\n')
)

// ─────────────────────────────────────────────────────────────
// 프레이밍 검증 — 모델이 정말 타깃 박스 안에 들어가는가
// ─────────────────────────────────────────────────────────────

interface Case {
  label: string
  canvas: { width: number; height: number }
  /** 히어로 스테이지 박스. 컨테이너 여백 + 헤더 높이를 반영한 현실적인 값 */
  rect: { left: number; top: number; width: number; height: number }
  progress: number
}

const CASES: readonly Case[] = [
  { label: '데스크톱 1440×900 · 상단', canvas: { width: 1440, height: 900 }, rect: { left: 64, top: 96, width: 1312, height: 420 }, progress: 0 },
  { label: '데스크톱 1440×900 · 스크롤 0.5', canvas: { width: 1440, height: 900 }, rect: { left: 64, top: -210, width: 1312, height: 420 }, progress: 0.5 },
  { label: '노트북 1280×720', canvas: { width: 1280, height: 720 }, rect: { left: 48, top: 88, width: 1184, height: 300 }, progress: 0 },
  { label: '태블릿 834×1112', canvas: { width: 834, height: 1112 }, rect: { left: 32, top: 96, width: 770, height: 620 }, progress: 0 },
  { label: '세로로 긴 박스 400×900', canvas: { width: 1440, height: 900 }, rect: { left: 900, top: 20, width: 400, height: 860 }, progress: 0 },
]

let framingOk = true
const lines: string[] = ['', '프레이밍 검증 (framing.ts · applyStageCamera)', '']

for (const c of CASES) {
  const camera = new THREE.PerspectiveCamera()
  applyStageCamera(camera, box, c.rect, c.canvas, DEFAULT_STAGE, c.progress)

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < 8; i += 1) {
    const p = new THREE.Vector3(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z
    )
    const s = projectToCanvas(camera, p, c.canvas)
    minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x)
    minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y)
  }

  const inside =
    minX >= c.rect.left - 1 &&
    maxX <= c.rect.left + c.rect.width + 1 &&
    minY >= c.rect.top - 1 &&
    maxY <= c.rect.top + c.rect.height + 1

  /**
   * 세로로 긴 기체라 보통은 높이가 구속조건이다. 채움 비율이 `fit` 근처인지 본다.
   * 정확히 `fit` 이 나오지는 않는다 — `fitDistance` 는 꼭짓점마다 **그 꼭짓점의 깊이**에서
   * 선형 구속을 풀기 때문에, 원근이 섞이면 실제 채움은 몇 % 아래로 떨어진다.
   * 궤도각에 따라 0.836~0.845 사이를 오가는 것을 실측했으므로 5% 를 허용한다.
   */
  const fillY = (maxY - minY) / c.rect.height
  const fillX = (maxX - minX) / c.rect.width
  const fills = Math.max(fillX, fillY) > DEFAULT_STAGE.fit - 0.05

  if (!inside || !fills) framingOk = false
  lines.push(
    `  ${inside && fills ? '✅' : '❌'} ${c.label.padEnd(28)} ` +
      `투영 x[${minX.toFixed(0)}..${maxX.toFixed(0)}] y[${minY.toFixed(0)}..${maxY.toFixed(0)}]  ` +
      `박스 x[${c.rect.left}..${c.rect.left + c.rect.width}] y[${c.rect.top}..${c.rect.top + c.rect.height}]  ` +
      `채움 ${(fillX * 100).toFixed(1)}%×${(fillY * 100).toFixed(1)}%`
  )
}

lines.push('', framingOk ? '✅ 모든 뷰포트에서 모델이 타깃 박스 안에 들어간다' : '❌ 프레이밍 실패', '')
process.stdout.write(lines.join('\n'))

if (!ok || !framingOk) process.exitCode = 1
