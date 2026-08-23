import 'server-only'

import { asc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '@/lib/db'
import {
  loadCameraPresets,
  loadSceneExtras,
  type SceneJsonLoad,
  type CameraPreset,
  type SceneExtras,
} from '@/components/admin/scene/validation'
import { versionExpr } from '../_lib/version'

/**
 * 3D Scene 설정 DAL (F9 / G1~G14).
 *
 * **뷰어가 아니라 설정 값을 다루는 계층이다** (F13) — three.js 도 GLB 파싱도 여기에 없다.
 * 대신 두 가지를 책임진다: ① numeric 컬럼의 문자열을 정밀도 손실 없이 폼까지 나르고,
 * ② jsonb 두 칸을 폼에 싣기 전에 스키마로 한 번 거른다.
 */

/**
 * pg 는 numeric 을 **문자열로** 준다(정밀도 보존). 절대 Number() 로 왕복시키지 않는다 —
 * `0.1 + 0.2` 부류의 오차가 저장할 때마다 누적되고, 사용자가 건드리지도 않은 값이 바뀐다.
 * 꼬리 0 만 깎는 것은 십진 표기상 완전히 무손실이라 표시용으로 안전하다.
 */
function trimNumeric(raw: string | null): string {
  if (raw == null) return ''
  const v = raw.trim()
  if (v === '' || !v.includes('.')) return v
  return v.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

export type AdminMediaRef = {
  id: string
  mime: string
  size: number | null
  status: string
  originalFilename: string | null
  /** soft delete 된 미디어를 가리키고 있으면 화면이 그 사실을 말해 줘야 한다. */
  deleted: boolean
}

export type AdminModelListItem = {
  id: string
  label: string
  rocketId: string | null
  rocketName: string | null
  hasGlb: boolean
  hasPoster: boolean
  environment: string
  autoRotate: boolean
  enabledDesktop: boolean
  enabledMobile: boolean
  presetCount: number
  presetsBroken: boolean
  hotspotCount: number
  isHomeFeature: boolean
}

export type AdminHotspotRow = {
  id: string
  title: string
  bodyMd: string
  x: string
  y: string
  z: string
  highlightNode: string
}

export type AdminModelDetail = {
  id: string
  label: string
  rocketId: string
  glbMediaId: string
  posterMediaId: string
  scale: string
  positionX: string
  positionY: string
  positionZ: string
  rotationX: string
  rotationY: string
  rotationZ: string
  cameraX: string
  cameraY: string
  cameraZ: string
  targetX: string
  targetY: string
  targetZ: string
  fov: string
  environment: string
  exposure: string
  ambientIntensity: string
  keyIntensity: string
  autoRotate: boolean
  animationClip: string
  enabledDesktop: boolean
  enabledMobile: boolean
  presets: SceneJsonLoad<CameraPreset[]>
  extras: SceneJsonLoad<SceneExtras>
  hotspots: readonly AdminHotspotRow[]
  glbMedia: AdminMediaRef | null
  posterMedia: AdminMediaRef | null
  /** 낙관적 잠금 토큰 (F12). */
  version: string
}

export type RocketOption = { id: string; name: string; series: string }
export type ModelOption = { id: string; label: string; rocketId: string | null }

export type AdminHomeFeature = {
  rocketId: string
  modelId: string
  /** 행이 아직 없으면 null — 호출부가 "생성" 과 "수정" 을 구분한다. */
  version: string | null
}

async function loadMediaRefs(ids: readonly string[]): Promise<Map<string, AdminMediaRef>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()

  const rows = await db
    .select({
      id: schema.media.id,
      mime: schema.media.mime,
      size: schema.media.size,
      status: schema.media.status,
      originalFilename: schema.media.originalFilename,
      deletedAt: schema.media.deletedAt,
    })
    .from(schema.media)
    .where(inArray(schema.media.id, unique))

  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        mime: r.mime,
        size: r.size,
        status: r.status,
        originalFilename: r.originalFilename,
        deleted: r.deletedAt !== null,
      },
    ])
  )
}

