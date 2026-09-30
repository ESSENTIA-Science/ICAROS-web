/**
 * FBX 바이너리 실측기 (P7-26).
 *
 * 왜 직접 파서를 쓰는가: `@gltf-transform/cli`·Blender·FBX2glTF 가 이 머신에 없고 설치가 금지돼 있다.
 * 그렇다고 "16MB 니까 크겠지" 로 판정할 수는 없다 — 16MB 중 지오메트리와 임베드 텍스처의 비중에 따라
 * 대응(데시메이션 vs 텍스처 재인코딩)이 정반대로 갈리고, glTF 로 구웠을 때의 크기는 FBX 정점 수가 아니라
 * **(위치·법선·UV) 조합의 유일 개수**로 결정된다. 그래서 추정 대신 바이트를 읽어 그 값을 직접 센다.
 *
 * 포맷 근거 (Kaydara/Autodesk FBX binary):
 *   [0..19]  "Kaydara FBX Binary  "   [20] 0x00   [21..22] 0x1A 0x00   [23..26] uint32 version
 *   이후 노드 레코드 트리. version < 7500 이면 오프셋 필드가 uint32, >= 7500 이면 uint64.
 *   노드 레코드: EndOffset, NumProperties, PropertyListLen, NameLen(uint8), Name, properties, children, null-record
 *   널 레코드(자식 목록 종료) = 헤더 크기(13 또는 25바이트)만큼의 0.
 *
 *   npx tsx scripts/model/inspect-fbx.ts [경로] [--top N] [--brotli 0..11] [--json]
 *   기본 경로: public/assets/icx-2.fbx
 */
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { brotliCompressSync, constants as zlibConstants, gzipSync, inflateSync } from 'node:zlib'

const MAGIC = 'Kaydara FBX Binary  '

/** 법선·UV 웰딩 허용 오차. CAD 테셀레이션은 같은 면의 법선을 비트 단위로 같게 쓰지만, 부동소수 잡음을 흡수한다. */
const WELD_DECIMALS = 6

// ─────────────────────────────────────────────────────────────
// 파서
// ─────────────────────────────────────────────────────────────

type ArrayCode = 'f' | 'd' | 'l' | 'i' | 'b'

const ARRAY_ELEM_BYTES: Record<ArrayCode, number> = { f: 4, d: 8, l: 8, i: 4, b: 1 }

interface ScalarProp {
  kind: 'scalar'
  code: string
  value: number | boolean
}
interface StringProp {
  kind: 'string'
  code: 'S'
  value: string
  byteLength: number
}
interface RawProp {
  kind: 'raw'
  code: 'R'
  byteLength: number
  dataOffset: number
}
interface ArrayProp {
  kind: 'array'
  code: ArrayCode
  count: number
  encoding: number
  compressedBytes: number
  dataOffset: number
}
type FbxProp = ScalarProp | StringProp | RawProp | ArrayProp

interface FbxNode {
  name: string
  /** 레코드 시작 바이트(헤더 포함) */
  start: number
  /** EndOffset — 이 레코드가 끝나는 절대 오프셋 */
  end: number
  props: FbxProp[]
  children: FbxNode[]
}

interface ParseWarning {
  offset: number
  message: string
}

function isArrayCode(code: string): code is ArrayCode {
  return code === 'f' || code === 'd' || code === 'l' || code === 'i' || code === 'b'
}

function readOffsetField(buf: Buffer, at: number, wide: boolean): number {
  if (!wide) return buf.readUInt32LE(at)
  const v = buf.readBigUInt64LE(at)
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`오프셋이 안전 정수 범위를 넘습니다: ${v}`)
  return Number(v)
}

function readProp(buf: Buffer, at: number): { prop: FbxProp; next: number } {
  const byte = buf.readUInt8(at)
  const code = String.fromCharCode(byte)
  const p = at + 1
  switch (code) {
    case 'Y':
      return { prop: { kind: 'scalar', code, value: buf.readInt16LE(p) }, next: p + 2 }
    case 'C':
      return { prop: { kind: 'scalar', code, value: buf.readUInt8(p) !== 0 }, next: p + 1 }
    case 'I':
      return { prop: { kind: 'scalar', code, value: buf.readInt32LE(p) }, next: p + 4 }
    case 'F':
      return { prop: { kind: 'scalar', code, value: buf.readFloatLE(p) }, next: p + 4 }
    case 'D':
      return { prop: { kind: 'scalar', code, value: buf.readDoubleLE(p) }, next: p + 8 }
    case 'L':
      return { prop: { kind: 'scalar', code, value: Number(buf.readBigInt64LE(p)) }, next: p + 8 }
    case 'S': {
      const len = buf.readUInt32LE(p)
      const bytes = buf.subarray(p + 4, p + 4 + len)
      // FBX 는 이름 안에 \x00\x01 을 구분자로 넣는다. 문자 인코딩은 규격상 보장되지 않는데,
      // 이 파일의 부품명에는 한글(UTF-8)이 섞여 있어 latin1 로만 읽으면 깨진다.
      // UTF-8 로 먼저 시도하고 치환 문자(U+FFFD)가 나오면 latin1 로 되돌린다.
      const utf8 = bytes.toString('utf8')
      const raw = utf8.includes('�') ? bytes.toString('latin1') : utf8
      return {
        prop: { kind: 'string', code: 'S', value: raw.replace(/\u0000\u0001/g, '::'), byteLength: len },
        next: p + 4 + len,
      }
    }
    case 'R': {
      const len = buf.readUInt32LE(p)
      return { prop: { kind: 'raw', code: 'R', byteLength: len, dataOffset: p + 4 }, next: p + 4 + len }
    }
    default: {
      if (!isArrayCode(code)) throw new Error(`알 수 없는 property type code '${code}' (0x${byte.toString(16)}) @${at}`)
      const count = buf.readUInt32LE(p)
      const encoding = buf.readUInt32LE(p + 4)
      const compressedBytes = buf.readUInt32LE(p + 8)
      return {
        prop: { kind: 'array', code, count, encoding, compressedBytes, dataOffset: p + 12 },
        next: p + 12 + compressedBytes,
      }
    }
  }
}

function parseNodes(
  buf: Buffer,
  from: number,
  until: number,
  wide: boolean,
  warnings: ParseWarning[],
  depth: number,
): FbxNode[] {
  const headerBytes = wide ? 25 : 13
  const nodes: FbxNode[] = []
  let at = from

  while (at + headerBytes <= until) {
    const end = readOffsetField(buf, at, wide)
    const numProps = readOffsetField(buf, at + (wide ? 8 : 4), wide)
    const propListLen = readOffsetField(buf, at + (wide ? 16 : 8), wide)
    const nameLen = buf.readUInt8(at + (wide ? 24 : 12))

    // 널 레코드 = 전 필드 0. 자식 목록의 끝.
    if (end === 0 && numProps === 0 && propListLen === 0 && nameLen === 0) break
    if (end <= at || end > buf.length) {
      warnings.push({ offset: at, message: `EndOffset ${end} 이 범위를 벗어남 — 이 지점 이후를 읽지 못했습니다` })
      break
    }

    const nameStart = at + headerBytes
    const name = buf.subarray(nameStart, nameStart + nameLen).toString('latin1')
    const propStart = nameStart + nameLen

    const props: FbxProp[] = []
    let cursor = propStart
    try {
      for (let i = 0; i < numProps; i += 1) {
        const { prop, next } = readProp(buf, cursor)
        props.push(prop)
        cursor = next
      }
    } catch (err) {
      warnings.push({ offset: cursor, message: `${name}: property 를 읽지 못했습니다 — ${(err as Error).message}` })
    }

    const node: FbxNode = { name, start: at, end, props, children: [] }

    // property 목록 뒤에 공간이 남으면 자식 목록이다.
    const childStart = propStart + propListLen
    if (childStart < end && depth < 64) {
      node.children = parseNodes(buf, childStart, end, wide, warnings, depth + 1)
    }

    nodes.push(node)
    at = end
  }

  return nodes
}

