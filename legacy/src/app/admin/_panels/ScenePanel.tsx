import Link from 'next/link'
import DeleteConfirm from '@/components/admin/DeleteConfirm'
import Notice from '@/components/admin/Notice'
import ui from '@/components/admin/ui.module.css'
import HomeFeatureForm from '@/components/admin/scene/HomeFeatureForm'
import ModelForm, { type ModelFormValues } from '@/components/admin/scene/ModelForm'
import type { ExtraInit } from '@/components/admin/scene/ExtrasEditor'
import type { HotspotInit } from '@/components/admin/scene/HotspotEditor'
import type { PresetInit } from '@/components/admin/scene/PresetEditor'
import { sceneHref } from '@/components/admin/scene/href'
import type { CameraPreset, SceneExtras, SceneJsonLoad } from '@/components/admin/scene/validation'
import css from '@/components/admin/scene/scene.module.css'
import { deleteSceneModelAction } from '../_actions/scene'
import {
  getHomeFeature,
  getSceneModel,
  listModelOptions,
  listRocketOptions,
  listSceneModels,
  type AdminMediaRef,
  type AdminModelDetail,
} from '../_data/scene'

const LIST_HREF = sceneHref()

/** DB 기본값과 같은 값. 새 모델 폼이 "이미 저장된 것과 같은 상태"에서 시작해야 저장 결과가 예측 가능하다. */
const CREATE_DEFAULTS: ModelFormValues = {
  id: '',
  label: '',
  rocketId: '',
  glbMediaId: '',
  posterMediaId: '',
  scale: '1',
  positionX: '0',
  positionY: '0',
  positionZ: '0',
  rotationX: '0',
  rotationY: '0',
  rotationZ: '0',
  cameraX: '0',
  cameraY: '0',
  cameraZ: '5',
  targetX: '0',
  targetY: '0',
  targetZ: '0',
  fov: '45',
  environment: 'studio',
  exposure: '1',
  ambientIntensity: '1',
  keyIntensity: '1',
  autoRotate: false,
  animationClip: '',
  enabledDesktop: true,
  enabledMobile: false,
  presets: [],
  extras: [],
  hotspots: [],
}

function toPresetInits(load: SceneJsonLoad<CameraPreset[]>): PresetInit[] {
  if (!load.ok) return []
  return load.value.map((p) => ({
    at: String(p.at),
    cx: String(p.camera.x),
    cy: String(p.camera.y),
    cz: String(p.camera.z),
    tx: String(p.target.x),
    ty: String(p.target.y),
    tz: String(p.target.z),
    fov: p.fov === undefined ? '' : String(p.fov),
  }))
}

function toExtraInits(load: SceneJsonLoad<SceneExtras>): ExtraInit[] {
  if (!load.ok) return []
  return Object.entries(load.value).map(([key, value]) => {
    if (typeof value === 'number') return { key, type: 'number' as const, value: String(value) }
    if (typeof value === 'boolean') return { key, type: 'boolean' as const, value: value ? 'true' : 'false' }
    return { key, type: 'string' as const, value }
  })
}

function toHotspotInits(model: AdminModelDetail): HotspotInit[] {
  return model.hotspots.map((h) => ({
    title: h.title,
    bodyMd: h.bodyMd,
    x: h.x,
    y: h.y,
    z: h.z,
    highlightNode: h.highlightNode,
  }))
}

function toFormValues(model: AdminModelDetail): ModelFormValues {
  return {
    id: model.id,
    label: model.label,
    rocketId: model.rocketId,
    glbMediaId: model.glbMediaId,
    posterMediaId: model.posterMediaId,
    scale: model.scale,
    positionX: model.positionX,
    positionY: model.positionY,
    positionZ: model.positionZ,
    rotationX: model.rotationX,
    rotationY: model.rotationY,
    rotationZ: model.rotationZ,
    cameraX: model.cameraX,
    cameraY: model.cameraY,
    cameraZ: model.cameraZ,
    targetX: model.targetX,
    targetY: model.targetY,
    targetZ: model.targetZ,
    fov: model.fov,
    environment: model.environment,
    exposure: model.exposure,
    ambientIntensity: model.ambientIntensity,
    keyIntensity: model.keyIntensity,
    autoRotate: model.autoRotate,
    animationClip: model.animationClip,
    enabledDesktop: model.enabledDesktop,
    enabledMobile: model.enabledMobile,
    presets: toPresetInits(model.presets),
    extras: toExtraInits(model.extras),
    hotspots: toHotspotInits(model),
  }
}

