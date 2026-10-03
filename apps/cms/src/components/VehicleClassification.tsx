import type { ResourceRecord } from '../lib/resources'

export default function VehicleClassification({ types, series, typeId, seriesId, disabled, onTypeChange, onSeriesChange }: {
  types: ResourceRecord[]; series: ResourceRecord[]; typeId: string; seriesId: string; disabled: boolean
  onTypeChange: (id: string) => void; onSeriesChange: (id: string) => void
}) {
  const available = series.filter(item => item.typeId === typeId)
  return <div className="fields">
    <label>기체 분류<select value={typeId} disabled={disabled || types.length === 0} onChange={event => onTypeChange(event.target.value)}>
      <option value="" disabled>선택하세요</option>
      {types.map(item => <option key={item.id} value={item.id}>{item.name ?? item.id}</option>)}
    </select></label>
    <label>시리즈<select value={seriesId} disabled={disabled || !typeId || available.length === 0} onChange={event => onSeriesChange(event.target.value)}>
      <option value="" disabled>선택하세요</option>
      {!available.some(item => item.id === seriesId) && seriesId && <option value={seriesId}>{seriesId}</option>}
      {available.map(item => <option key={item.id} value={item.id}>{item.name ?? item.id}</option>)}
    </select></label>
    {typeId && available.length === 0 && <p className="notice">이 분류에 시리즈가 없습니다. 분류·시리즈 관리에서 시리즈를 추가해야 자동 저장할 수 있습니다.</p>}
  </div>
}