/**
 * 목록. 프리셋 개수는 `jsonb_array_length()` 대신 값을 그대로 읽어 JS 에서 센다 —
 * 배열이 아닌 값이 들어 있으면 SQL 함수는 그 자리에서 에러를 내지만, 여기서는
 * "깨진 프리셋"이라고 **화면에 표시**할 수 있어야 하기 때문이다.
 */
export async function listSceneModels(): Promise<AdminModelListItem[]> {
  const [rows, hotspotCounts, feature] = await Promise.all([
    db
      .select({
        id: schema.rocketModels.id,
        label: schema.rocketModels.label,
        rocketId: schema.rocketModels.rocketId,
        rocketName: schema.rockets.name,
        glbMediaId: schema.rocketModels.glbMediaId,
        posterMediaId: schema.rocketModels.posterMediaId,
        environment: schema.rocketModels.environment,
        autoRotate: schema.rocketModels.autoRotate,
        enabledDesktop: schema.rocketModels.enabledDesktop,
        enabledMobile: schema.rocketModels.enabledMobile,
        cameraPresets: schema.rocketModels.cameraPresets,
      })
      .from(schema.rocketModels)
      .leftJoin(schema.rockets, eq(schema.rocketModels.rocketId, schema.rockets.id))
      .orderBy(asc(schema.rocketModels.label), asc(schema.rocketModels.id)),
    db
      .select({ modelId: schema.rocketHotspots.modelId })
      .from(schema.rocketHotspots),
    getHomeFeature(),
  ])

  const hotspotsByModel = new Map<string, number>()
  for (const row of hotspotCounts) {
    hotspotsByModel.set(row.modelId, (hotspotsByModel.get(row.modelId) ?? 0) + 1)
  }

  return rows.map((r) => {
    const presets = loadCameraPresets(r.cameraPresets)
    return {
      id: r.id,
      label: r.label,
      rocketId: r.rocketId,
      rocketName: r.rocketName,
      hasGlb: r.glbMediaId !== null,
      hasPoster: r.posterMediaId !== null,
      environment: r.environment,
      autoRotate: r.autoRotate,
      enabledDesktop: r.enabledDesktop,
      enabledMobile: r.enabledMobile,
      presetCount: presets.ok ? presets.value.length : 0,
      presetsBroken: !presets.ok,
      hotspotCount: hotspotsByModel.get(r.id) ?? 0,
      isHomeFeature: feature.modelId === r.id,
    }
  })
}

