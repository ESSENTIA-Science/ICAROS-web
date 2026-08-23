/**
 * FBX → GLB 1단계 (P7-26): 원본 FBX 를 **손실 없이** glTF 로 옮긴다. 감량은 2단계(optimize-glb.ts).
 *
 * 왜 이 방법인가 — 10-3d-assets.md §2 가 조사한 경로는 전부 외부 바이너리(Blender·FBX2glTF·assimp)이고
 * 이 머신에 하나도 없다. 그런데 우리는 런타임용으로 `three` 를 어차피 설치한다. three 는
 * `examples/jsm/loaders/FBXLoader.js` 라는 **완전한 FBX 리더**와 `GLTFExporter` 를 함께 배포한다.
 * 즉 추가 도구 없이 FBX→glTF 를 우리 의존성 안에서 끝낼 수 있다. Blender 1GB 다운로드가 사라진다.
 *
 * 두 리더의 한계도 같이 적는다:
 *   - FBXLoader 는 브라우저를 전제한다. 텍스처 임베드 경로에서 `window.URL.createObjectURL`,
 *     카메라 파싱에서 `window.innerWidth` 를 읽는다. 이 파일은 텍스처 0·카메라 0 이라 실제로는
 *     닿지 않지만, 닿았을 때 조용히 죽지 않도록 최소 shim 을 깔아 둔다.
 *   - GLTFExporter 는 GLB 를 만들 때 `Blob` + `FileReader` 를 쓴다. Node 26 에 `Blob` 은 있고
 *     `FileReader` 는 없다. 두 메서드만 쓰므로 그만큼만 구현한다.
 *
 * 인스턴싱 보존이 이 단계의 유일한 성능 요구다. FBXLoader 는 Geometry 노드를 id 로 캐시해
 * 같은 지오메트리를 여러 Mesh 가 공유하게 만들고, GLTFExporter 는 BufferGeometry uuid 로 캐시해
 * 하나의 glTF mesh 를 여러 node 가 참조하게 쓴다. 그래서 중복 지오메트리 109개(≈3.08 MiB)가
 * 복제되지 않는다 — 이걸 깨뜨리는 것은 2단계의 `flatten`/`join` 뿐이다.
 *
 *   npx tsx scripts/model/fbx-to-glb.ts [입력.fbx] [--out 경로.glb] [--opaque] [--keep-materials]
 *   기본 입력: public/assets/icx-2.fbx
 *   기본 출력: $TMPDIR/icaros-model/<이름>.raw.glb   ← 중간 산출물이라 레포에 남기지 않는다
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// ─────────────────────────────────────────────────────────────
// shim
// ─────────────────────────────────────────────────────────────

type ReaderResult = ArrayBuffer | string | null

/**
 * GLTFExporter 가 쓰는 두 메서드(`readAsArrayBuffer`·`readAsDataURL`)만 구현한 최소 FileReader.
 * 콜백은 `onloadend` 하나만 쓰이므로 이벤트 시스템 전체를 흉내 내지 않는다.
 */
