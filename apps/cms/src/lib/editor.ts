import type { ContentKind, ContentMap, Editable } from './api/types'
import { getVehicleSpecs } from './vehicleSpecs'

export function editable<K extends ContentKind>(kind: K, record: ContentMap[K]): Editable<K> {
  if (kind === 'rockets') {
    const rocket = record as ContentMap['rockets']
    return { name: rocket.name, series: rocket.series, descriptionMd: rocket.descriptionMd,
      maxAltitudeM: rocket.maxAltitudeM, sizeM: rocket.sizeM, payloadKg: rocket.payloadKg,
      coverMediaId: rocket.coverMediaId ?? null, published: rocket.published ?? true, specs: getVehicleSpecs(rocket) } as unknown as Editable<K>
  }
  if (kind === 'site') {
    const site = record as ContentMap['site']
    return { value: site.value } as unknown as Editable<K>
  }
  const post = record as ContentMap['posts']
  return { title: post.title, bodyMd: post.bodyMd, authorLabel: post.authorLabel, displayDate: post.displayDate, attachments: post.attachments.map(item => ({ ...item })) } as unknown as Editable<K>
}

export function isDirty<K extends ContentKind>(kind: K, record: ContentMap[K], draft: Editable<K>) {
  return JSON.stringify(editable(kind, record)) !== JSON.stringify(draft)
}

export function publicationLabel(state: ContentMap[ContentKind]['publishState']) {
  return ({ draft_saved: '초안 저장됨', publishing: '게시 중 · 빌드 완료 대기', published: '공개됨 · 빌드 완료', failed: '게시 실패' })[state]
}