// ─────────────────────────────────────────────────────────────
// 배열 페이로드 디코드
// ─────────────────────────────────────────────────────────────

function decodeArray(buf: Buffer, prop: ArrayProp): Buffer {
  const slice = buf.subarray(prop.dataOffset, prop.dataOffset + prop.compressedBytes)
  if (prop.encoding === 0) return Buffer.from(slice)
  if (prop.encoding === 1) return inflateSync(slice)
  throw new Error(`알 수 없는 array encoding ${prop.encoding}`)
}

function decodedByteLength(prop: ArrayProp): number {
  if (prop.encoding === 0) return prop.compressedBytes
  return prop.count * ARRAY_ELEM_BYTES[prop.code]
}

function readInt32s(buf: Buffer, prop: ArrayProp): Int32Array {
  const raw = decodeArray(buf, prop)
  const n = Math.min(prop.count, Math.floor(raw.length / 4))
  const out = new Int32Array(n)
  for (let i = 0; i < n; i += 1) out[i] = raw.readInt32LE(i * 4)
  return out
}

/** FBX 는 좌표를 double(`d`)로 쓰지만 float(`f`) 배열도 규격상 유효하므로 둘 다 받는다. */
function readFloats(buf: Buffer, prop: ArrayProp): Float64Array {
  const raw = decodeArray(buf, prop)
  const elem = ARRAY_ELEM_BYTES[prop.code]
  const n = Math.min(prop.count, Math.floor(raw.length / elem))
  const out = new Float64Array(n)
  if (prop.code === 'd') for (let i = 0; i < n; i += 1) out[i] = raw.readDoubleLE(i * 8)
  else if (prop.code === 'f') for (let i = 0; i < n; i += 1) out[i] = raw.readFloatLE(i * 4)
  else for (let i = 0; i < n; i += 1) out[i] = raw.readInt32LE(i * 4)
  return out
}

// ─────────────────────────────────────────────────────────────
// 트리 헬퍼
// ─────────────────────────────────────────────────────────────

function childNamed(node: FbxNode, name: string): FbxNode | undefined {
  return node.children.find((c) => c.name === name)
}

function firstString(node: FbxNode | undefined): string | undefined {
  if (!node) return undefined
  for (const p of node.props) if (p.kind === 'string') return p.value
  return undefined
}

function firstArray(node: FbxNode | undefined): ArrayProp | undefined {
  if (!node) return undefined
  for (const p of node.props) if (p.kind === 'array') return p
  return undefined
}

function propString(node: FbxNode, i: number): string {
  const p = node.props[i]
  return p && p.kind === 'string' ? p.value : ''
}

/** `Properties70` 의 `P` 레코드에서 뒤쪽 숫자 값들을 이름으로 찾는다. */
function prop70Numbers(node: FbxNode, key: string): number[] | undefined {
  const bag = childNamed(node, 'Properties70')
  if (!bag) return undefined
  for (const p of bag.children) {
    if (p.name !== 'P') continue
    const head = p.props[0]
    if (!head || head.kind !== 'string' || head.value !== key) continue
    const nums: number[] = []
    for (const v of p.props) if (v.kind === 'scalar' && typeof v.value === 'number') nums.push(v.value)
    return nums
  }
  return undefined
}

function prop70Number(node: FbxNode, key: string): number | undefined {
  const nums = prop70Numbers(node, key)
  return nums && nums.length > 0 ? nums[nums.length - 1] : undefined
}

function prop70Vec3(node: FbxNode, key: string, fallback: number): [number, number, number] {
  const nums = prop70Numbers(node, key)
  if (!nums || nums.length < 3) return [fallback, fallback, fallback]
  const tail = nums.slice(-3)
  return [tail[0] ?? fallback, tail[1] ?? fallback, tail[2] ?? fallback]
}

function walk(nodes: FbxNode[], visit: (n: FbxNode) => void): void {
  for (const n of nodes) {
    visit(n)
    walk(n.children, visit)
  }
}

// ─────────────────────────────────────────────────────────────
// 레이어 접근자 (법선·UV 매핑 규칙)
// ─────────────────────────────────────────────────────────────

interface Layer {
  mapping: string
  reference: string
  values: Float64Array
  stride: number
  index: Int32Array | null
}

function readLayer(buf: Buffer, layerNode: FbxNode | undefined, valueKey: string, indexKey: string, stride: number): Layer | null {
  if (!layerNode) return null
  const values = firstArray(childNamed(layerNode, valueKey))
  if (!values) return null
  const idx = firstArray(childNamed(layerNode, indexKey))
  return {
    mapping: firstString(childNamed(layerNode, 'MappingInformationType')) ?? 'Direct',
    reference: firstString(childNamed(layerNode, 'ReferenceInformationType')) ?? 'Direct',
    values: readFloats(buf, values),
    stride,
    index: idx ? readInt32s(buf, idx) : null,
  }
}

/** corner(폴리곤 정점 순번) → 값 배열의 element 인덱스. 매핑 규칙을 못 읽으면 -1. */
function layerElement(layer: Layer, corner: number, vertexIndex: number, polygon: number): number {
  let base: number
  switch (layer.mapping) {
    case 'ByPolygonVertex':
      base = corner
      break
    case 'ByVertice':
    case 'ByVertex':
      base = vertexIndex
      break
    case 'ByPolygon':
      base = polygon
      break
    case 'AllSame':
      base = 0
      break
    default:
      return -1
  }
  if (layer.reference === 'Direct') return base
  if (layer.reference === 'IndexToDirect' || layer.reference === 'Index') {
    if (!layer.index || base >= layer.index.length) return -1
    return layer.index[base] ?? -1
  }
  return -1
}

const round = (v: number): number => Number(v.toFixed(WELD_DECIMALS))

// ─────────────────────────────────────────────────────────────
// 양자화 — 실제 GLB BIN 청크와 같은 바이트 구성을 만들어 압축률을 측정한다
// ─────────────────────────────────────────────────────────────

interface QuantBins {
  pos: Buffer[]
  nrm: Buffer[]
  uv: Buffer[]
  idx: Buffer[]
}

const clampI16 = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v)))
const clampI8 = (v: number): number => Math.max(-128, Math.min(127, Math.round(v)))
const clampU16 = (v: number): number => Math.max(0, Math.min(65535, Math.round(v)))

/**
 * KHR_mesh_quantization 과 같은 규칙: POSITION i16×3(메시 bbox 정규화) · NORMAL i8×3 · TEXCOORD u16×2 · index u16/u32.
 * 실제 GLB BIN 청크와 바이트 구성이 같으므로, 이 버퍼를 gzip/brotli 한 크기가 전송량의 실측 근사가 된다.
 */
