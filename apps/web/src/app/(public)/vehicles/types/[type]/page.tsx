import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSnapshot } from '@/lib/content/snapshot'
import VehiclesListing from '../../VehiclesListing'
import { pageMetadata } from '@/lib/seo'

export const dynamicParams = false
export function generateStaticParams() {
  const types = getSnapshot().taxonomy.types
  return types.length ? types.map((type) => ({ type: type.id })) : [{ type: '__empty-type' }]
}
export async function generateMetadata({ params }: { params: Promise<{ type: string }> }): Promise<Metadata> {
  const { type } = await params
  const label = getSnapshot().taxonomy.types.find((item) => item.id === type)?.label ?? type
  return pageMetadata({ title: `Vehicles · ${label}`, description: `ICAROS가 설계·제작한 ${label} 기체의 제원과 구성.`, path: `/vehicles/types/${type}` })
}
export default async function VehicleTypePage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params
  if (!getSnapshot().taxonomy.types.some((item) => item.id === type)) notFound()
  return <VehiclesListing typeId={type} seriesId={null} />
}
