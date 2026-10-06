/**
 * FBX → GLB 2단계 (P7-26): 1단계가 뱉은 무손실 GLB 를 웹 예산 안으로 줄인다.
 *
 * 이 단계가 푸는 문제는 바이트가 아니라 **부품 수**다 (10-3d-assets.md §0).
 * 그 문서의 정정 배너가 지적한 딜레마 — "`join` 은 `flatten` 을 돌려 인스턴싱을 파괴하므로
 * 양자화 BIN 이 8.95 → 27.34 MiB 가 된다. 예산과 draw call 을 동시에 만족할 수 없다" — 는
 * **삼각형을 그대로 두는 조건에서만** 참이다. 순서를 바꾸면 둘 다 성립한다:
 *
 *     ① 화면에서 보이지 않는 부품을 먼저 **버리고**   (--min-part)
 *     ② 남은 것을 **줄인 다음**                        (--simplify)
 *     ③ 그제야 병합한다                                (--mode join)
 *
 * ③ 이 복제하는 것은 ①·② 를 통과한 지오메트리뿐이라 복제 배수(2.76×)가 훨씬 작은 수에 걸린다.
 * `--mode instance` 는 정반대 선택지다 — 병합 대신 EXT_mesh_gpu_instancing 으로 묶어
 * 지오메트리 복제를 0으로 두고 draw call 만 줄인다. **두 모드를 다 돌려 숫자로 고르라고 만든 스크립트다.**
 *
 * 양자화는 `meshopt()` 가 안에서 함께 수행한다(MESHOPT_DEFAULTS 에 quantize* 가 들어 있다).
 * 다만 기본값 `quantizationVolume: 'mesh'` 는 메시별 볼륨에 맞춰 **노드 스케일을 고쳐 쓴다**.
 * 한 메시를 여러 노드가 공유하는 이 자산에서는 그게 공유를 깨뜨릴 수 있으므로 `'scene'` 으로 고정한다.
 * 정밀도 손실은 없다시피 하다 — 전장 1,752 units 를 14bit 로 나누면 한 칸이 0.107 units(=0.1 mm) 다.
 *
 *   npx tsx scripts/model/optimize-glb.ts <입력.glb> --out <출력.glb>
 *     --min-part <units>     이 대각선보다 작은 부품을 버린다 (기본 20 = 20mm, 0 이면 끔)
 *     --simplify <0..1>      meshoptimizer 데시메이션 목표 비율 (0 이면 끔)
 *     --simplify-error <e>   허용 오차 (기본 0.01)
 *     --mode join|instance|none
 *     --up y|z               원본이 Z-up 이면 z. glTF 규약(Y-up)으로 세운다
 *     --scale <s>            단위 변환. mm 자산을 m 로 옮기려면 0.001
 *     --center               월드 원점을 모델 AABB 중심으로 옮긴다 (카메라 계산이 단순해진다)
 *     --no-meshopt           EXT_meshopt_compression 없이 (양자화만) — 비교용
 *     --json                 통계를 JSON 으로
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { Document, Logger, NodeIO, getBounds, type Node as GltfNode } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshGPUInstancing, type InstancedMesh } from '@gltf-transform/extensions'
import {
  dedup,
  flatten,
  getGLPrimitiveCount,
  instance,
  join,
  meshopt,
  prune,
  simplify,
  weld,
} from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'

// ─────────────────────────────────────────────────────────────
// 인자
// ─────────────────────────────────────────────────────────────

type Mode = 'join' | 'instance' | 'none'
type UpAxis = 'y' | 'z'

interface Args {
  input: string
  output: string
  minPart: number
  simplifyRatio: number
  simplifyError: number
  mode: Mode
  meshoptOn: boolean
  json: boolean
  up: UpAxis
  scale: number
  center: boolean
}

function isMode(v: string): v is Mode {
  return v === 'join' || v === 'instance' || v === 'none'
}

function isUpAxis(v: string): v is UpAxis {
  return v === 'y' || v === 'z'
}

function numArg(argv: readonly string[], i: number, flag: string): number {
  const raw = argv[i]
  if (raw === undefined) throw new Error(`${flag} 뒤에 숫자가 필요하다`)
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new Error(`${flag} 값이 숫자가 아니다: ${raw}`)
  return n
}

function parseArgs(argv: readonly string[]): Args {
  let input = ''
  let output = ''
  let minPart = 20
  let simplifyRatio = 0
  let simplifyError = 0.01
  let mode: Mode = 'none'
  let meshoptOn = true
  let json = false
  let up: UpAxis = 'y'
  let scale = 1
  let center = false

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
      case '--min-part':
        minPart = numArg(argv, i + 1, '--min-part')
        i += 1
        break
      case '--simplify':
        simplifyRatio = numArg(argv, i + 1, '--simplify')
        i += 1
        break
      case '--simplify-error':
        simplifyError = numArg(argv, i + 1, '--simplify-error')
        i += 1
        break
      case '--mode': {
        const next = argv[i + 1]
        if (next === undefined || !isMode(next)) throw new Error('--mode 는 join|instance|none')
        mode = next
        i += 1
        break
      }
      case '--up': {
        const next = argv[i + 1]
        if (next === undefined || !isUpAxis(next)) throw new Error('--up 은 y|z')
        up = next
        i += 1
        break
      }
      case '--scale':
        scale = numArg(argv, i + 1, '--scale')
        i += 1
        break
      case '--center':
        center = true
        break
      case '--no-meshopt':
        meshoptOn = false
        break
      case '--json':
        json = true
        break
      default:
        if (a.startsWith('--')) throw new Error(`알 수 없는 옵션: ${a}`)
        input = a
    }
  }

  if (input === '') throw new Error('입력 GLB 경로가 필요하다')
  if (output === '') throw new Error('--out 이 필요하다')
  return {
    input: resolve(input),
    output: resolve(output),
    minPart,
    simplifyRatio,
    simplifyError,
    mode,
    meshoptOn,
    json,
    up,
    scale,
    center,
  }
}

// ─────────────────────────────────────────────────────────────
// 통계
// ─────────────────────────────────────────────────────────────

interface Stats {
  meshes: number
  primitives: number
  /** 씬에 배치된 mesh 노드. 인스턴싱된 노드는 1개로 센다 */
  meshNodes: number
  instancedNodes: number
  /** Σ(노드 × primitive). 인스턴싱 노드는 primitive 당 1 */
  drawCalls: number
  /** 지오메트리 유일 삼각형 */
  uniqueTriangles: number
  /** 화면에 그려지는 삼각형 (인스턴스 반영) */
  renderTriangles: number
  uniqueVertices: number
  materials: number
}