function appendQuantized(bins: QuantBins, pos: number[], nrm: number[], uv: number[], idx: number[]): void {
  const vCount = Math.floor(pos.length / 3)
  if (vCount === 0) return

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  for (let i = 0; i < vCount; i += 1) {
    const x = pos[i * 3] ?? 0
    const y = pos[i * 3 + 1] ?? 0
    const z = pos[i * 3 + 2] ?? 0
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
    const u = uv[i * 2] ?? 0
    const v = uv[i * 2 + 1] ?? 0
    if (u < minU) minU = u
    if (v < minV) minV = v
    if (u > maxU) maxU = u
    if (v > maxV) maxV = v
  }
  const spanX = Math.max(1e-12, maxX - minX)
  const spanY = Math.max(1e-12, maxY - minY)
  const spanZ = Math.max(1e-12, maxZ - minZ)
  const spanU = Math.max(1e-12, maxU - minU)
  const spanV = Math.max(1e-12, maxV - minV)

  const pb = Buffer.allocUnsafe(vCount * 6)
  const nb = Buffer.allocUnsafe(vCount * 3)
  const ub = Buffer.allocUnsafe(vCount * 4)
  for (let i = 0; i < vCount; i += 1) {
    pb.writeInt16LE(clampI16(((((pos[i * 3] ?? 0) - minX) / spanX) * 65535) - 32768), i * 6)
    pb.writeInt16LE(clampI16(((((pos[i * 3 + 1] ?? 0) - minY) / spanY) * 65535) - 32768), i * 6 + 2)
    pb.writeInt16LE(clampI16(((((pos[i * 3 + 2] ?? 0) - minZ) / spanZ) * 65535) - 32768), i * 6 + 4)
    nb.writeInt8(clampI8((nrm[i * 3] ?? 0) * 127), i * 3)
    nb.writeInt8(clampI8((nrm[i * 3 + 1] ?? 0) * 127), i * 3 + 1)
    nb.writeInt8(clampI8((nrm[i * 3 + 2] ?? 0) * 127), i * 3 + 2)
    ub.writeUInt16LE(clampU16((((uv[i * 2] ?? 0) - minU) / spanU) * 65535), i * 4)
    ub.writeUInt16LE(clampU16((((uv[i * 2 + 1] ?? 0) - minV) / spanV) * 65535), i * 4 + 2)
  }

  const wide = vCount >= 65536
  const ib = Buffer.allocUnsafe(idx.length * (wide ? 4 : 2))
  for (let i = 0; i < idx.length; i += 1) {
    const v = idx[i] ?? 0
    if (wide) ib.writeUInt32LE(v, i * 4)
    else ib.writeUInt16LE(v, i * 2)
  }

  bins.pos.push(pb)
  bins.nrm.push(nb)
  bins.uv.push(ub)
  bins.idx.push(ib)
}

// ─────────────────────────────────────────────────────────────
// 분석
// ─────────────────────────────────────────────────────────────

interface MeshStat {
  id: number
  name: string
  bytes: number
  vertices: number
  polygons: number
  triangles: number
  ngonMax: number
  normalMapping: string
  uvSets: number
  hasUv: boolean
  /** (위치·법선·UV) 유일 조합 = glTF 로 구웠을 때의 실제 정점 수 */
  weldedVertices: number
  /** UV 를 버렸을 때의 정점 수. 이 파일은 텍스처가 0개라 UV 가 실제로 필요한지 판정하는 근거가 된다. */
  weldedNoUv: number
  /** 머티리얼 레이어 매핑. ByPolygon 이면 한 메시가 여러 primitive 로 쪼개진다. */
  materialMapping: string
  /** 이 메시가 실제로 쓰는 머티리얼 슬롯 수 = glTF primitive 수 */
  materialSlots: number
  /** 이 Geometry 를 참조하는 Model 수 = 씬에 몇 번 배치되는가 */
  instances: number
  /** 월드 스케일을 적용한 부품 대각선 길이(mm). 웹에서 보일 크기인지 판정하는 근거. */
  worldDiagonalMm: number
  bbox: [number, number, number, number, number, number] | null
}

interface Report {
  file: { path: string; bytes: number; sha256: string }
  header: { version: number; wideOffsets: boolean }
  globals: { unitScaleFactor: number | undefined; upAxis: number | undefined; frontAxis: number | undefined; creator: string }
  topLevel: { name: string; bytes: number }[]
  objectTypes: { name: string; count: number; bytes: number }[]
  modelSubtypes: { name: string; count: number }[]
  nodeNames: { totalModels: number; uniqueNames: number; autoNamedModels: number; top: { name: string; count: number }[] }
  connections: { total: number; edges: { edge: string; count: number }[]; meshInstances: number }
  meshes: MeshStat[]
  totals: {
    meshCount: number
    fbxVertices: number
    polygons: number
    triangles: number
    corners: number
    weldedVertices: number
    weldedNoUv: number
    meshesWithUv: number
    primitives: number
  }
  duplicates: { uniqueGeometries: number; duplicateGeometries: number; duplicateBytes: number }
  bbox: { min: [number, number, number]; max: [number, number, number] } | null
  worldBbox: { min: [number, number, number]; max: [number, number, number] } | null
  transforms: { rotatedModels: number; scaledModels: number; scaleValues: { value: string; count: number }[] }
  materials: string[]
  textureRefs: { node: string; filename: string; relative: string }[]
  embedded: { node: string; relativeFilename: string; bytes: number; signature: string }[]
  animation: { stacks: number; layers: number; curveNodes: number; curves: number; curveKeyBytes: number }
  rigging: { skins: number; otherDeformers: number; poses: number }
  arrays: { count: number; compressedBytes: number; decodedBytes: number; deflated: number; stored: number }
  budget: { geometryPayloadBytes: number; embeddedTextureBytes: number; animationPayloadBytes: number; otherBytes: number }
  glbEstimate: {
    f32Bytes: number
    quantizedBytes: number
    indexBytes: number
    perVertexBytesF32: number
    perVertexBytesQuantized: number
  }
  measured: {
    binBytes: number
    attr: { pos: number; nrm: number; uv: number; idx: number }
    attrGzip: { pos: number; nrm: number; uv: number; idx: number }
    gzipBytes: number
    brotliBytes: number
    brotliQuality: number
  }
  warnings: string[]
}

/** 파일 시그니처로 임베드 이미지 포맷을 판정한다 — 확장자를 믿지 않는다. */
function imageSignature(buf: Buffer, at: number, len: number): string {
  const b = buf.subarray(at, at + Math.min(len, 16))
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47) return 'PNG'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'JPEG'
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'WEBP'
  if (b.length >= 2 && b.subarray(0, 2).toString('latin1') === 'BM') return 'BMP'
  if (b.length >= 4 && b.subarray(0, 4).toString('latin1') === 'DDS ') return 'DDS'
  return `unknown(${Array.from(b.subarray(0, 4)).map((v) => v.toString(16).padStart(2, '0')).join(' ')})`
}

