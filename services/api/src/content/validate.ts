import type { ContentEntity, ContentFields, ContentWrite, PostWrite, PostAttachment } from './types.js'

const own = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key))

const version = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const rocketId = /^[a-z0-9][a-z0-9-]{1,47}$/
const seriesId = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/
const postId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const keyShape = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/
const postVersion = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
export function validDisplayDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function validPostAttachments(value: unknown): value is PostAttachment[] {
  return Array.isArray(value) && value.length <= 20 && value.every(item => own(item) &&
    exactKeys(item, ['mediaId', 'kind', 'title']) && typeof item.mediaId === 'string' && uuid.test(item.mediaId) &&
    (item.kind === 'image' || item.kind === 'video' || item.kind === 'pdf') && typeof item.title === 'string' &&
    item.title.trim().length > 0 && item.title.length <= 300)
}

const settingKeys = new Set([
  'nav.about', 'nav.rocket', 'nav.posts', 'nav.member', 'hero.tagline',
  'about.slogan', 'about.body', 'vision.slogan', 'vision.body',
  'research.uav.title', 'research.uav.body', 'research.control.title',
  'research.control.body', 'research.rocketry.title', 'research.rocketry.body',
  'mission.body', 'mission.list_intro', 'mission.list', 'donate.intro',
  'donate.usage_title', 'donate.usage_list', 'donate.quote', 'donate.outro',
  'donate.cta_label', 'donation.goal', 'donation.current', 'donation.round_label',
  'contact.body', 'contact.email', 'contact.instagram', 'footer.copyright',
])

const requiredSettings = new Set([
  'nav.about', 'nav.rocket', 'nav.posts', 'nav.member', 'donation.goal',
  'donation.current', 'contact.email', 'footer.copyright',
])

type FieldRule = (value: unknown) => boolean
const text = (max: number, required = false): FieldRule => (value) =>
  typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0)
const optionalText = (max: number): FieldRule => (value) => value === null || text(max)(value)
const integer = (min: number, max: number): FieldRule => (value) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
const decimal = (max: number, positive = false): FieldRule => (value) =>
  value === null || (typeof value === 'string' && /^\d{1,7}(?:\.\d{1,3})?$/.test(value) &&
    Number(value) <= max && (!positive || Number(value) > 0))
const oneOf = (values: readonly string[]): FieldRule => (value) =>
  typeof value === 'string' && values.includes(value)
const mediaId: FieldRule = (value) => value === null || (typeof value === 'string' && uuid.test(value))
const bool: FieldRule = (value) => typeof value === 'boolean'

const rules: Record<ContentEntity, Readonly<Record<string, FieldRule>>> = {
  siteSetting: { value: optionalText(20_000) },
  mission: {
    title: text(200, true), launchDate: validDisplayDate,
    vehicleId: (value) => value === null || (typeof value === 'string' && rocketId.test(value)),
    location: text(200, true), outcome: oneOf(['success', 'partial', 'failure', 'planned']),
    summary: text(1000), bodyMd: text(100_000), coverMediaId: mediaId, published: bool,
  },
  rocket: {
    name: text(120, true), series: (v) => typeof v === 'string' && seriesId.test(v), descriptionMd: optionalText(20_000),
    coverMediaId: mediaId, maxAltitudeM: decimal(9_999_999.99),
    sizeM: decimal(9_999_999.999, true), payloadKg: decimal(9_999_999.999),
    published: bool, sortOrder: integer(0, 9999),
  },
  member: {
    name: text(120, true), role: optionalText(200), squad: optionalText(200),
    departmentId: mediaId,
    school: optionalText(200), bioMd: optionalText(20_000), imageMediaId: mediaId,
    published: bool, sortOrder: integer(0, 9999),
  },
  panel: {
    mediaId: (v) => typeof v === 'string' && uuid.test(v),
    headline: text(500, true), eyebrow: optionalText(200), body: optionalText(20_000),
    ctaLabel: optionalText(200), ctaHref: (v) => v === null || oneOf(['/vehicles', '/member', '/posts', '#support', '#contact'])(v),
    focalX: integer(0, 100), focalY: integer(0, 100),
    scrim: oneOf(['none', 'bottom', 'full', 'top']),
    anchor: oneOf(['bottom-left', 'bottom-center', 'center', 'top-left']),
    height: oneOf(['full', 'tall', 'half']), published: bool, sortOrder: integer(0, 9999),
  },
  department: { name: text(120, true), sortOrder: integer(0, 9999) },
  vehicleType: { label: text(120, true), sortOrder: integer(0, 9999) },
  rocketSeries: { label: text(120, true), typeId: (v) => typeof v === 'string' && seriesId.test(v),
    descriptionMd: optionalText(20_000), sortOrder: integer(0, 9999) },
}

const createRequired: Record<ContentEntity, readonly string[]> = {
  mission: ['title', 'launchDate', 'location', 'outcome', 'summary', 'bodyMd', 'published'],
  siteSetting: ['value'], rocket: ['name', 'series', 'published'],
  member: ['name', 'published'], panel: ['mediaId', 'headline', 'published'],
  department: ['name'], vehicleType: ['label'], rocketSeries: ['label', 'typeId'],
}

