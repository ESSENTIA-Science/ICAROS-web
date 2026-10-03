import { useState } from 'react'
import ResourceEditor from './ResourceEditor'

export default function VehicleCategoriesEditor() {
  const [typesRevision, setTypesRevision] = useState(0)
  return <div className="categorySections">
    <section aria-labelledby="vehicle-types-title">
      <h2 id="vehicle-types-title">기체 분류</h2>
      <ResourceEditor kind="vehicle-types" onChanged={() => setTypesRevision(previous => previous + 1)} />
    </section>
    <section aria-labelledby="vehicle-series-title">
      <h2 id="vehicle-series-title">시리즈</h2>
      <ResourceEditor kind="vehicle-series" optionsRevision={typesRevision} />
    </section>
  </div>
}
