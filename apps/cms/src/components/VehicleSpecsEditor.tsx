import type { VehicleSpec } from '../lib/api/types'

export default function VehicleSpecsEditor({ specs, onChange, disabled = false }: {
  specs: VehicleSpec[]; onChange: (specs: VehicleSpec[]) => void; disabled?: boolean
}) {
  function change(index: number, field: keyof VehicleSpec, value: string) {
    onChange(specs.map((item, at) => at === index ? { ...item, [field]: value } : item))
  }
  return <section className="vehicleSpecsEditor" aria-label="기체 제원">
    <div className="cardHead"><h3>기체 제원</h3><span>{specs.length}/6</span></div>
    <p className="hint">항목명과 값은 자유롭게 입력할 수 있습니다. 단위는 생략할 수 있습니다.</p>
    {specs.map((item, index) => <div className="vehicleSpecFields" key={index}>
      <label>항목명<input aria-label={`제원 ${index + 1} 항목명`} maxLength={80} disabled={disabled} value={item.label} onChange={event => change(index, 'label', event.target.value)} /></label>
      <label>값<input aria-label={`제원 ${index + 1} 값`} maxLength={120} disabled={disabled} value={item.value} onChange={event => change(index, 'value', event.target.value)} /></label>
      <label>단위<input aria-label={`제원 ${index + 1} 단위`} maxLength={20} disabled={disabled} value={item.unit} onChange={event => change(index, 'unit', event.target.value)} /></label>
      <button type="button" disabled={disabled} aria-label={`제원 ${index + 1} 삭제`} onClick={() => onChange(specs.filter((_, at) => at !== index))}>삭제</button>
    </div>)}
    <button type="button" disabled={disabled || specs.length >= 6} onClick={() => onChange([...specs, { label: '', value: '', unit: '' }])}>제원 추가</button>
  </section>
}
