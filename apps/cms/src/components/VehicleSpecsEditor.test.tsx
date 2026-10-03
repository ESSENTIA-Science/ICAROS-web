import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import VehicleSpecsEditor from './VehicleSpecsEditor'
import { getVehicleSpecs, validVehicleSpecs } from '../lib/vehicleSpecs'

it('preserves explicit deletion of every legacy specification', () => {
  expect(getVehicleSpecs({ specs: [], maxAltitudeM: '100', sizeM: '1.3', payloadKg: '0.1' })).toEqual([])
  expect(getVehicleSpecs({ maxAltitudeM: '100', sizeM: '', payloadKg: '' })).toEqual([{ label: '최대 고도', value: '100', unit: 'm' }])
})
it('accepts six textual specifications and rejects incomplete or extra entries', () => {
  const specs = Array.from({ length: 6 }, (_, index) => ({ label: `특성 ${index + 1}`, value: '50~100', unit: '' }))
  expect(validVehicleSpecs(specs)).toBe(true)
  expect(validVehicleSpecs([...specs, specs[0]])).toBe(false)
  expect(validVehicleSpecs([{ label: '', value: '100', unit: 'm' }])).toBe(false)
})
it('shows editable labels, values and units, and disables adding a seventh property', () => {
  const specs = Array.from({ length: 6 }, (_, index) => ({ label: `특성 ${index + 1}`, value: '100', unit: 'm' }))
  const html = renderToStaticMarkup(<VehicleSpecsEditor specs={specs} onChange={() => {}} />)
  expect(html).toContain('제원 6 항목명')
  expect(html).toContain('제원 6 값')
  expect(html).toContain('제원 6 단위')
  expect(html).toContain('제원 6 삭제')
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>제원 추가<\/button>/)
})
