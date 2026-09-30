import 'server-only'
import { getSnapshot } from '@/lib/content/snapshot'
import type { VehicleTaxonomy } from '@/components/rocket/series'
export type RocketEngineDto = { id: string; type: string; thrustN: string | null; burnTimeS: string | null; count: number; mode: string | null }
export type RocketListItem = { slug: string; name: string; series: string; seriesLabel: string; typeId: string | null; imageSrc: string | null; maxAltitudeM: string | null; sizeM: string | null; payloadKg: string | null }
export type RocketDetail = RocketListItem & { descriptionMd: string | null; engines: RocketEngineDto[]; gallery?: { src: string; alt: string; width: number; height: number }[]; model?: { src: string; posterSrc?: string | null } | null }
export const listVehicleTaxonomy = async (): Promise<VehicleTaxonomy> => getSnapshot().taxonomy
export const listRocketsBySeries = async (series: string): Promise<RocketListItem[]> => getSnapshot().vehicles.filter((vehicle) => vehicle.series === series)
export const getRocket = async (slug: string): Promise<RocketDetail | null> => getSnapshot().vehicles.find((vehicle) => vehicle.slug === slug) ?? null
