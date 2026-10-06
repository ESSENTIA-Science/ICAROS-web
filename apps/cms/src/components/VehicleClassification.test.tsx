import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import VehicleClassification from './VehicleClassification'

const types = [{ id: 'rockets', version: 'v1', name: 'ROCKETS' }, { id: 'uavs', version: 'v1', name: 'UAVs' }]
const series = [{ id: 'A', version: 'v1', typeId: 'rockets', name: 'ICX' }, { id: 'uav', version: 'v1', typeId: 'uavs', name: 'UAV Series' }]
it('shows the current classification and only its matching series', () => {
  const html = renderToStaticMarkup(<VehicleClassification types={types} series={series} typeId="uavs" seriesId="uav" disabled={false} onTypeChange={() => {}} onSeriesChange={() => {}} />)
  expect(html).toContain('기체 분류')
  expect(html).toContain('value="uavs" selected=""')
  expect(html).toContain('value="uav" selected=""')
  expect(html).not.toContain('>ICX</option>')
})
it('explains why a classification without a series cannot be saved', () => {
  const html = renderToStaticMarkup(<VehicleClassification types={types} series={[]} typeId="uavs" seriesId="" disabled={false} onTypeChange={() => {}} onSeriesChange={() => {}} />)
  expect(html).toContain('시리즈가 없습니다')
  expect(html).toContain('disabled=""')
})
