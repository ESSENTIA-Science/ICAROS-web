import type { ContentKind, ContentMap, Editable } from '../lib/api/types'

export default function Preview<K extends ContentKind>({ kind, draft }: { kind: K; draft: Editable<K> }) {
  if (kind === 'rockets') {
    const value = draft as Editable<'rockets'>
    return <div className="previewBody"><span className="eyebrow">VEHICLES / {value.series || 'SERIES'}</span><h3>{value.name || '기체 이름'}</h3><p className="previewStats">고도 {value.maxAltitudeM || '—'} m · 전장 {value.sizeM || '—'} m · 페이로드 {value.payloadKg || '—'} kg</p><p className="previewText">{value.descriptionMd || '설명을 입력하세요.'}</p></div>
  }
  if (kind === 'site') {
    const value = draft as Editable<'site'>
    return <div className="previewBody"><span className="eyebrow">ICAROS / SITE SETTING</span><h3>사이트 문구</h3><div className="previewRule"/><p className="previewText">{value.value || '설정 값을 입력하세요.'}</p></div>
  }
  const value = draft as Editable<'posts'>
  return <article className="previewBody"><span className="eyebrow">POSTS / {value.authorLabel || '작성자'}</span><p>{value.displayDate}</p><h3>{value.title || '글 제목'}</h3><p className="previewText">{value.bodyMd || '본문을 입력하세요.'}</p>{value.attachments.map((item, index) => <p key={`${item.mediaId}-${index}`}>{item.kind === 'pdf' ? 'PDF' : item.kind === 'video' ? '영상' : '이미지'} · {item.title}</p>)}</article>
}

export type AnyRecord = ContentMap[ContentKind]
