/**
 * GLB 검증기 (P7-26). `inspect-fbx.ts` 는 FBX 파서라 산출물 검증에 쓸 수 없다고 적어 뒀던 자리 —
 * 10-3d-assets.md §9 의 "그때는 `gltf-transform inspect` 를 쓴다" 를 이 스크립트가 대신한다.
 *
 * `gltf-transform inspect` 를 그대로 쓰지 않는 이유는 두 가지다.
 *   ① draw call 을 세지 않는다. 이 자산의 핵심 지표가 그건데, inspect 는 mesh/primitive 만 센다.
 *      실제 draw call 은 Σ(씬 노드 × primitive) 이고 EXT_mesh_gpu_instancing 이 붙으면 또 달라진다.
 *   ② 부품 크기별 배분을 못 본다. 20 mm 미만 부품이 삼각형의 56% 를 먹는다는 것이 이 자산의
 *      진짜 문제였으므로(§1.5), 그 배분이 변환 후에 어떻게 됐는지가 검증의 본체다.
 *
 *   npx tsx scripts/model/inspect-glb.ts <파일.glb> [--top N] [--mm-per-unit N] [--json]
 *
 * `--mm-per-unit` 은 부품 크기 버킷을 해석하기 위한 것이다. 파이프라인이 mm → m 로 정규화한
 * 산출물(1 unit = 1000 mm)에 기본값 1 을 쓰면 모든 부품이 "< 5 mm" 로 들어가 표가 무의미해진다.
 */
import { statSync } from 'node:fs'
import { resolve } from 'node:path'

import { NodeIO, getBounds, type Node as GltfNode } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshGPUInstancing, type InstancedMesh } from '@gltf-transform/extensions'
import { getGLPrimitiveCount } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

function instanceCount(node: GltfNode): number {
  const ext = node.getExtension<InstancedMesh>(EXTMeshGPUInstancing.EXTENSION_NAME)
  if (ext === null) return 1
  const attr = ext.listAttributes()[0]
  return attr ? attr.getCount() : 1
}

interface PartRow {
  name: string
  diagonal: number
  triangles: number
  instances: number
}

/** 부품 크기 버킷. 10-3d-assets.md §1.5 와 같은 경계를 쓴다 (단위 = mm). */
const BUCKETS: readonly { label: string; max: number }[] = [
  { label: '< 5 mm', max: 5 },
  { label: '5–20 mm', max: 20 },
  { label: '20–100 mm', max: 100 },
  { label: '≥ 100 mm', max: Infinity },
]

let file = ''
let top = 30
let json = false
let mmPerUnit = 1
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i]
  if (a === undefined) continue
  if (a === '--top') {
    const n = Number(argv[i + 1])
    if (!Number.isFinite(n)) throw new Error('--top 뒤에 숫자가 필요하다')
    top = n
    i += 1
  } else if (a === '--mm-per-unit') {
    const n = Number(argv[i + 1])
    if (!Number.isFinite(n) || n <= 0) throw new Error('--mm-per-unit 뒤에 양수가 필요하다')
    mmPerUnit = n
    i += 1
  } else if (a === '--json') {
    json = true
  } else if (a.startsWith('--')) {
    throw new Error(`알 수 없는 옵션: ${a}`)
  } else {
    file = a
  }
}
if (file === '') throw new Error('GLB 경로가 필요하다')
file = resolve(file)

await MeshoptDecoder.ready
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })

const doc = await io.read(file)
const root = doc.getRoot()
const scene = root.listScenes()[0]
if (scene === undefined) throw new Error('씬이 없다')

const box = getBounds(scene)
const size = [0, 1, 2].map((i) => (box.max[i] ?? 0) - (box.min[i] ?? 0))

const parts: PartRow[] = []
let drawCalls = 0
let renderTriangles = 0
let uniqueTriangles = 0
let uniqueVertices = 0

for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    uniqueTriangles += getGLPrimitiveCount(prim)
    uniqueVertices += prim.getAttribute('POSITION')?.getCount() ?? 0
  }
}

for (const node of root.listNodes()) {
  const mesh = node.getMesh()
  if (mesh === null) continue
  const n = instanceCount(node)
  let tris = 0
  for (const prim of mesh.listPrimitives()) {
    drawCalls += 1
    tris += getGLPrimitiveCount(prim)
  }
  renderTriangles += tris * n
  const b = getBounds(node)
  const d = Math.hypot(
    (b.max[0] ?? 0) - (b.min[0] ?? 0),
    (b.max[1] ?? 0) - (b.min[1] ?? 0),
    (b.max[2] ?? 0) - (b.min[2] ?? 0)
  )
  parts.push({
    name: node.getName() || mesh.getName() || '(이름 없음)',
    diagonal: d,
    triangles: tris,
    instances: n,
  })
}

parts.sort((a, b) => b.diagonal - a.diagonal)

const bucketRows = BUCKETS.map((b, i) => {
  const min = i === 0 ? 0 : (BUCKETS[i - 1]?.max ?? 0)
  const rows = parts.filter((p) => {
    const mm = p.diagonal * mmPerUnit
    return mm >= min && mm < b.max
  })
  return {
    label: b.label,
    parts: rows.length,
    triangles: rows.reduce((s, p) => s + p.triangles * p.instances, 0),
  }
})

/** 0.464 를 "0" 으로 찍으면 표가 거짓말을 한다. 크기에 따라 유효자리를 바꾼다. */
function fmtLen(v: number): string {
  if (v >= 100) return v.toFixed(0)
  if (v >= 1) return v.toFixed(2)
  return v.toFixed(4)
}

const extensions = root.listExtensionsUsed().map((e) => e.extensionName)
const bytes = statSync(file).size

if (json) {
  process.stdout.write(
    `${JSON.stringify(
      { file, bytes, size, mmPerUnit, drawCalls, renderTriangles, uniqueTriangles, uniqueVertices, extensions, buckets: bucketRows, parts: parts.slice(0, top) },
      null,
      2
    )}\n`
  )
} else {
  const lines = [
    `파일        ${file}`,
    `크기        ${(bytes / 1024 / 1024).toFixed(2)} MiB  (${bytes.toLocaleString()} bytes)`,
    `확장        ${extensions.length > 0 ? extensions.join(', ') : '(없음)'}`,
    `치수        ${size.map((v) => fmtLen(v)).join(' × ')} units  (= ${size.map((v) => fmtLen(v * mmPerUnit)).join(' × ')} mm)`,
    '',
    `mesh ${root.listMeshes().length}  material ${root.listMaterials().length}  texture ${root.listTextures().length}  animation ${root.listAnimations().length}`,
    `mesh 노드 ${parts.length}  draw call ${drawCalls.toLocaleString()}`,
    `삼각형 유일 ${uniqueTriangles.toLocaleString()}  렌더 ${renderTriangles.toLocaleString()}  정점 ${uniqueVertices.toLocaleString()}`,
    '',
    '부품 크기별 배분',
    ...bucketRows.map(
      (b) =>
        `  ${b.label.padEnd(12)} 부품 ${String(b.parts).padStart(5)}  렌더 삼각형 ${b.triangles.toLocaleString().padStart(11)}`
    ),
    '',
    `가장 큰 부품 ${Math.min(top, parts.length)}개  (대각선 mm · 삼각형 · 인스턴스 · 이름)`,
    ...parts
      .slice(0, top)
      .map(
        (p) =>
          `  ${fmtLen(p.diagonal * mmPerUnit).padStart(9)}  ${p.triangles.toLocaleString().padStart(9)}  ×${String(p.instances).padStart(3)}  ${p.name}`
      ),
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
}
