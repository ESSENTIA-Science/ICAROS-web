import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSnapshot } from '@/lib/content/snapshot'
import VehiclesListing from '../../../VehiclesListing'

export const dynamicParams = false
export function generateStaticParams() {
  return getSnapshot().taxonomy.series.map((series) => ({ type: series.typeId, series: series.id }))
}
export async function generateMetadata({ params }: { params: Promise<{ type: string; series: string }> }): Promise<Metadata> {
  const { type, series } = await params
  const tax = getSnapshot().taxonomy
  const typeLabel = tax.types.find((item) => item.id === type)?.label ?? type
  const seriesLabel = tax.series.find((item) => item.id === series)?.label ?? series
  return {
    title: `Vehicles · ${typeLabel} · ${seriesLabel}`,
    description: `ICAROS가 설계·제작한 ${typeLabel} · ${seriesLabel} 기체의 제원과 구성.`,
    alternates: { canonical: `/vehicles/types/${type}/${series}` },
  }
}
export default async function VehicleSeriesPage({ params }: { params: Promise<{ type: string; series: string }> }) {
  const { type, series } = await params
  if (!getSnapshot().taxonomy.series.some((item) => item.typeId === type && item.id === series)) notFound()
  return <VehiclesListing typeId={type} seriesId={series} />
}
