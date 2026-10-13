import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const template = JSON.parse(readFileSync(new URL('./operational-signals.template.json', import.meta.url), 'utf8'))

test('operational alarms have valid references and do not deliver to an unverified recipient', () => {
  const names = new Set([...Object.keys(template.Parameters), ...Object.keys(template.Resources)])
  const inspect = value => {
    if (!value || typeof value !== 'object') return
    if (value.Ref) assert.ok(names.has(value.Ref), `Unbound reference ${value.Ref}`)
    for (const child of Object.values(value)) inspect(child)
  }
  inspect(template)
  for (const resource of Object.values(template.Resources)) {
    assert.equal(resource.Type, 'AWS::CloudWatch::Alarm')
    assert.equal(resource.Properties.AlarmActions, undefined)
    assert.equal(resource.Properties.OKActions, undefined)
  }
})

test('age heartbeat is opt-in and HTTP failures use HTTP API dimensions', () => {
  assert.equal(template.Parameters.EnableJobAge.Default, 'false')
  assert.equal(template.Resources.GJobAge.Condition, 'JobAgeEnabled')
  assert.equal(template.Resources.GJobAge.Properties.TreatMissingData, 'breaching')
  assert.deepEqual(template.Resources.Http5xx.Properties.Dimensions.map(row => row.Name), ['ApiId', 'Stage'])
  assert.equal(template.Resources.Http5xx.Properties.MetricName, '5xx')
})