/** 노드에 붙은 GPU 인스턴싱 개수. 없으면 1. */
function instanceCount(node: GltfNode): number {
  const ext = node.getExtension<InstancedMesh>(EXTMeshGPUInstancing.EXTENSION_NAME)
  if (ext === null) return 1
  const attr = ext.listAttributes()[0]
  return attr ? attr.getCount() : 1
}

function collectStats(doc: Document): Stats {
  const root = doc.getRoot()
  let primitives = 0
  let uniqueTriangles = 0
  let uniqueVertices = 0

  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      primitives += 1
      uniqueTriangles += getGLPrimitiveCount(prim)
      uniqueVertices += prim.getAttribute('POSITION')?.getCount() ?? 0
    }
  }

  let meshNodes = 0
  let instancedNodes = 0
  let drawCalls = 0
  let renderTriangles = 0

  for (const node of root.listNodes()) {
    const mesh = node.getMesh()
    if (mesh === null) continue
    meshNodes += 1
    const n = instanceCount(node)
    if (n > 1) instancedNodes += 1
    for (const prim of mesh.listPrimitives()) {
      // 인스턴싱은 primitive 하나를 한 번의 draw 로 n 벌 그린다
      drawCalls += 1
      renderTriangles += getGLPrimitiveCount(prim) * n
    }
  }

  return {
    meshes: root.listMeshes().length,
    primitives,
    meshNodes,
    instancedNodes,
    drawCalls,
    uniqueTriangles,
    renderTriangles,
    uniqueVertices,
    materials: root.listMaterials().length,
  }
}

function fmtStats(label: string, s: Stats): string {
  return [
    `${label}`,
    `  mesh ${s.meshes}  primitive ${s.primitives}  material ${s.materials}`,
    `  mesh 노드 ${s.meshNodes} (인스턴싱 ${s.instancedNodes})  draw call ${s.drawCalls.toLocaleString()}`,
    `  삼각형 유일 ${s.uniqueTriangles.toLocaleString()}  렌더 ${s.renderTriangles.toLocaleString()}`,
    `  정점 ${s.uniqueVertices.toLocaleString()}`,
  ].join('\n')
}

// ─────────────────────────────────────────────────────────────
// 작은 부품 제거
// ─────────────────────────────────────────────────────────────

interface DropReport {
  dropped: number
  keptMeshNodes: number
  droppedTriangles: number
  sceneDiagonal: number
}

