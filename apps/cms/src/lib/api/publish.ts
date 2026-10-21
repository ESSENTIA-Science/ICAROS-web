import type { ContentKind } from './types'
import type { ResourceKind } from '../resources'

export type PublishKind = ContentKind | Exclude<ResourceKind, 'vehicle-series' | 'post-attachments'> | 'rocket-series'