function validId(entity: ContentEntity, id: unknown): id is string {
  return typeof id === 'string' && (
    entity === 'siteSetting' ? settingKeys.has(id) :
    entity === 'rocket' ? rocketId.test(id) :
    entity === 'vehicleType' || entity === 'rocketSeries' ? seriesId.test(id) : uuid.test(id)
  )
}

function validFields(entity: ContentEntity, id: string, operation: 'create' | 'update', input: unknown): input is ContentFields {
  if (!own(input) || Object.keys(input).length === 0) return false
  const fieldRules = rules[entity]
  if (!Object.entries(input).every(([key, value]) => {
    const rule = fieldRules[key]
    return rule !== undefined && rule(value)
  })) return false
  if (operation === 'create' && !createRequired[entity].every((key) => Object.hasOwn(input, key))) return false
  if (entity === 'siteSetting') {
    const value = input.value
    if (requiredSettings.has(id) && (typeof value !== 'string' || !value.trim())) return false
    if ((id === 'donation.goal' || id === 'donation.current') &&
      (typeof value !== 'string' || !/^\d{1,15}$/.test(value))) return false
  }
  if (entity === 'mission') {
    if (input.published === true &&
        (typeof input.summary !== 'string' || !input.summary.trim() ||
         typeof input.bodyMd !== 'string' || !input.bodyMd.trim())) return false
    if (input.published !== false &&
        ((typeof input.summary === 'string' && !input.summary.trim()) ||
         (typeof input.bodyMd === 'string' && !input.bodyMd.trim()))) return false
  }
  if (entity === 'panel') {
    const hasLabel = Object.hasOwn(input, 'ctaLabel')
    const hasHref = Object.hasOwn(input, 'ctaHref')
    if (hasLabel !== hasHref) return false
    if (hasLabel && ((input.ctaLabel === null) !== (input.ctaHref === null))) return false
    if (hasLabel && typeof input.ctaLabel === 'string' && !input.ctaLabel.trim()) return false
  }
  return true
}

export function parseContentWrite(input: unknown): ContentWrite | null {
  if (!own(input)) return null
  const { operation, entity, id } = input
  if (operation !== 'create' && operation !== 'update' && operation !== 'delete') return null
  if (entity !== 'siteSetting' && entity !== 'rocket' && entity !== 'member' && entity !== 'panel' &&
      entity !== 'department' && entity !== 'mission' && entity !== 'vehicleType' && entity !== 'rocketSeries') return null
  if (!validId(entity, id)) return null
  if (operation === 'delete') {
    if (!exactKeys(input, ['operation', 'entity', 'id', 'version']) ||
      typeof input.version !== 'string' || !version.test(input.version) || entity === 'siteSetting') return null
    return { operation, entity, id, version: input.version }
  }
  if (!exactKeys(input, ['operation', 'entity', 'id', 'version', 'fields']) ||
    !validFields(entity, id, operation, input.fields)) return null
  if (operation === 'create') {
    if (Object.hasOwn(input, 'version')) return null
    return { operation, entity, id, fields: input.fields }
  }
  if (typeof input.version !== 'string' || !version.test(input.version)) return null
  return { operation, entity, id, version: input.version, fields: input.fields }
}

export function parsePostWrite(input: unknown): PostWrite | null {
  if (!own(input)) return null
  const { operation, id, version: expectedVersion, idempotencyKey } = input
  if (operation !== 'create' && operation !== 'update' && operation !== 'delete') return null
  if (typeof idempotencyKey !== 'string' || !keyShape.test(idempotencyKey)) return null
  if (operation !== 'create' && (typeof id !== 'string' || !postId.test(id) ||
    typeof expectedVersion !== 'string' || !postVersion.test(expectedVersion))) return null
  if (operation === 'delete') {
    if (!exactKeys(input, ['operation', 'id', 'version', 'idempotencyKey'])) return null
    return { operation, id: id as string, version: expectedVersion as string, idempotencyKey }
  }
  if (!exactKeys(input, ['operation', 'id', 'version', 'idempotencyKey', 'title', 'bodyMd', 'displayDate', 'attachments', 'published']) ||
    !text(300, true)(input.title) || !text(100_000)(input.bodyMd) || !validDisplayDate(input.displayDate) ||
    !validPostAttachments(input.attachments) || !bool(input.published)) return null
  if (operation === 'create') {
    if (Object.hasOwn(input, 'id') || Object.hasOwn(input, 'version')) return null
    return { operation, idempotencyKey, title: input.title as string, bodyMd: input.bodyMd as string,
      displayDate: input.displayDate, attachments: input.attachments, published: input.published as boolean }
  }
  return { operation, id: id as string, version: expectedVersion as string, idempotencyKey,
    title: input.title as string, bodyMd: input.bodyMd as string, displayDate: input.displayDate,
    attachments: input.attachments, published: input.published as boolean }
}
