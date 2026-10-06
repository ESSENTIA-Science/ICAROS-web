import type { Rocket, VehicleSpec } from './api/types'

export function getVehicleSpecs(vehicle: Pick<Rocket, 'specs' | 'maxAltitudeM' | 'sizeM' | 'payloadKg'>): VehicleSpec[] {
  if (vehicle.specs !== undefined) return vehicle.specs.map(item => ({ ...item }))
  return [
    { label: '최대 고도', value: vehicle.maxAltitudeM, unit: 'm' },
    { label: '전장', value: vehicle.sizeM, unit: 'm' },
    { label: '페이로드', value: vehicle.payloadKg, unit: 'kg' },
  ].filter(item => item.value !== '')
}
export function validVehicleSpecs(value: unknown): value is VehicleSpec[] {
  return Array.isArray(value) && value.length <= 6 && value.every(item =>
    !!item && typeof item === 'object' && Object.keys(item).length === 3 &&
    typeof item.label === 'string' && item.label.trim().length > 0 && item.label.length <= 80 &&
    typeof item.value === 'string' && item.value.trim().length > 0 && item.value.length <= 120 &&
    typeof item.unit === 'string' && item.unit.length <= 20)
}