export async function getSceneModel(id: string): Promise<AdminModelDetail | null> {
  const rows = await db
    .select({
      id: schema.rocketModels.id,
      label: schema.rocketModels.label,
      rocketId: schema.rocketModels.rocketId,
      glbMediaId: schema.rocketModels.glbMediaId,
      posterMediaId: schema.rocketModels.posterMediaId,
      scale: schema.rocketModels.scale,
      positionX: schema.rocketModels.positionX,
      positionY: schema.rocketModels.positionY,
      positionZ: schema.rocketModels.positionZ,
      rotationX: schema.rocketModels.rotationX,
      rotationY: schema.rocketModels.rotationY,
      rotationZ: schema.rocketModels.rotationZ,
      cameraX: schema.rocketModels.cameraX,
      cameraY: schema.rocketModels.cameraY,
      cameraZ: schema.rocketModels.cameraZ,
      targetX: schema.rocketModels.targetX,
      targetY: schema.rocketModels.targetY,
      targetZ: schema.rocketModels.targetZ,
      fov: schema.rocketModels.fov,
      environment: schema.rocketModels.environment,
      exposure: schema.rocketModels.exposure,
      ambientIntensity: schema.rocketModels.ambientIntensity,
      keyIntensity: schema.rocketModels.keyIntensity,
      autoRotate: schema.rocketModels.autoRotate,
      animationClip: schema.rocketModels.animationClip,
      enabledDesktop: schema.rocketModels.enabledDesktop,
      enabledMobile: schema.rocketModels.enabledMobile,
      cameraPresets: schema.rocketModels.cameraPresets,
      extras: schema.rocketModels.extras,
      version: versionExpr(schema.rocketModels.updatedAt),
    })
    .from(schema.rocketModels)
    .where(eq(schema.rocketModels.id, id))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  const [hotspots, mediaRefs] = await Promise.all([
    db
      .select({
        id: schema.rocketHotspots.id,
        title: schema.rocketHotspots.title,
        bodyMd: schema.rocketHotspots.bodyMd,
        x: schema.rocketHotspots.x,
        y: schema.rocketHotspots.y,
        z: schema.rocketHotspots.z,
        highlightNode: schema.rocketHotspots.highlightNode,
      })
      .from(schema.rocketHotspots)
      .where(eq(schema.rocketHotspots.modelId, id))
      .orderBy(asc(schema.rocketHotspots.sortOrder), asc(schema.rocketHotspots.id)),
    loadMediaRefs([row.glbMediaId, row.posterMediaId].filter((v): v is string => v !== null)),
  ])

  return {
    id: row.id,
    label: row.label,
    rocketId: row.rocketId ?? '',
    glbMediaId: row.glbMediaId ?? '',
    posterMediaId: row.posterMediaId ?? '',
    scale: trimNumeric(row.scale),
    positionX: trimNumeric(row.positionX),
    positionY: trimNumeric(row.positionY),
    positionZ: trimNumeric(row.positionZ),
    rotationX: trimNumeric(row.rotationX),
    rotationY: trimNumeric(row.rotationY),
    rotationZ: trimNumeric(row.rotationZ),
    cameraX: trimNumeric(row.cameraX),
    cameraY: trimNumeric(row.cameraY),
    cameraZ: trimNumeric(row.cameraZ),
    targetX: trimNumeric(row.targetX),
    targetY: trimNumeric(row.targetY),
    targetZ: trimNumeric(row.targetZ),
    fov: trimNumeric(row.fov),
    environment: row.environment,
    exposure: trimNumeric(row.exposure),
    ambientIntensity: trimNumeric(row.ambientIntensity),
    keyIntensity: trimNumeric(row.keyIntensity),
    autoRotate: row.autoRotate,
    animationClip: row.animationClip ?? '',
    enabledDesktop: row.enabledDesktop,
    enabledMobile: row.enabledMobile,
    presets: loadCameraPresets(row.cameraPresets),
    extras: loadSceneExtras(row.extras),
    hotspots: hotspots.map((h) => ({
      id: h.id,
      title: h.title,
      bodyMd: h.bodyMd ?? '',
      x: trimNumeric(h.x),
      y: trimNumeric(h.y),
      z: trimNumeric(h.z),
      highlightNode: h.highlightNode ?? '',
    })),
    glbMedia: row.glbMediaId !== null ? (mediaRefs.get(row.glbMediaId) ?? null) : null,
    posterMedia: row.posterMediaId !== null ? (mediaRefs.get(row.posterMediaId) ?? null) : null,
    version: row.version,
  }
}

/** 연결 대상 후보. 비공개 로켓도 넣는다 — 공개 전에 모델을 붙여 두는 순서가 정상이다. */
export async function listRocketOptions(): Promise<RocketOption[]> {
  return db
    .select({ id: schema.rockets.id, name: schema.rockets.name, series: schema.rockets.series })
    .from(schema.rockets)
    .orderBy(asc(schema.rockets.series), asc(schema.rockets.sortOrder), asc(schema.rockets.id))
}

export async function listModelOptions(): Promise<ModelOption[]> {
  return db
    .select({
      id: schema.rocketModels.id,
      label: schema.rocketModels.label,
      rocketId: schema.rocketModels.rocketId,
    })
    .from(schema.rocketModels)
    .orderBy(asc(schema.rocketModels.label), asc(schema.rocketModels.id))
}

/** 단일 행이라 "없음"도 정상 상태다. 없으면 빈 선택 + version null 을 돌려준다. */
export async function getHomeFeature(): Promise<AdminHomeFeature> {
  const rows = await db
    .select({
      rocketId: schema.homeFeature.rocketId,
      modelId: schema.homeFeature.modelId,
      version: versionExpr(schema.homeFeature.updatedAt),
    })
    .from(schema.homeFeature)
    .where(eq(schema.homeFeature.id, 'singleton'))
    .limit(1)

  const row = rows[0]
  if (!row) return { rocketId: '', modelId: '', version: null }
  return { rocketId: row.rocketId ?? '', modelId: row.modelId ?? '', version: row.version }
}
