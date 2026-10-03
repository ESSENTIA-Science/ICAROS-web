import type { VehicleSpec } from '@icaros/contracts'
export type { VehicleSpec } from '@icaros/contracts'
export type VehicleSpecSource = {
  specs?: VehicleSpec[]
  maxAltitudeM: string | null
  sizeM: string | null
  payloadKg: string | null
}

/** An explicit empty list removes specs; only older snapshots use legacy fields. */
export function getVehicleSpecs(vehicle: VehicleSpecSource): { label: string; value: string | null; unit: string }[] {
  if (vehicle.specs !== undefined) return vehicle.specs
  return [
    { label: '최대 고도', value: vehicle.maxAltitudeM, unit: 'm' },
    { label: '전장', value: vehicle.sizeM, unit: 'm' },
    { label: '페이로드', value: vehicle.payloadKg, unit: 'kg' },
  ]
}

export function vehicleSpecFacts(vehicle: VehicleSpecSource): string[] {
  return getVehicleSpecs(vehicle)
    .filter((spec) => spec.value != null && spec.value !== '')
    .map((spec) => `${spec.label} ${spec.value}${spec.unit ? ` ${spec.unit}` : ''}`)
}
