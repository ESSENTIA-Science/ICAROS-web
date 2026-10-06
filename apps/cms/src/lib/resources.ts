export type ResourceKind = 'departments' | 'members' | 'vehicles' | 'vehicle-types' | 'vehicle-series' | 'panels' | 'donation-rounds' | 'post-attachments' | 'missions'
export type ResourceRecord = {
  id: string
  version: string
  name?: string
  title?: string
  departmentId?: string | null
  typeId?: string | null
  seriesId?: string | null
  vehicleId?: string | null
  postId?: string
  mediaId?: string
  imageMediaId?: string | null
  mediaKind?: 'image' | 'video' | 'pdf' | 'model'
  url?: string
  galleryMediaIds?: string[]
  modelMediaId?: string | null
  amount?: number
  goal?: number
  roundLabel?: string
  position?: number
  description?: string
  launchDate?: string
  location?: string
  outcome?: 'success' | 'partial' | 'failure' | 'planned'
  summary?: string
  bodyMd?: string
  ctaLabel?: string | null
  ctaHref?: string | null
  coverMediaId?: string | null
  published?: boolean
}
export const resourceLabels: Partial<Record<keyof ResourceRecord, string>> = {
  name: '이름', title: '제목', departmentId: '소속 부서', typeId: '기체 분류', seriesId: '시리즈',
  description: '설명 (Markdown)', position: '표시 순서', mediaId: '미디어', mediaKind: '미디어 종류',
  galleryMediaIds: '갤러리', modelMediaId: '3D 모델 (GLB)', amount: '현재 금액', goal: '목표 금액',
  roundLabel: '후원 차수', postId: '게시글', published: '공개',
  ctaLabel: '이동 버튼 문구', ctaHref: '이동할 페이지 링크',
}
export const resourceTabs: { id: ResourceKind; label: string; description: string }[] = [
  { id: 'departments', label: '부서', description: '부서와 인원 배정을 관리합니다.' },
  { id: 'members', label: '멤버', description: '멤버와 소속 부서를 편집합니다.' },
  { id: 'vehicles', label: '기체 관리', description: '로켓·위성·UAV의 정보와 사진·3D 모델을 편집합니다.' },
  { id: 'vehicle-types', label: '분류·시리즈 관리', description: '기체 분류와 각 분류의 시리즈를 관리합니다.' },
  { id: 'vehicle-series', label: '시리즈', description: '기체 시리즈를 관리합니다.' },
  { id: 'panels', label: '홈 패널', description: '홈 사진·영상 패널과 공개 순서를 관리합니다.' },
  { id: 'donation-rounds', label: '후원 현황', description: '현재 후원 차수·목표·모금액을 편집합니다.' },
  { id: 'missions', label: '미션', description: '발사 기록과 결과를 편집합니다.' },
]
export const fields: Partial<Record<ResourceKind, (keyof ResourceRecord)[]>> = {
  departments: ['name', 'position'],
  members: ['name', 'departmentId', 'imageMediaId', 'description', 'published'],
  vehicles: ['name', 'typeId', 'seriesId', 'description', 'galleryMediaIds', 'modelMediaId', 'position', 'published'],
  'vehicle-types': ['name', 'position'],
  'vehicle-series': ['name', 'typeId', 'description', 'position'],
  panels: ['title', 'mediaId', 'mediaKind', 'position', 'description', 'ctaLabel', 'ctaHref', 'published'],
  'donation-rounds': ['roundLabel', 'goal', 'amount'],
  'post-attachments': ['postId', 'title', 'mediaId', 'mediaKind', 'position'],
}