class NodeFileReader {
  result: ReaderResult = null
  onloadend: (() => void) | null = null
  onerror: (() => void) | null = null

  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buf) => {
      this.result = buf
      this.onloadend?.()
    })
  }

  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((buf) => {
      const b64 = Buffer.from(buf).toString('base64')
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${b64}`
      this.onloadend?.()
    })
  }
}

/**
 * `Reflect.set` 을 쓰는 이유: `globalThis.window = …` 는 DOM lib 의 `Window` 전체를 요구해서
 * 캐스팅 없이는 통과할 수 없다. 캐스팅(`as unknown`)은 이 프로젝트에서 금지돼 있으므로
 * 타입 시스템을 우회하지 않고 **동적 프로퍼티 설정**으로 붙인다.
 *
 * 클래스 선언은 호이스팅되지 않으므로 이 호출은 `NodeFileReader` **뒤**여야 하고,
 * three 예제 모듈 import 보다는 **앞**이어야 한다 — 그래서 dynamic import 를 쓴다.
 */
function installBrowserShims(): void {
  if (!('FileReader' in globalThis)) {
    Reflect.set(globalThis, 'FileReader', NodeFileReader)
  }
  if (!('window' in globalThis)) {
    Reflect.set(globalThis, 'window', {
      innerWidth: 1920,
      innerHeight: 1080,
      devicePixelRatio: 1,
      URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    })
  }
}

installBrowserShims()

const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js')
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
const THREE = await import('three')

// ─────────────────────────────────────────────────────────────
// 인자
// ─────────────────────────────────────────────────────────────

interface Args {
  input: string
  output: string
  opaque: boolean
  keepMaterials: boolean
}

function parseArgs(argv: readonly string[]): Args {
  let input = 'public/assets/icx-2.fbx'
  let output = ''
  let opaque = false
  let keepMaterials = false

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === undefined) continue
    if (a === '--out') {
      const next = argv[i + 1]
      if (next === undefined) throw new Error('--out 뒤에 경로가 필요하다')
      output = next
      i += 1
    } else if (a === '--opaque') {
      opaque = true
    } else if (a === '--keep-materials') {
      keepMaterials = true
    } else if (a.startsWith('--')) {
      throw new Error(`알 수 없는 옵션: ${a}`)
    } else {
      input = a
    }
  }

  if (output === '') {
    const base = input.replace(/\\/g, '/').split('/').pop() ?? 'model.fbx'
    output = join(tmpdir(), 'icaros-model', `${base.replace(/\.fbx$/i, '')}.raw.glb`)
  }

  return { input: resolve(input), output: resolve(output), opaque, keepMaterials }
}

// ─────────────────────────────────────────────────────────────
// 머티리얼 정규화
// ─────────────────────────────────────────────────────────────

/**
 * FBXLoader 는 Phong/Lambert 를 만든다. GLTFExporter 는 Standard/Basic 이 아니면 경고를 내고
 * 색 말고는 대부분 버린다. 어차피 버려질 것을 우리가 **명시적으로** 골라 옮긴다 —
 * 그래야 무엇이 사라졌는지 나중에 알 수 있다.
 *
 * Fusion 360 appearance 는 색상 전용이고 텍스처가 0개다(10-3d-assets.md §1.6). 그래서
 * baseColor + metalness/roughness 상수만으로 완전히 표현된다.
 */
type ColoredMaterial =
  | InstanceType<typeof THREE.MeshPhongMaterial>
  | InstanceType<typeof THREE.MeshLambertMaterial>
  | InstanceType<typeof THREE.MeshStandardMaterial>
  | InstanceType<typeof THREE.MeshBasicMaterial>

function isColored(m: InstanceType<typeof THREE.Material>): m is ColoredMaterial {
  return (
    m instanceof THREE.MeshPhongMaterial ||
    m instanceof THREE.MeshLambertMaterial ||
    m instanceof THREE.MeshStandardMaterial ||
    m instanceof THREE.MeshBasicMaterial
  )
}

function toStandard(
  m: InstanceType<typeof THREE.Material>,
  opaque: boolean
): InstanceType<typeof THREE.MeshStandardMaterial> {
  const std = new THREE.MeshStandardMaterial()
  std.name = m.name
  std.side = m.side

  if (isColored(m)) {
    std.color.copy(m.color)
  }

  // 금속성은 FBX 에 없다. Fusion appearance 이름으로 추정하지 않고 전부 비금속으로 두고,
  // 광택은 뷰어의 환경맵이 만든다 — 여기서 추정하면 나중에 왜 그런지 아무도 모른다.
  std.metalness = 0
  std.roughness = 0.6

  if (opaque) {
    std.transparent = false
    std.opacity = 1
  } else {
    std.transparent = m.transparent
    std.opacity = m.opacity
  }
  return std
}

// ─────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────

function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}

const args = parseArgs(process.argv.slice(2))

const fileBytes = statSync(args.input).size
process.stdout.write(`입력  ${args.input}  (${mib(fileBytes)})\n`)

const buf = readFileSync(args.input)
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)

const t0 = Date.now()
const root = new FBXLoader().parse(ab, dirname(args.input))
const tParse = Date.now() - t0

// ── 통계 + 머티리얼 정규화 ────────────────────────────────────
let meshCount = 0
let triangles = 0
let renderTriangles = 0
const uniqueGeometries = new Set<string>()
const uniqueMaterials = new Set<string>()
let primitiveCount = 0
let transparentCount = 0

const converted = new Map<string, InstanceType<typeof THREE.MeshStandardMaterial>>()

function convertOne(m: InstanceType<typeof THREE.Material>): InstanceType<typeof THREE.Material> {
  if (args.keepMaterials) return m
  const hit = converted.get(m.uuid)
  if (hit) return hit
  const std = toStandard(m, args.opaque)
  converted.set(m.uuid, std)
  return std
}

root.traverse((obj) => {
  if (!(obj instanceof THREE.Mesh)) return
  meshCount += 1

  const geo = obj.geometry
  const index = geo.getIndex()
  const posAttr = geo.getAttribute('position')
  const triCount =
    index !== null ? index.count / 3 : posAttr !== undefined ? posAttr.count / 3 : 0

  if (!uniqueGeometries.has(geo.uuid)) {
    uniqueGeometries.add(geo.uuid)
    triangles += triCount
  }
  renderTriangles += triCount

  const groups = geo.groups.length
  primitiveCount += groups > 0 ? groups : 1

  if (Array.isArray(obj.material)) {
    obj.material = obj.material.map((m) => {
      uniqueMaterials.add(m.uuid)
      if (m.transparent) transparentCount += 1
      return convertOne(m)
    })
  } else {
    uniqueMaterials.add(obj.material.uuid)
    if (obj.material.transparent) transparentCount += 1
    obj.material = convertOne(obj.material)
  }
})

process.stdout.write(
  [
    `\nFBX 파싱  ${(tParse / 1000).toFixed(1)}s`,
    `  Mesh 노드          ${meshCount.toLocaleString()}`,
    `  유일 지오메트리    ${uniqueGeometries.size.toLocaleString()}`,
    `  유일 머티리얼      ${uniqueMaterials.size.toLocaleString()}  (투명 ${transparentCount})`,
    `  삼각형(유일)       ${triangles.toLocaleString()}`,
    `  삼각형(렌더)       ${renderTriangles.toLocaleString()}`,
    `  primitive(=draw)   ${primitiveCount.toLocaleString()}`,
    '',
  ].join('\n')
)

// ── GLB 로 굽기 ──────────────────────────────────────────────
const t1 = Date.now()
const out = await new GLTFExporter().parseAsync(root, {
  binary: true,
  onlyVisible: false,
  // CAD 조립체라 draw range 를 잘라 놓은 지오메트리가 없다. 잘라 내면 오히려 검증이 어려워진다.
  truncateDrawRange: false,
  // 애니메이션 0개 — 노드 변환을 행렬로 남겨도 되지만, TRS 가 quantize 와 궁합이 좋다.
  trs: true,
})
const tExport = Date.now() - t1

if (!(out instanceof ArrayBuffer)) {
  throw new Error('GLTFExporter 가 GLB(ArrayBuffer) 를 돌려주지 않았다 — binary 옵션 확인')
}

mkdirSync(dirname(args.output), { recursive: true })
writeFileSync(args.output, Buffer.from(out))

process.stdout.write(
  `GLB 내보내기  ${(tExport / 1000).toFixed(1)}s\n출력  ${args.output}  (${mib(out.byteLength)})\n`
)