/**
 * 월드 AABB 대각선이 임계 미만인 mesh 노드에서 **메시 참조만** 끊는다.
 *
 * `node.dispose()` 로 노드를 지우지 않는 이유: 부품 노드가 자식을 가질 수 있고, 부모를 지우면
 * 자식의 월드 변환이 사라져 남은 부품이 엉뚱한 자리로 간다. 참조만 끊어 두면 `prune()` 이
 * 빈 잎 노드를 알아서 정리한다.
 *
 * 임계는 **씬 단위**다. 이 자산은 1 unit = 1 mm 이므로 20 = 20 mm (10-3d-assets.md §1.5 의 버킷).
 */
function dropTinyParts(doc: Document, minDiagonal: number): DropReport {
  const root = doc.getRoot()
  const scene = root.listScenes()[0]
  const sceneBox = scene ? getBounds(scene) : { min: [0, 0, 0], max: [0, 0, 0] }
  const sceneDiagonal = diagonal(sceneBox)

  let dropped = 0
  let droppedTriangles = 0
  let keptMeshNodes = 0

  for (const node of root.listNodes()) {
    const mesh = node.getMesh()
    if (mesh === null) continue
    const d = diagonal(getBounds(node))
    if (d < minDiagonal) {
      let tris = 0
      for (const prim of mesh.listPrimitives()) tris += getGLPrimitiveCount(prim)
      droppedTriangles += tris * instanceCount(node)
      node.setMesh(null)
      dropped += 1
    } else {
      keptMeshNodes += 1
    }
  }

  return { dropped, keptMeshNodes, droppedTriangles, sceneDiagonal }
}

function diagonal(box: { min: number[]; max: number[] }): number {
  const dx = (box.max[0] ?? 0) - (box.min[0] ?? 0)
  const dy = (box.max[1] ?? 0) - (box.min[1] ?? 0)
  const dz = (box.max[2] ?? 0) - (box.min[2] ?? 0)
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// ─────────────────────────────────────────────────────────────
// 좌표계 정규화
// ─────────────────────────────────────────────────────────────

/**
 * 원본은 Z 가 기체 장축이고 1 unit = 1 mm 다. glTF 규약은 **Y-up · 미터**이므로
 * 그대로 두면 뷰어가 매번 회전·스케일을 손으로 넣어야 하고, DB 의 카메라 기본값
 * (cameraZ = 5)도 5 mm 를 뜻하게 되어 아무것도 보이지 않는다. 자산 쪽에서 한 번에 바로잡는다.
 *
 * `center()` 대신 직접 계산하는 이유: 회전·스케일·이동을 **한 노드**에 모아 두면
 * 뒤이어 오는 `flatten()` 이 한 번에 굽고, 무엇이 적용됐는지 로그로 확인할 수 있다.
 */
function normalizeTransform(doc: Document, up: UpAxis, scale: number, center: boolean): string {
  if (up === 'y' && scale === 1 && !center) return '건너뜀'

  const scene = doc.getRoot().listScenes()[0]
  if (scene === undefined) throw new Error('씬이 없다')

  const wrapper = doc.createNode('__normalize')
  for (const child of scene.listChildren()) {
    scene.removeChild(child)
    wrapper.addChild(child)
  }
  scene.addChild(wrapper)

  // +Z 를 +Y 로 세우는 회전 = X 축 −90°. 쿼터니언 (sin(−45°), 0, 0, cos(−45°)).
  if (up === 'z') {
    const h = Math.SQRT1_2
    wrapper.setRotation([-h, 0, 0, h])
  }
  if (scale !== 1) wrapper.setScale([scale, scale, scale])

  let offset: [number, number, number] = [0, 0, 0]
  if (center) {
    // 회전·스케일이 반영된 뒤의 AABB 를 봐야 한다
    const b = getBounds(scene)
    offset = [
      -(((b.min[0] ?? 0) + (b.max[0] ?? 0)) / 2),
      -(((b.min[1] ?? 0) + (b.max[1] ?? 0)) / 2),
      -(((b.min[2] ?? 0) + (b.max[2] ?? 0)) / 2),
    ]
    wrapper.setTranslation(offset)
  }

  return `up=${up} scale=${scale} offset=[${offset.map((v) => v.toFixed(3)).join(', ')}]`
}

// ─────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────

function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}

const args = parseArgs(process.argv.slice(2))
const out = (line: string): void => {
  if (!args.json) process.stdout.write(`${line}\n`)
}

await MeshoptEncoder.ready
await MeshoptSimplifier.ready

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  // EXT_meshopt_compression 은 읽기·쓰기 모두 외부 코덱을 요구한다. 등록하지 않으면
  // 변환은 통과하고 **직렬화 순간**에 encodeFilterOct 가 undefined 라며 죽는다.
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
  // gltf-transform 의 기본 로거는 stdout 을 어지럽힌다. 경고 이상만 본다.
  .setLogger(new Logger(Logger.Verbosity.WARN))

