import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const template = JSON.parse(readFileSync(new URL('../foundation.template.json', import.meta.url), 'utf8'))
const resources = template.Resources

const policyConfig = name => {
  const policy = resources[name]
  assert.ok(policy, `${name} must exist`)
  assert.equal(policy.Type, 'AWS::CloudFront::ResponseHeadersPolicy')
  return policy.Properties.ResponseHeadersPolicyConfig
}
const defaultBehavior = name => resources[name].Properties.DistributionConfig.DefaultCacheBehavior

const expected = {
  WebSecurityHeadersPolicy: { frame: 'SAMEORIGIN', referrer: 'strict-origin-when-cross-origin', csp: "frame-ancestors 'self'" },
  CmsSecurityHeadersPolicy: { frame: 'DENY', referrer: 'same-origin', csp: "frame-ancestors 'none'" }
}

test('Web and CMS default behaviors reference their own security headers policy', () => {
  assert.deepEqual(defaultBehavior('WebDistribution').ResponseHeadersPolicyId, { Ref: 'WebSecurityHeadersPolicy' })
  assert.deepEqual(defaultBehavior('CmsDistribution').ResponseHeadersPolicyId, { Ref: 'CmsSecurityHeadersPolicy' })
})

test('media distribution keeps its CORS policy untouched', () => {
  assert.deepEqual(defaultBehavior('MediaDistribution').ResponseHeadersPolicyId, { Ref: 'PublicMediaCors' })
})

for (const [name, want] of Object.entries(expected)) {
  test(`${name} sets HSTS, nosniff, frame, referrer and frame-ancestors headers with override`, () => {
    const config = policyConfig(name)
    assert.deepEqual(config.Name, { 'Fn::Sub': `\${AWS::StackName}-${name === 'WebSecurityHeadersPolicy' ? 'web' : 'cms'}-security-headers` })
    const headers = config.SecurityHeadersConfig
    assert.deepEqual(headers.StrictTransportSecurity, { AccessControlMaxAgeSec: 31536000, IncludeSubdomains: true, Override: true })
    assert.deepEqual(headers.ContentTypeOptions, { Override: true })
    assert.deepEqual(headers.FrameOptions, { FrameOption: want.frame, Override: true })
    assert.deepEqual(headers.ReferrerPolicy, { ReferrerPolicy: want.referrer, Override: true })
    assert.deepEqual(headers.ContentSecurityPolicy, { ContentSecurityPolicy: want.csp, Override: true })
    assert.equal(config.CorsConfig, undefined)
  })
}

test('CMS cannot be framed by any origin', () => {
  const headers = policyConfig('CmsSecurityHeadersPolicy').SecurityHeadersConfig
  assert.equal(headers.FrameOptions.FrameOption, 'DENY')
  assert.equal(headers.ContentSecurityPolicy.ContentSecurityPolicy, "frame-ancestors 'none'")
})