function formatBytes(size: number | null): string {
  if (size === null) return '크기 미상'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(2)} MB`
}

/** 지정된 media id 의 실제 상태. 붙어 있는 값이 살아 있는 파일인지 화면에서 바로 보이게 한다. */
function MediaSummary({
  label,
  id,
  media,
}: {
  label: string
  id: string
  media: AdminMediaRef | null
}) {
  if (id === '') {
    return (
      <p className={css.mediaMeta}>
        <span>
          {label}: 지정 안 함
        </span>
      </p>
    )
  }
  if (!media) {
    return (
      <Notice tone="error">
        {label} 로 지정된 <span className={css.mediaKey}>{id}</span> 에 해당하는 파일이 없습니다.
        업로드 후 발급된 media id 로 바꿔 주세요.
      </Notice>
    )
  }
  return (
    <div className={css.mediaMeta}>
      <span className={css.mediaKey}>
        {label}: {media.id}
      </span>
      <span>
        {media.mime} · {formatBytes(media.size)} · 상태 {media.status}
        {media.originalFilename ? ` · ${media.originalFilename}` : ''}
        {media.deleted ? ' · 삭제됨' : ''}
      </span>
    </div>
  )
}

/**
 * 3D Scene 설정 패널 (F9 / G1~G14).
 *
 * **여기에 3D 뷰어는 없다** (F13). three/R3F 는 이 레포에 설치돼 있지 않고, 설치돼 있더라도
 * 관리 화면이 WebGL 을 요구하면 GPU 없는 장비에서 CMS 를 못 쓴다. 이 패널의 일은
 * 값을 **정확하게 저장**하고 **읽을 수 있게** 보여 주는 것까지다.
 */
export default async function ScenePanel({
  create,
  editId,
  deleteId,
  saved,
}: {
  create: boolean
  editId: string | undefined
  deleteId: string | undefined
  saved: string | undefined
}) {
  if (create) {
    const rockets = await listRocketOptions()
    return (
      <>
        <div className={ui.panelHead}>
          <h2 className={ui.panelTitle}>새 3D 모델</h2>
        </div>
        <div className={ui.card}>
          <ModelForm mode="create" cancelHref={LIST_HREF} rockets={rockets} values={CREATE_DEFAULTS} />
        </div>
      </>
    )
  }

  if (editId !== undefined) {
    const [model, rockets] = await Promise.all([getSceneModel(editId), listRocketOptions()])

    if (!model) {
      return (
        <>
          <Notice tone="error">
            해당 모델을 찾을 수 없습니다. 다른 곳에서 이미 삭제되었을 수 있습니다.
          </Notice>
          <Link className={ui.btn} href={LIST_HREF}>
            목록으로
          </Link>
        </>
      )
    }

    return (
      <>
        <div className={ui.panelHead}>
          <div>
            <h2 className={ui.panelTitle}>{model.label}</h2>
            <p className={ui.panelLede}>
              <span className={ui.mono}>{model.id}</span>
            </p>
          </div>
        </div>

        {!model.presets.ok ? (
          <Notice tone="error" title="저장된 카메라 프리셋을 읽지 못했습니다">
            <p>{model.presets.message}</p>
            <p>
              폼에는 빈 목록이 실려 있습니다. 이대로 저장하면 아래 원본이 지워지므로, 필요한 값은 먼저
              옮겨 적어 주세요.
            </p>
            <pre className={css.rawJson}>{model.presets.raw}</pre>
          </Notice>
        ) : null}

        {!model.extras.ok ? (
          <Notice tone="error" title="저장된 확장 값을 읽지 못했습니다">
            <p>{model.extras.message}</p>
            <pre className={css.rawJson}>{model.extras.raw}</pre>
          </Notice>
        ) : null}

        <div className={ui.card}>
          <h3 className={ui.cardTitle} lang="en">
            Assets
          </h3>
          <MediaSummary label="GLB" id={model.glbMediaId} media={model.glbMedia} />
          <MediaSummary label="포스터" id={model.posterMediaId} media={model.posterMedia} />
        </div>

        <div className={ui.card}>
          <ModelForm
            mode="edit"
            cancelHref={LIST_HREF}
            rockets={rockets}
            version={model.version}
            values={toFormValues(model)}
          />
        </div>
      </>
    )
  }

  const [models, rockets, modelOptions, feature] = await Promise.all([
    listSceneModels(),
    listRocketOptions(),
    listModelOptions(),
    getHomeFeature(),
  ])

  const target = deleteId !== undefined ? models.find((m) => m.id === deleteId) : undefined

  return (
    <>
      <div className={ui.panelHead}>
        <div>
          <h2 className={ui.panelTitle} lang="en">
            3D Scene
          </h2>
          <p className={ui.panelLede}>
            모델 파일과 카메라·조명 값을 저장합니다. 이 화면에는 3D 미리보기가 없습니다 — 값을 숫자로
            확인하고, 실제 렌더는 공개 페이지에서 봅니다.
          </p>
        </div>
        <Link className={`${ui.btn} ${ui.btnPrimary}`} href={sceneHref({ create: true })}>
          새 모델
        </Link>
      </div>

      {saved === 'deleted' ? <Notice tone="ok">모델을 삭제했습니다.</Notice> : null}
      {saved === 'home' ? <Notice tone="ok">홈 대표 지정을 저장했습니다.</Notice> : null}
      {saved === 'glb' ? (
        <Notice tone="warn" title="GLB 를 교체했습니다">
          카메라 위치·타깃·scale 은 예전 모델에 맞춰 둔 값 그대로입니다. 새 모델의 크기와 원점이 다르면
          화면 밖으로 나가거나 지나치게 작게 보일 수 있으니 공개 페이지에서 프레이밍을 확인해 주세요.
        </Notice>
      ) : null}
      {saved !== undefined && saved !== 'deleted' && saved !== 'home' && saved !== 'glb' ? (
        <Notice tone="ok">저장했습니다.</Notice>
      ) : null}

      {target ? (
        <DeleteConfirm
          action={deleteSceneModelAction}
          id={target.id}
          title={target.label}
          description="등록된 핫스팟도 함께 삭제되고, 홈 대표로 지정돼 있었다면 지정이 해제됩니다. 업로드된 GLB·포스터 파일 자체는 남습니다."
          cancelHref={LIST_HREF}
        />
      ) : null}

      {deleteId !== undefined && !target ? (
        <Notice tone="error">삭제하려는 모델을 찾을 수 없습니다.</Notice>
      ) : null}

      <div className={ui.card}>
        <h3 className={ui.cardTitle}>홈 대표 지정</h3>
        <p className={ui.hint}>홈 화면 히어로에 쓰이는 기체와 3D 모델입니다.</p>
        <HomeFeatureForm
          rockets={rockets.map((r) => ({ id: r.id, name: r.name }))}
          models={modelOptions}
          rocketId={feature.rocketId}
          modelId={feature.modelId}
          version={feature.version}
        />
      </div>

      <div className={ui.list}>
        {models.length === 0 ? (
          <p className={ui.empty}>등록된 3D 모델이 없습니다.</p>
        ) : (
          models.map((m) => (
            <div className={ui.row} key={m.id}>
              <div className={ui.rowMain}>
                <p className={ui.rowName}>
                  {m.label}
                  {m.isHomeFeature ? <span className={`${ui.badge} ${ui.badgeSeries}`}>홈 대표</span> : null}
                  <span className={m.enabledDesktop ? css.badgeOn : css.badgeOff3d} lang="en">
                    desktop {m.enabledDesktop ? 'on' : 'off'}
                  </span>
                  <span className={m.enabledMobile ? css.badgeOn : css.badgeOff3d} lang="en">
                    mobile {m.enabledMobile ? 'on' : 'off'}
                  </span>
                </p>
                <p className={ui.rowMeta}>
                  {m.rocketName ?? '연결 로켓 없음'} · GLB {m.hasGlb ? '있음' : '없음'} · 포스터{' '}
                  {m.hasPoster ? '있음' : '없음'} ·{' '}
                  {m.presetsBroken ? '프리셋 읽기 실패' : `프리셋 ${m.presetCount}`} · 핫스팟{' '}
                  {m.hotspotCount} · {m.environment}
                  {m.autoRotate ? ' · 자동 회전' : ''}
                </p>
              </div>
              <div className={ui.rowActions}>
                <Link className={`${ui.btn} ${ui.btnSmall}`} href={sceneHref({ edit: m.id })}>
                  편집
                </Link>
                <Link className={`${ui.btn} ${ui.btnSmall}`} href={sceneHref({ remove: m.id })}>
                  삭제
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  )
}