const inputBytes = statSync(args.input).size
out(`입력  ${args.input}  (${mib(inputBytes)})`)

const doc = await io.read(args.input)
const before = collectStats(doc)
out(`\n${fmtStats('변환 전', before)}`)

// ① 정점 웰딩 — FBXLoader 는 비인덱스 지오메트리를 뱉는다. 여기가 가장 큰 한 방이다.
await doc.transform(weld())
out(`\n[weld] 정점 ${collectStats(doc).uniqueVertices.toLocaleString()}`)

// ② 동일 메시·머티리얼·액세서 병합. 중복 지오메트리 109개가 여기서 사라진다.
await doc.transform(dedup())

// ③ 참조되지 않는 속성 제거. 텍스처가 0개이므로 TEXCOORD_0 이 전량 낭비다 (§4).
await doc.transform(prune({ keepAttributes: false, keepIndices: false, keepLeaves: false }))
// UV 가 사라지면 (위치·법선) 만으로 같아지는 정점이 새로 생긴다. 한 번 더 웰딩한다.
await doc.transform(weld())
out(`[dedup+prune+weld] ${fmtStats('', collectStats(doc)).trim()}`)

// ④ 보이지 않는 부품 버리기
let drop: DropReport | null = null
if (args.minPart > 0) {
  drop = dropTinyParts(doc, args.minPart)
  await doc.transform(prune({ keepAttributes: false, keepIndices: false, keepLeaves: false }))
  out(
    `\n[min-part ${args.minPart}] 씬 대각선 ${drop.sceneDiagonal.toFixed(0)} units · ` +
      `버린 부품 ${drop.dropped} · 남은 부품 ${drop.keptMeshNodes} · ` +
      `버린 렌더 삼각형 ${drop.droppedTriangles.toLocaleString()}`
  )
}

// ⑤ 좌표계 정규화 (Y-up · 미터 · 원점 중심)
const normalized = normalizeTransform(doc, args.up, args.scale, args.center)
out(`[normalize] ${normalized}`)

// ⑥ 데시메이션
if (args.simplifyRatio > 0) {
  await doc.transform(
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: args.simplifyRatio,
      error: args.simplifyError,
      // CAD 부품은 서로 맞물린다. 경계를 고정하지 않으면 접합부에 틈이 벌어진다.
      lockBorder: true,
    })
  )
  out(`[simplify ${args.simplifyRatio}] 삼각형 ${collectStats(doc).uniqueTriangles.toLocaleString()}`)
}

// ⑦ draw call 전략
if (args.mode === 'join') {
  // join 은 내부적으로 flatten 을 돌려 인스턴싱을 파괴한다. ④·⑤ 뒤라 복제 대상이 작다.
  await doc.transform(flatten(), join({ keepNamed: false }))
} else if (args.mode === 'instance') {
  // 같은 메시를 2개 이상 노드가 참조하면 GPU 인스턴싱으로 묶는다. 지오메트리 복제 0.
  await doc.transform(instance({ min: 2 }))
}
if (args.mode !== 'none') out(`[mode ${args.mode}] draw call ${collectStats(doc).drawCalls}`)

// ⑧ 양자화 + 압축
if (args.meshoptOn) {
  await doc.transform(
    meshopt({
      encoder: MeshoptEncoder,
      level: 'high',
      // 메시별 볼륨은 노드 스케일을 고쳐 써서 메시 공유를 깨뜨릴 수 있다 — 씬 볼륨으로 고정
      quantizationVolume: 'scene',
    })
  )
}

const bytes = await io.writeBinary(doc)
mkdirSync(dirname(args.output), { recursive: true })
writeFileSync(args.output, bytes)

const after = collectStats(doc)
out(`\n${fmtStats('변환 후', after)}`)
out(`\n출력  ${args.output}  (${mib(bytes.byteLength)})  ${bytes.byteLength.toLocaleString()} bytes`)

if (args.json) {
  process.stdout.write(
    `${JSON.stringify(
      {
        input: args.input,
        output: args.output,
        options: {
          minPart: args.minPart,
          simplify: args.simplifyRatio,
          simplifyError: args.simplifyError,
          mode: args.mode,
          meshopt: args.meshoptOn,
        },
        inputBytes,
        outputBytes: bytes.byteLength,
        before,
        after,
        drop,
      },
      null,
      2
    )}\n`
  )
}