function analyze(buf: Buffer, filePath: string, brotliQuality: number): Report {
  const warnings: ParseWarning[] = []

  if (buf.subarray(0, 20).toString('latin1') !== MAGIC) {
    throw new Error('Kaydara FBX Binary 시그니처가 아닙니다 — ASCII FBX 이거나 다른 포맷입니다')
  }
  const version = buf.readUInt32LE(23)
  const wide = version >= 7500
  const roots = parseNodes(buf, 27, buf.length, wide, warnings, 0)

  const topLevel = roots.map((n) => ({ name: n.name, bytes: n.end - n.start }))
  const objects = roots.find((n) => n.name === 'Objects')
  if (!objects) warnings.push({ offset: 0, message: 'Objects 섹션을 찾지 못했습니다' })
  const objChildren = objects?.children ?? []

  const globalsNode = roots.find((n) => n.name === 'GlobalSettings')
  const creatorNode = roots.find((n) => n.name === 'Creator')
  const globals = {
    unitScaleFactor: globalsNode ? prop70Number(globalsNode, 'UnitScaleFactor') : undefined,
    upAxis: globalsNode ? prop70Number(globalsNode, 'UpAxis') : undefined,
    frontAxis: globalsNode ? prop70Number(globalsNode, 'FrontAxis') : undefined,
    creator: firstString(creatorNode) ?? '(없음)',
  }

  const objectTypeMap = new Map<string, { count: number; bytes: number }>()
  for (const o of objChildren) {
    const acc = objectTypeMap.get(o.name) ?? { count: 0, bytes: 0 }
    acc.count += 1
    acc.bytes += o.end - o.start
    objectTypeMap.set(o.name, acc)
  }

  // ── Connections 그래프 ─────────────────────────────────────
  // 인스턴싱 여부를 여기서만 알 수 있다: Geometry 하나에 Model 여럿이 붙으면 draw call 은 Model 수만큼 난다.
  const idToType = new Map<number, string>()
  for (const o of objChildren) {
    const p = o.props[0]
    if (p && p.kind === 'scalar' && typeof p.value === 'number') idToType.set(p.value, o.name)
  }
  const edgeMap = new Map<string, number>()
  const geoToModels = new Map<number, number[]>()
  const modelParent = new Map<number, number>()
  let meshInstances = 0
  let connTotal = 0
  for (const c of roots.find((n) => n.name === 'Connections')?.children ?? []) {
    if (c.name !== 'C') continue
    connTotal += 1
    const sp = c.props[1]
    const dp = c.props[2]
    const srcId = sp && sp.kind === 'scalar' && typeof sp.value === 'number' ? sp.value : -1
    const dstId = dp && dp.kind === 'scalar' && typeof dp.value === 'number' ? dp.value : -1
    const src = idToType.get(srcId) ?? '?'
    const dst = dstId === 0 ? 'RootNode' : (idToType.get(dstId) ?? '?')
    const key = `${src}→${dst}`
    edgeMap.set(key, (edgeMap.get(key) ?? 0) + 1)
    if (src === 'Geometry' && dst === 'Model') {
      meshInstances += 1
      const list = geoToModels.get(srcId)
      if (list) list.push(dstId)
      else geoToModels.set(srcId, [dstId])
    }
    // FBX OO 연결은 자식→부모 방향이다.
    if (src === 'Model' && dst === 'Model') modelParent.set(srcId, dstId)
  }

  // Model 의 로컬 변환. 회전·스케일이 항등이면 이동만 합성해도 월드 좌표가 정확하다.
  interface ModelXform {
    t: [number, number, number]
    r: [number, number, number]
    s: [number, number, number]
  }
  const modelXform = new Map<number, ModelXform>()
  const scaleHist = new Map<string, number>()
  for (const m of objChildren.filter((c) => c.name === 'Model')) {
    const p = m.props[0]
    if (!p || p.kind !== 'scalar' || typeof p.value !== 'number') continue
    const t = prop70Vec3(m, 'Lcl Translation', 0)
    const r = prop70Vec3(m, 'Lcl Rotation', 0)
    const s = prop70Vec3(m, 'Lcl Scaling', 1)
    modelXform.set(p.value, { t, r, s })
    const key = s.map((v) => v.toPrecision(6)).join(',')
    scaleHist.set(key, (scaleHist.get(key) ?? 0) + 1)
  }

  // TRS 합성 — 회전은 무시한다 (AABB 는 회전으로 부풀기만 하므로 아래 월드 bbox 는 하한).
  const worldTS = new Map<number, { t: [number, number, number]; s: [number, number, number] }>()
  function accumulate(id: number, depth: number): { t: [number, number, number]; s: [number, number, number] } {
    const memo = worldTS.get(id)
    if (memo) return memo
    const self = modelXform.get(id) ?? { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }
    const parent = modelParent.get(id)
    let out = { t: [...self.t] as [number, number, number], s: [...self.s] as [number, number, number] }
    if (parent !== undefined && parent !== id && depth < 256) {
      const pw = accumulate(parent, depth + 1)
      out = {
        t: [pw.t[0] + pw.s[0] * self.t[0], pw.t[1] + pw.s[1] * self.t[1], pw.t[2] + pw.s[2] * self.t[2]],
        s: [pw.s[0] * self.s[0], pw.s[1] * self.s[1], pw.s[2] * self.s[2]],
      }
    }
    worldTS.set(id, out)
    return out
  }
  const rotatedModels = [...modelXform.values()].filter((v) => v.r.some((x) => Math.abs(x) > 1e-9)).length
  const scaledModels = [...modelXform.values()].filter((v) => v.s.some((x) => Math.abs(x - 1) > 1e-9)).length
  const scaleValues = [...scaleHist.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)

  const modelSubtypeMap = new Map<string, number>()
  const nameHist = new Map<string, number>()
  for (const m of objChildren.filter((c) => c.name === 'Model')) {
    const sub = propString(m, 2) || '(무명)'
    modelSubtypeMap.set(sub, (modelSubtypeMap.get(sub) ?? 0) + 1)
    const nm = propString(m, 1).split('::')[0] || '(무명)'
    nameHist.set(nm, (nameHist.get(nm) ?? 0) + 1)
  }
  // G11(부품 강조)은 GLB 안의 노드 이름을 키로 쓴다. CAD 자동 생성 이름("Body1")만 있으면 그 요구는 성립하지 않는다.
  const AUTO_NAME = /^(?:Body|Component|Part|Occurrence|Mesh|Null|Group|Sketch|v)\d*$/i
  const nameEntries = [...nameHist.entries()].sort((a, b) => b[1] - a[1])
  const autoNamed = nameEntries.filter(([n]) => AUTO_NAME.test(n)).reduce((s, [, c]) => s + c, 0)
  const nodeNames = {
    totalModels: nameEntries.reduce((s, [, c]) => s + c, 0),
    uniqueNames: nameEntries.length,
    autoNamedModels: autoNamed,
    top: nameEntries.slice(0, 15).map(([name, count]) => ({ name, count })),
  }

  // ── 메시 ───────────────────────────────────────────────────
  const meshes: MeshStat[] = []
  const quantBins: QuantBins = { pos: [], nrm: [], uv: [], idx: [] }
  let geometryPayloadBytes = 0
  let corners = 0
  const geoHashes = new Map<string, { count: number; bytes: number }>()
  let gMinX = Infinity
  let gMinY = Infinity
  let gMinZ = Infinity
  let gMaxX = -Infinity
  let gMaxY = -Infinity
  let gMaxZ = -Infinity

  for (const geo of objChildren.filter((c) => c.name === 'Geometry')) {
    const rawName = propString(geo, 1)
    const name = rawName.split('::')[0] || '(무명)'
    const geoBytes = geo.end - geo.start

    walk([geo], (n) => {
      for (const p of n.props) if (p.kind === 'array') geometryPayloadBytes += p.compressedBytes
    })

    const vertsProp = firstArray(childNamed(geo, 'Vertices'))
    const pviProp = firstArray(childNamed(geo, 'PolygonVertexIndex'))
    if (!vertsProp || !pviProp) {
      warnings.push({ offset: geo.start, message: `${name}: Vertices/PolygonVertexIndex 가 없어 건너뜁니다` })
      continue
    }

    // 중복 지오메트리 판정 — 압축 페이로드를 그대로 해시한다(같은 부품을 복제 export 했는지)
    const sig = createHash('sha1')
      .update(buf.subarray(vertsProp.dataOffset, vertsProp.dataOffset + vertsProp.compressedBytes))
      .update(buf.subarray(pviProp.dataOffset, pviProp.dataOffset + pviProp.compressedBytes))
      .digest('hex')
    const dupAcc = geoHashes.get(sig) ?? { count: 0, bytes: 0 }
    dupAcc.count += 1
    dupAcc.bytes += geoBytes
    geoHashes.set(sig, dupAcc)

    const positions = readFloats(buf, vertsProp)
    const pvi = readInt32s(buf, pviProp)
    const vertexCount = Math.floor(positions.length / 3)

    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const x = positions[i] ?? 0
      const y = positions[i + 1] ?? 0
      const z = positions[i + 2] ?? 0
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (z < minZ) minZ = z
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      if (z > maxZ) maxZ = z
    }
    if (vertexCount > 0) {
      if (minX < gMinX) gMinX = minX
      if (minY < gMinY) gMinY = minY
      if (minZ < gMinZ) gMinZ = minZ
      if (maxX > gMaxX) gMaxX = maxX
      if (maxY > gMaxY) gMaxY = maxY
      if (maxZ > gMaxZ) gMaxZ = maxZ
    }

    const normalLayerNode = childNamed(geo, 'LayerElementNormal')
    const normals = readLayer(buf, normalLayerNode, 'Normals', 'NormalsIndex', 3)
    const uvLayerNodes = geo.children.filter((c) => c.name === 'LayerElementUV')
    const uvs = readLayer(buf, uvLayerNodes[0], 'UV', 'UVIndex', 2)

    // 머티리얼 매핑이 ByPolygon 이면 한 메시가 슬롯 수만큼 primitive 로 쪼개진다 (draw call 증가)
    const matLayerNode = childNamed(geo, 'LayerElementMaterial')
    const matArr = firstArray(matLayerNode ? childNamed(matLayerNode, 'Materials') : undefined)
    const materialMapping = matLayerNode ? (firstString(childNamed(matLayerNode, 'MappingInformationType')) ?? 'Direct') : '(없음)'
    let materialSlots = 1
    if (matArr) {
      const ids = readInt32s(buf, matArr)
      const slots = new Set<number>()
      for (let i = 0; i < ids.length; i += 1) slots.add(ids[i] ?? 0)
      materialSlots = Math.max(1, slots.size)
    }

    // 폴리곤 순회 — (위치·법선·UV) 유일 조합을 웰딩해 실제 glTF 정점 배열을 만든다.
    // 카운트만 세지 않고 배열을 실제로 만드는 이유: 아래에서 이 배열을 양자화·압축해
    // GLB 크기를 "추정"이 아니라 "측정"하기 위해서다.
    const keyToIndex = new Map<string, number>()
    const keysNoUv = new Set<string>()
    const posOut: number[] = []
    const nrmOut: number[] = []
    const uvOut: number[] = []
    const cornerVert = new Int32Array(pvi.length)
    const triIdx: number[] = []
    let polygons = 0
    let triangles = 0
    let ngonMax = 0
    let polyStart = 0
    for (let c = 0; c < pvi.length; c += 1) {
      const raw = pvi[c] ?? 0
      const vi = raw < 0 ? ~raw : raw

      let nx = 0
      let ny = 0
      let nz = 0
      if (normals) {
        const e = layerElement(normals, c, vi, polygons)
        if (e >= 0) {
          nx = normals.values[e * 3] ?? 0
          ny = normals.values[e * 3 + 1] ?? 0
          nz = normals.values[e * 3 + 2] ?? 0
        }
      }
      let tu = 0
      let tv = 0
      if (uvs) {
        const e = layerElement(uvs, c, vi, polygons)
        if (e >= 0) {
          tu = uvs.values[e * 2] ?? 0
          tv = uvs.values[e * 2 + 1] ?? 0
        }
      }
      const keyNoUv = `${vi}|${round(nx)},${round(ny)},${round(nz)}`
      keysNoUv.add(keyNoUv)
      const key = `${keyNoUv}|${round(tu)},${round(tv)}`
      let vIndex = keyToIndex.get(key)
      if (vIndex === undefined) {
        vIndex = posOut.length / 3
        keyToIndex.set(key, vIndex)
        posOut.push(positions[vi * 3] ?? 0, positions[vi * 3 + 1] ?? 0, positions[vi * 3 + 2] ?? 0)
        nrmOut.push(nx, ny, nz)
        uvOut.push(tu, tv)
      }
      cornerVert[c] = vIndex

      if (raw < 0) {
        const size = c - polyStart + 1
        polygons += 1
        triangles += Math.max(0, size - 2)
        if (size > ngonMax) ngonMax = size
        // 팬 삼각분할 — 볼록 가정. CAD 테셀레이션은 이미 전부 삼각형(ngon 최대 3)이라 무손실이다.
        for (let k = 1; k + 1 < size; k += 1) {
          triIdx.push(cornerVert[polyStart] ?? 0, cornerVert[polyStart + k] ?? 0, cornerVert[polyStart + k + 1] ?? 0)
        }
        polyStart = c + 1
      }
    }
    if (polyStart < pvi.length) {
      warnings.push({ offset: geo.start, message: `${name}: PolygonVertexIndex 가 음수로 끝나지 않음 (마지막 ${pvi.length - polyStart} corner 미확정)` })
    }
    corners += pvi.length
    const unique = keyToIndex
    appendQuantized(quantBins, posOut, nrmOut, uvOut, triIdx)

    const idProp = geo.props[0]
    const geoId = idProp && idProp.kind === 'scalar' && typeof idProp.value === 'number' ? idProp.value : -1
    const owners = geoToModels.get(geoId) ?? []
    // 부품의 실제 크기(mm) — 1 unit = UnitScaleFactor cm 이므로 ×10 하면 mm.
    const firstOwner = owners[0]
    const ws = firstOwner !== undefined ? accumulate(firstOwner, 0).s : ([1, 1, 1] as [number, number, number])
    const unitCm = globals.unitScaleFactor ?? 1
    const worldDiagonalMm =
      vertexCount > 0
        ? Math.hypot((maxX - minX) * Math.abs(ws[0]), (maxY - minY) * Math.abs(ws[1]), (maxZ - minZ) * Math.abs(ws[2])) * unitCm * 10
        : 0

    meshes.push({
      id: geoId,
      instances: owners.length,
      worldDiagonalMm,
      name,
      bytes: geoBytes,
      vertices: vertexCount,
      polygons,
      triangles,
      ngonMax,
      normalMapping: normals ? `${normals.mapping}/${normals.reference}` : '(없음)',
      uvSets: uvLayerNodes.length,
      hasUv: uvs !== null && uvs.values.length > 0,
      weldedVertices: unique.size,
      weldedNoUv: keysNoUv.size,
      materialMapping,
      materialSlots,
      bbox: vertexCount > 0 ? [minX, minY, minZ, maxX, maxY, maxZ] : null,
    })
  }

  // 실측 압축 — 양자화 버퍼를 GLB BIN 청크처럼 이어 붙여 gzip/brotli 한다.
  // 승수 추정("Draco 는 보통 10배")을 쓰지 않기 위해서다. 이 값은 meshopt 인코딩 없이 얻은 것이라
  // 실제 meshopt/Draco 결과의 **보수적 상한**으로 읽어야 한다.
  const binPos = Buffer.concat(quantBins.pos)
  const binNrm = Buffer.concat(quantBins.nrm)
  const binUv = Buffer.concat(quantBins.uv)
  const binIdx = Buffer.concat(quantBins.idx)
  const bin = Buffer.concat([binPos, binNrm, binUv, binIdx])
  const gz = (b: Buffer): number => gzipSync(b, { level: 9 }).length
  const br = (b: Buffer): number =>
    brotliCompressSync(b, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: brotliQuality, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: b.length },
    }).length
  const measured = {
    binBytes: bin.length,
    attr: { pos: binPos.length, nrm: binNrm.length, uv: binUv.length, idx: binIdx.length },
    attrGzip: { pos: gz(binPos), nrm: gz(binNrm), uv: gz(binUv), idx: gz(binIdx) },
    gzipBytes: gz(bin),
    brotliBytes: br(bin),
    brotliQuality,
  }

  // 월드 AABB — 각 Geometry 의 로컬 bbox 를 소유 Model 의 누적 이동만큼 옮겨 합집합.
  // 회전·스케일이 하나라도 있으면 근사치가 되므로 그 사실을 함께 보고한다.
  let wMinX = Infinity
  let wMinY = Infinity
  let wMinZ = Infinity
  let wMaxX = -Infinity
  let wMaxY = -Infinity
  let wMaxZ = -Infinity
  for (const m of meshes) {
    if (!m.bbox) continue
    const [lx0, ly0, lz0, lx1, ly1, lz1] = m.bbox
    for (const modelId of geoToModels.get(m.id) ?? []) {
      const { t, s } = accumulate(modelId, 0)
      const xs = [lx0 * s[0] + t[0], lx1 * s[0] + t[0]]
      const ys = [ly0 * s[1] + t[1], ly1 * s[1] + t[1]]
      const zs = [lz0 * s[2] + t[2], lz1 * s[2] + t[2]]
      for (const v of xs) {
        if (v < wMinX) wMinX = v
        if (v > wMaxX) wMaxX = v
      }
      for (const v of ys) {
        if (v < wMinY) wMinY = v
        if (v > wMaxY) wMaxY = v
      }
      for (const v of zs) {
        if (v < wMinZ) wMinZ = v
        if (v > wMaxZ) wMaxZ = v
      }
    }
  }

  const totals = meshes.reduce(
    (a, m) => ({
      meshCount: a.meshCount + 1,
      fbxVertices: a.fbxVertices + m.vertices,
      polygons: a.polygons + m.polygons,
      triangles: a.triangles + m.triangles,
      corners: a.corners,
      weldedVertices: a.weldedVertices + m.weldedVertices,
      weldedNoUv: a.weldedNoUv + m.weldedNoUv,
      meshesWithUv: a.meshesWithUv + (m.hasUv ? 1 : 0),
      primitives: a.primitives + m.materialSlots,
    }),
    { meshCount: 0, fbxVertices: 0, polygons: 0, triangles: 0, corners, weldedVertices: 0, weldedNoUv: 0, meshesWithUv: 0, primitives: 0 },
  )

  let duplicateGeometries = 0
  let duplicateBytes = 0
  for (const v of geoHashes.values()) {
    if (v.count > 1) {
      duplicateGeometries += v.count - 1
      duplicateBytes += Math.round((v.bytes / v.count) * (v.count - 1))
    }
  }

  // ── 머티리얼 · 텍스처 ──────────────────────────────────────
  const materials = objChildren
    .filter((c) => c.name === 'Material')
    .map((m) => propString(m, 1).split('::')[0] || '(무명)')

  const textureRefs = objChildren
    .filter((c) => c.name === 'Texture')
    .map((t) => ({
      node: propString(t, 1).split('::')[0] || '(무명)',
      filename: firstString(childNamed(t, 'FileName')) ?? '',
      relative: firstString(childNamed(t, 'RelativeFilename')) ?? '',
    }))

  const embedded: Report['embedded'] = []
  let embeddedTextureBytes = 0
  for (const v of objChildren.filter((c) => c.name === 'Video')) {
    const content = firstArrayFreeRaw(childNamed(v, 'Content'))
    const node = propString(v, 1).split('::')[0] || '(무명)'
    const relativeFilename = firstString(childNamed(v, 'RelativeFilename')) ?? ''
    if (content && content.byteLength > 0) {
      embeddedTextureBytes += content.byteLength
      embedded.push({ node, relativeFilename, bytes: content.byteLength, signature: imageSignature(buf, content.dataOffset, content.byteLength) })
    } else {
      embedded.push({ node, relativeFilename, bytes: 0, signature: '(임베드 없음 — 외부 참조)' })
    }
  }

  // ── 애니메이션 · 리깅 ──────────────────────────────────────
  let curveKeyBytes = 0
  for (const c of objChildren.filter((n) => n.name === 'AnimationCurve')) {
    walk([c], (n) => {
      for (const p of n.props) if (p.kind === 'array') curveKeyBytes += p.compressedBytes
    })
  }
  const countOf = (n: string): number => objChildren.filter((c) => c.name === n).length
  const deformers = objChildren.filter((c) => c.name === 'Deformer')
  const skins = deformers.filter((d) => propString(d, 2) === 'Skin').length

  // ── 배열 페이로드 총계 ─────────────────────────────────────
  let arrCount = 0
  let arrCompressed = 0
  let arrDecoded = 0
  let deflated = 0
  let stored = 0
  const unknownEncodings = new Set<number>()
  walk(roots, (n) => {
    for (const p of n.props) {
      if (p.kind !== 'array') continue
      arrCount += 1
      arrCompressed += p.compressedBytes
      arrDecoded += decodedByteLength(p)
      if (p.encoding === 1) deflated += 1
      else if (p.encoding === 0) stored += 1
      else unknownEncodings.add(p.encoding)
    }
  })
  for (const e of unknownEncodings) {
    warnings.push({ offset: 0, message: `알 수 없는 array encoding ${e} — 해당 배열의 실제 크기를 읽지 못했습니다` })
  }

  // ── GLB 추정 (실측 welded 정점 기준) ───────────────────────
  const anyUv = totals.meshesWithUv > 0
  const perVertexF32 = 12 + 12 + (anyUv ? 8 : 0)
  // KHR_mesh_quantization: POSITION i16x3(+2 pad), NORMAL i8x4, TEXCOORD u16x2
  const perVertexQ = 8 + 4 + (anyUv ? 4 : 0)
  let indexBytes = 0
  for (const m of meshes) indexBytes += m.triangles * 3 * (m.weldedVertices < 65536 ? 2 : 4)
  const glbEstimate = {
    f32Bytes: totals.weldedVertices * perVertexF32 + indexBytes,
    quantizedBytes: totals.weldedVertices * perVertexQ + indexBytes,
    indexBytes,
    perVertexBytesF32: perVertexF32,
    perVertexBytesQuantized: perVertexQ,
  }

  return {
    file: { path: filePath, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex').slice(0, 16) },
    header: { version, wideOffsets: wide },
    globals,
    topLevel,
    objectTypes: [...objectTypeMap.entries()].map(([name, v]) => ({ name, count: v.count, bytes: v.bytes })).sort((a, b) => b.bytes - a.bytes),
    modelSubtypes: [...modelSubtypeMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    nodeNames,
    connections: {
      total: connTotal,
      edges: [...edgeMap.entries()].map(([edge, count]) => ({ edge, count })).sort((a, b) => b.count - a.count),
      meshInstances,
    },
    meshes: meshes.sort((a, b) => b.triangles - a.triangles),
    totals,
    duplicates: { uniqueGeometries: geoHashes.size, duplicateGeometries, duplicateBytes },
    bbox: Number.isFinite(gMinX) ? { min: [gMinX, gMinY, gMinZ], max: [gMaxX, gMaxY, gMaxZ] } : null,
    worldBbox: Number.isFinite(wMinX) ? { min: [wMinX, wMinY, wMinZ], max: [wMaxX, wMaxY, wMaxZ] } : null,
    transforms: { rotatedModels, scaledModels, scaleValues },
    materials,
    textureRefs,
    embedded,
    animation: {
      stacks: countOf('AnimationStack'),
      layers: countOf('AnimationLayer'),
      curveNodes: countOf('AnimationCurveNode'),
      curves: countOf('AnimationCurve'),
      curveKeyBytes,
    },
    rigging: { skins, otherDeformers: deformers.length - skins, poses: countOf('Pose') },
    arrays: { count: arrCount, compressedBytes: arrCompressed, decodedBytes: arrDecoded, deflated, stored },
    budget: {
      geometryPayloadBytes,
      embeddedTextureBytes,
      animationPayloadBytes: curveKeyBytes,
      otherBytes: buf.length - geometryPayloadBytes - embeddedTextureBytes - curveKeyBytes,
    },
    glbEstimate,
    measured,
    warnings: warnings.map((w) => `@${w.offset}: ${w.message}`),
  }
}

/** `Content` 는 raw(`R`) property 다. 배열이 아니라 별도 헬퍼를 쓴다. */
function firstArrayFreeRaw(node: FbxNode | undefined): RawProp | undefined {
  if (!node) return undefined
  for (const p of node.props) if (p.kind === 'raw') return p
  return undefined
}

// ─────────────────────────────────────────────────────────────
// 출력
// ─────────────────────────────────────────────────────────────

const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(2)} MB`
const pct = (n: number, total: number): string => `${((n / total) * 100).toFixed(1)}%`
const int = (n: number): string => n.toLocaleString('en-US')
const AXIS = ['X', 'Y', 'Z']

function printReport(r: Report, top: number): void {
  const T = r.file.bytes
  const line = (s = ''): void => void process.stdout.write(`${s}\n`)

  line('━'.repeat(78))
  line(`FBX 실측  ${basename(r.file.path)}`)
  line('━'.repeat(78))
  line(`경로            ${r.file.path}`)
  line(`크기            ${int(T)} bytes (${mb(T)})`)
  line(`sha256(앞16)    ${r.file.sha256}`)
  line(`포맷            Kaydara FBX Binary v${r.header.version} (offset ${r.header.wideOffsets ? '64' : '32'}-bit)`)
  line(`Creator         ${r.globals.creator}`)
  const up = r.globals.upAxis
  line(`단위·축         UnitScaleFactor=${r.globals.unitScaleFactor ?? '?'} · UpAxis=${up === undefined ? '?' : (AXIS[up] ?? up)} · FrontAxis=${r.globals.frontAxis ?? '?'}`)

  line()
  line('── 최상위 섹션 ────────────────────────────────────────────────')
  for (const s of r.topLevel) line(`  ${s.name.padEnd(22)} ${mb(s.bytes).padStart(10)}  ${pct(s.bytes, T).padStart(7)}`)

  line()
  line('── Objects 내 노드 타입 ───────────────────────────────────────')
  for (const o of r.objectTypes) {
    line(`  ${o.name.padEnd(22)} ${String(o.count).padStart(6)}개  ${mb(o.bytes).padStart(10)}  ${pct(o.bytes, T).padStart(7)}`)
  }
  line(`  Model 하위 종류: ${r.modelSubtypes.map((m) => `${m.name} ${m.count}`).join(' · ')}`)
  line(`  Connections ${int(r.connections.total)}개 — ${r.connections.edges.slice(0, 6).map((e) => `${e.edge} ${e.count}`).join(' · ')}`)
  line(`  Geometry→Model 연결 ${int(r.connections.meshInstances)}개 = 씬에 배치된 메시 인스턴스 수`)

  line()
  line('── 노드 이름 (G11 부품 강조의 전제) ───────────────────────────')
  const nn = r.nodeNames
  line(`  Model ${int(nn.totalModels)}개 · 고유 이름 ${int(nn.uniqueNames)}개 · CAD 자동 생성 이름 ${int(nn.autoNamedModels)}개 (${pct(nn.autoNamedModels, nn.totalModels)})`)
  line(`  상위: ${nn.top.slice(0, 10).map((t) => `${t.name}×${t.count}`).join(' · ')}`)

  line()
  line(`── 메시 (삼각형 상위 ${top}개 / 전 ${r.totals.meshCount}개) ─────────────────────`)
  line(`  ${'이름'.padEnd(22)} ${'FBX정점'.padStart(10)} ${'삼각형'.padStart(10)} ${'welded정점'.padStart(11)} ${'ngon'.padStart(5)} ${'UV'.padStart(3)}`)
  for (const m of r.meshes.slice(0, top)) {
    line(`  ${m.name.slice(0, 22).padEnd(22)} ${int(m.vertices).padStart(10)} ${int(m.triangles).padStart(10)} ${int(m.weldedVertices).padStart(11)} ${String(m.ngonMax).padStart(5)} ${(m.hasUv ? 'Y' : '-').padStart(3)}`)
  }
  if (r.meshes.length > top) line(`  … 외 ${r.meshes.length - top}개`)
  line(`  ${'합계'.padEnd(22)} ${int(r.totals.fbxVertices).padStart(10)} ${int(r.totals.triangles).padStart(10)} ${int(r.totals.weldedVertices).padStart(11)}`)
  line(`  폴리곤 ${int(r.totals.polygons)} · corner ${int(r.totals.corners)} · UV 보유 메시 ${r.totals.meshesWithUv}/${r.totals.meshCount}`)
  line(`  glTF primitive ${int(r.totals.primitives)}개 × 인스턴스 ${int(r.connections.meshInstances)}배치 → 병합 전 draw call`)
  const mappings = new Map<string, number>()
  for (const m of r.meshes) mappings.set(m.normalMapping, (mappings.get(m.normalMapping) ?? 0) + 1)
  line(`  법선 매핑: ${[...mappings.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')}`)
  const matMappings = new Map<string, number>()
  for (const m of r.meshes) matMappings.set(m.materialMapping, (matMappings.get(m.materialMapping) ?? 0) + 1)
  line(`  머티리얼 매핑: ${[...matMappings.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')}`)
  line(`  중복 지오메트리: 유일 ${int(r.duplicates.uniqueGeometries)}개 / 중복본 ${int(r.duplicates.duplicateGeometries)}개 (${mb(r.duplicates.duplicateBytes)} 상당)`)

  // 부품 크기별 삼각형 분포 — 웹 해상도에서 보이지도 않는 부품에 예산이 얼마나 쓰이는지.
  line()
  line('  부품 크기별 삼각형 배분 (대각선 길이 기준, 인스턴스 반영)')
  const buckets: { label: string; max: number }[] = [
    { label: '< 5 mm   (SMD·핀)', max: 5 },
    { label: '5–20 mm  (나사·너트)', max: 20 },
    { label: '20–100 mm', max: 100 },
    { label: '≥ 100 mm  (구조물)', max: Infinity },
  ]
  let renderedTotal = 0
  for (const m of r.meshes) renderedTotal += m.triangles * Math.max(1, m.instances)
  let lower = 0
  for (const b of buckets) {
    let tri = 0
    let parts = 0
    for (const m of r.meshes) {
      if (m.worldDiagonalMm >= lower && m.worldDiagonalMm < b.max) {
        tri += m.triangles * Math.max(1, m.instances)
        parts += Math.max(1, m.instances)
      }
    }
    line(`    ${b.label.padEnd(22)} 부품 ${String(parts).padStart(4)}개  삼각형 ${int(tri).padStart(9)}  ${pct(tri, renderedTotal).padStart(7)}`)
    lower = b.max
  }
  line(`    ${'렌더 삼각형 합계'.padEnd(22)} ${' '.repeat(10)}${int(renderedTotal).padStart(9)}  (지오메트리 고유 ${int(r.totals.triangles)} × 인스턴스)`)
  if (r.bbox) {
    const [x0, y0, z0] = r.bbox.min
    const [x1, y1, z1] = r.bbox.max
    line(`  로컬 bbox 합집합: X ${x0.toFixed(1)}~${x1.toFixed(1)} · Y ${y0.toFixed(1)}~${y1.toFixed(1)} · Z ${z0.toFixed(1)}~${z1.toFixed(1)} (Model 변환 미적용)`)
  }
  if (r.worldBbox) {
    const [x0, y0, z0] = r.worldBbox.min
    const [x1, y1, z1] = r.worldBbox.max
    // UnitScaleFactor 는 "1 unit = N cm". 실물 치수로 환산해 스케일 감을 잡는다.
    const u = r.globals.unitScaleFactor ?? 1
    const dim = (a: number, b: number): string => `${(b - a).toFixed(1)}u (${(((b - a) * u) / 100).toFixed(3)}m)`
    line(`  월드 bbox(TRS 중 이동·스케일 합성, 회전 무시): X ${x0.toFixed(1)}~${x1.toFixed(1)} · Y ${y0.toFixed(1)}~${y1.toFixed(1)} · Z ${z0.toFixed(1)}~${z1.toFixed(1)}`)
    line(`  치수 ${dim(x0, x1)} × ${dim(y0, y1)} × ${dim(z0, z1)}   (UnitScaleFactor=${u} → 1 unit = ${u} cm)`)
    line(`  회전 있는 Model ${r.transforms.rotatedModels}개 → 회전을 무시했으므로 위 치수는 하한`)
    line(`  Lcl Scaling 분포: ${r.transforms.scaleValues.slice(0, 4).map((s) => `[${s.value}] ×${s.count}`).join(' · ')}`)
  }

  line()
  line('── 머티리얼 · 텍스처 ──────────────────────────────────────────')
  line(`  Material ${r.materials.length}개: ${r.materials.slice(0, 10).join(', ')}${r.materials.length > 10 ? ' …' : ''}`)
  line(`  Texture 노드 ${r.textureRefs.length}개`)
  for (const t of r.textureRefs.slice(0, 20)) line(`    - ${t.node}  ← ${t.relative || t.filename || '(경로 없음)'}`)
  line(`  Video(이미지 컨테이너) ${r.embedded.length}개`)
  for (const e of r.embedded.slice(0, 20)) line(`    - ${e.node.padEnd(24)} ${mb(e.bytes).padStart(10)}  ${e.signature}  ${e.relativeFilename}`)
  if (r.embedded.length === 0 && r.textureRefs.length === 0) line('    (텍스처가 전혀 없습니다 — 머티리얼은 색상값만 가진 CAD appearance 입니다)')

  line()
  line('── 애니메이션 · 리깅 ──────────────────────────────────────────')
  line(`  AnimationStack ${r.animation.stacks} / Layer ${r.animation.layers} / CurveNode ${r.animation.curveNodes} / Curve ${r.animation.curves} (키 ${mb(r.animation.curveKeyBytes)})`)
  line(`  Skin ${r.rigging.skins} / 기타 Deformer ${r.rigging.otherDeformers} / Pose ${r.rigging.poses}`)

  line()
  line('── 배열 페이로드 ──────────────────────────────────────────────')
  line(`  배열 ${int(r.arrays.count)}개 — 파일 내 ${mb(r.arrays.compressedBytes)} (${pct(r.arrays.compressedBytes, T)}), 압축 해제 ${mb(r.arrays.decodedBytes)}`)
  line(`  deflate ${int(r.arrays.deflated)}개 / 무압축 ${int(r.arrays.stored)}개`)

  line()
  line('── 16MB 의 내역 ───────────────────────────────────────────────')
  const b = r.budget
  line(`  지오메트리 배열     ${mb(b.geometryPayloadBytes).padStart(10)}  ${pct(b.geometryPayloadBytes, T).padStart(7)}`)
  line(`  임베드 텍스처       ${mb(b.embeddedTextureBytes).padStart(10)}  ${pct(b.embeddedTextureBytes, T).padStart(7)}`)
  line(`  애니메이션 커브     ${mb(b.animationPayloadBytes).padStart(10)}  ${pct(b.animationPayloadBytes, T).padStart(7)}`)
  line(`  그 외(구조·문자열)  ${mb(b.otherBytes).padStart(10)}  ${pct(b.otherBytes, T).padStart(7)}`)

  line()
  line('── GLB 크기 (실측 welded 정점 기준, 추정 아님) ────────────────')
  const g = r.glbEstimate
  line(`  welded 정점 ${int(r.totals.weldedVertices)} · 삼각형 ${int(r.totals.triangles)} · 인덱스 ${mb(g.indexBytes)}`)
  line(`  f32 무압축 버퍼 (${g.perVertexBytesF32}B/정점)          ${mb(g.f32Bytes).padStart(10)}`)
  line(`  quantized 버퍼 (${g.perVertexBytesQuantized}B/정점)             ${mb(g.quantizedBytes).padStart(10)}`)
  line(`  ※ 위 수치에 JSON·노드 트리(메시 ${r.totals.meshCount}개분)는 미포함`)
  // 텍스처가 0개면 UV 는 아무 데도 쓰이지 않는다 → 버리면 정점 수와 정점당 바이트가 함께 줄어든다.
  if (r.textureRefs.length === 0) {
    const noUvBin = r.totals.weldedNoUv * 12 + g.indexBytes
    line(`  UV 제거 시: 정점 ${int(r.totals.weldedVertices)} → ${int(r.totals.weldedNoUv)} (${pct(r.totals.weldedNoUv, r.totals.weldedVertices)}), BIN ${mb(g.quantizedBytes)} → ${mb(noUvBin)}`)
  }

  line()
  line('── 압축 실측 (양자화 BIN 청크를 실제로 압축한 결과) ───────────')
  const q = r.measured
  const row = (label: string, raw: number, comp: number): void =>
    line(`  ${label.padEnd(18)} ${mb(raw).padStart(10)} → ${mb(comp).padStart(10)}  (${(raw / comp).toFixed(1)}x)`)
  row('POSITION i16x3', q.attr.pos, q.attrGzip.pos)
  row('NORMAL i8x3', q.attr.nrm, q.attrGzip.nrm)
  row('TEXCOORD u16x2', q.attr.uv, q.attrGzip.uv)
  row('indices u16', q.attr.idx, q.attrGzip.idx)
  line(`  ${'BIN 전체 gzip-9'.padEnd(18)} ${mb(q.binBytes).padStart(10)} → ${mb(q.gzipBytes).padStart(10)}  (${(q.binBytes / q.gzipBytes).toFixed(1)}x)`)
  line(`  ${`BIN 전체 brotli-${q.brotliQuality}`.padEnd(18)} ${mb(q.binBytes).padStart(10)} → ${mb(q.brotliBytes).padStart(10)}  (${(q.binBytes / q.brotliBytes).toFixed(1)}x)`)
  line('  ※ meshopt/Draco 인코딩을 거치지 않은 값이다 → 실제 결과의 보수적 상한')
  line(`  ※ 위 BIN 은 패딩 없는 구성. glTF accessor 는 4바이트 정렬이 필요해 실제로는 정점당 ${g.perVertexBytesQuantized}B(${mb(g.quantizedBytes)})가 되지만, 패딩 바이트는 압축에서 거의 사라진다`)

  line()
  if (r.warnings.length > 0) {
    line('── 읽지 못한 것 / 경고 ────────────────────────────────────────')
    for (const w of r.warnings.slice(0, 30)) line(`  ! ${w}`)
    if (r.warnings.length > 30) line(`  … 외 ${r.warnings.length - 30}건`)
  } else {
    line('읽지 못한 구간 없음 — 파일 끝까지 노드 트리가 정합합니다.')
  }
  line()
}

// ─────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const topIdx = args.indexOf('--top')
  const topArg = topIdx >= 0 ? args[topIdx + 1] : undefined
  const top = topArg !== undefined && /^\d+$/.test(topArg) ? Number(topArg) : 20
  const brIdx0 = args.indexOf('--brotli')
  // 플래그의 값 자리는 경로 후보에서 제외한다
  const valueSlots = new Set([topIdx + 1, brIdx0 + 1].filter((i) => i > 0))
  const pathArg = args.find((a, i) => !a.startsWith('--') && !valueSlots.has(i)) ?? 'public/assets/icx-2.fbx'
  const filePath = resolve(process.cwd(), pathArg)

  const size = statSync(filePath).size
  if (size > 512 * 1024 * 1024) throw new Error(`파일이 너무 큽니다 (${mb(size)}) — 메모리에 올리지 않습니다`)

  const brIdx = args.indexOf('--brotli')
  const brArg = brIdx >= 0 ? args[brIdx + 1] : undefined
  const brotliQuality = brArg !== undefined && /^\d+$/.test(brArg) ? Math.min(11, Number(brArg)) : 9

  const report = analyze(readFileSync(filePath), filePath, brotliQuality)
  if (asJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else printReport(report, top)
}

main()
