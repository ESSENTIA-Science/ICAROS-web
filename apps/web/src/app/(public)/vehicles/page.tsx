import type { Metadata } from 'next'
import { getSnapshot } from '@/lib/content/snapshot'
import VehiclesListing from './VehiclesListing'

export function generateMetadata(): Metadata {
  const { types, series } = getSnapshot().taxonomy
  const type = types[0]
  const selectedSeries = series.find((item) => item.typeId === type?.id)
  const label = type ? selectedSeries ? `${type.label} · ${selectedSeries.label}` : type.label : null
  return {
    title: label ? `Vehicles · ${label}` : 'Vehicles',
    description: label ? `ICAROS가 설계·제작한 ${label} 기체의 제원과 구성.` : 'ICAROS가 설계·제작한 기체.',
    alternates: { canonical: '/vehicles' },
  }
}

export default function VehiclesIndexPage() {
  const typeId = getSnapshot().taxonomy.types[0]?.id ?? null
  return <VehiclesListing typeId={typeId} seriesId={null} />
}
