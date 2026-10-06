import { readFileSync, mkdirSync, writeFileSync, realpathSync, existsSync } from 'node:fs'
import { resolve, dirname, basename, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
const repository = realpathSync(resolve(here, '../..'))
const schema = JSON.parse(readFileSync(resolve(here, 'config.schema.json'), 'utf8'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const fail = message => { throw new Error(message) }

/** Implements the exact keyword subset used by config.schema.json. Errors never include values. */
export function validateConfig(value, rule = schema, path = '$') {
  for (const key of Object.keys(rule)) {
    if (!['$schema', '$id', 'type', 'const', 'properties', 'required', 'additionalProperties', 'pattern', 'minLength'].includes(key)) {
      fail(`Unsupported schema keyword at ${path}`)
    }
  }
  if (Object.hasOwn(rule, 'const') && value !== rule.const) fail(`Unexpected value at ${path}`)
  if (rule.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`Object required at ${path}`)
    for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) fail(`Missing ${path}.${key}`)
    for (const key of Object.keys(value)) {
      // Do not echo arbitrary user keys: an unknown key might contain a secret.
      if (!Object.hasOwn(rule.properties, key)) fail(`Unknown property at ${path}`)
      validateConfig(value[key], rule.properties[key], `${path}.${key}`)
    }
  }
  if (rule.type === 'string' && (typeof value !== 'string' ||
      value.length < (rule.minLength ?? 0) || (rule.pattern && !new RegExp(rule.pattern).test(value)))) fail(`Invalid string at ${path}`)
  if (rule.type === 'boolean' && typeof value !== 'boolean') fail(`Boolean required at ${path}`)
  if (path === '$') {
    const c = value
    if (c.network.proxyPrivateIpv4.split('.').length !== 4 || c.network.proxyPrivateIpv4.split('.').some(x => !/^\d{1,3}$/.test(x) || Number(x) > 255)) fail('Invalid proxy address')
    if (c.publicOrigin === c.adminOrigin) fail('Public and CMS origins must be distinct')
    const buckets = ['releaseBucket', 'privateMediaBucket', 'publicMediaBucket'].map(key => c.foundation[key])
    if (new Set(buckets).size !== 3) fail('Storage buckets must be distinct')
    if (c.network.azA === c.network.azB) fail('Two availability zones are required')
    const ranges = ['publicCidr', 'privateCidrA', 'privateCidrB'].map(key => cidr(c.network[key]))
    const vpc = cidr(c.network.vpcCidr)
    for (const range of ranges) if (range[0] < vpc[0] || range[1] > vpc[1]) fail('Subnet outside VPC range')
    for (let a = 0; a < ranges.length; a++) for (let b = a + 1; b < ranges.length; b++) {
      if (ranges[a][0] <= ranges[b][1] && ranges[b][0] <= ranges[a][1]) fail('Overlapping subnet ranges')
    }
    // Existing subnet overlap/IGW attachment/DNS/NACL/route verification is an external gate.
  }
  return value
}

function cidr(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(value)
  if (!match) fail('Invalid CIDR')
  const octets = match.slice(1, 5).map(Number), bits = Number(match[5])
  if (octets.some(x => x > 255) || bits < 16 || bits > 28) fail('Invalid CIDR range')
  const address = octets.reduce((sum, x) => sum * 256 + x, 0)
  const size = 2 ** (32 - bits)
  if (address % size !== 0) fail('CIDR must be network aligned')
  return [address, address + size - 1]
}

export function readiness(config) {
  return [...Object.entries(config.codeFixes).filter(([, v]) => !v).map(([k]) => `codeFixes.${k}`),
    ...Object.entries(config.gates).filter(([, v]) => !v).map(([k]) => `gates.${k}`),
    ...Object.entries(config.approvals).filter(([, v]) => !v).map(([k]) => `approvals.${k}`)]
}

export function parameterSets(c) {
  return {
    foundation: { WebRepository: c.webRepository, WebSourceRevision: c.webSourceRevision,
      PublicOrigin: c.publicOrigin, CmsOrigin: c.adminOrigin, ApiOriginHost: c.foundation.apiOriginHost,
      EnableDistributions: 'false', AttachDomains: 'false' },
    network: { VpcId: c.network.vpcId, InternetGatewayId: c.network.internetGatewayId,
      DbSecurityGroupId: c.network.dbSecurityGroupId, AvailabilityZoneA: c.network.azA,
      AvailabilityZoneB: c.network.azB, PublicCidr: c.network.publicCidr,
      PrivateCidrA: c.network.privateCidrA, PrivateCidrB: c.network.privateCidrB, ManageDbIngress: 'false', EgressMode: 'proxy', ProxyPrivateIpv4: c.network.proxyPrivateIpv4, ProxySecurityGroupId: c.network.proxySecurityGroupId, S3PrefixListId: c.network.s3PrefixListId, ManageProxyIngress: 'false' },
    runtime: { ReleaseBucketName: c.foundation.releaseBucket, PrivateMediaBucketName: c.foundation.privateMediaBucket,
      PublicMediaBucketName: c.foundation.publicMediaBucket, CodeBuildProject: c.foundation.buildProject,
      KvsArn: c.foundation.kvsArn, PublicMediaOrigin: c.publicMediaOrigin, AdminOrigin: c.adminOrigin,
      WebSourceRevision: c.webSourceRevision, DatabaseSecretArn: c.secrets.databaseArn,
      EssentiaSecretArn: c.secrets.essentiaArn, WorkerSecretArn: c.secrets.workerArn,
      EssentiaOrigin: c.essentiaOrigin, EssentiaCategory: c.essentiaCategory,
      EssentiaAuthorLabel: c.essentiaAuthorLabel, CognitoUserPoolId: c.cognito.userPoolId,
      CognitoClientId: c.cognito.clientId, CognitoDomain: c.cognito.domain, CognitoAdminGroup: c.cognito.adminGroup,
      ArtifactBucket: c.artifacts.bucket, ApiArtifactKey: c.artifacts.apiKey,
      ApiArtifactVersion: c.artifacts.apiVersion, MediaProxyArtifactKey: c.artifacts.proxyKey,
      MediaProxyArtifactVersion: c.artifacts.proxyVersion,
      PrivateSubnets: `${c.foundation.privateSubnetA},${c.foundation.privateSubnetB}`,
      LambdaSecurityGroupId: c.foundation.lambdaSecurityGroupId,
      HttpProxyUrl: `http://${c.network.proxyPrivateIpv4}:3128`, EnableBuildEvents: 'false', CompatibilityReviewed: 'false' },
  }
}

function outsideRepository(path) {
  // Resolve existing ancestors, so a symlink cannot redirect sensitive files into Git.
  let ancestor = resolve(path), suffix = []
  while (!existsSync(ancestor)) { suffix.unshift(basename(ancestor)); ancestor = dirname(ancestor) }
  const target = resolve(realpathSync(ancestor), ...suffix)
  const rel = relative(repository, target)
  if (rel === '' || (!(rel === '..' || rel.startsWith(`..${sep}`)) && !isAbsolute(rel))) fail('Private review output must be outside the repository')
  return target
}

function main() {
  const [mode, configPath, output] = process.argv.slice(2)
  if (!['check', 'render'].includes(mode) || !configPath || (mode === 'render' && !output) || process.argv.length > 5) {
    fail('Usage: node infra/aws/review.mjs check CONFIG | render CONFIG PRIVATE_OUTPUT_DIRECTORY')
  }
  const config = validateConfig(JSON.parse(readFileSync(configPath, 'utf8')))
  const blockers = readiness(config)
  console.log(JSON.stringify({ configurationValid: true, mutationExecuted: false, approvalRecord: 'APPROVALS.md',
    productionReady: false, blockers, note: 'Offline review only. Booleans record evidence; they do not authorize AWS mutations.' }))
  if (mode === 'check') return
  if (resolve(configPath) !== resolve(here, 'config.example.json')) outsideRepository(configPath)
  const target = outsideRepository(output)
  if (existsSync(target)) fail('Output directory must be new; existing review artifacts are never overwritten')
  mkdirSync(target, { recursive: true, mode: 0o700 })
  const hashes = {}
  for (const [key, parameters] of Object.entries(parameterSets(config))) {
    const file = key === 'runtime' ? 'runtime.blocked.template.json' : `${key}.template.json`
    const bytes = readFileSync(resolve(here, file))
    writeFileSync(resolve(target, file), bytes, { mode: 0o600, flag: 'wx' })
    writeFileSync(resolve(target, `${key}.parameters.json`), JSON.stringify(Object.entries(parameters).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })), null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    hashes[file] = hash(bytes)
  }
  writeFileSync(resolve(target, 'review.json'), JSON.stringify({ templateHashes: hashes, blockers,
    mode: 'REVIEW_ONLY', profile: 'essentia', runtimeBlocked: true,
    excluded: ['secret values', 'deployment execution', 'domain cutover', 'KVS initialization'] }, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  console.log('Private review bundle written. No AWS command was executed.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) {
    // Parse/filesystem errors may contain identifiers or raw JSON; print only our fixed validation errors.
    const safe = error instanceof Error && /^(Unsupported schema|Unexpected value|Object required|Missing \$|Unknown property|Invalid string|Invalid proxy|Boolean required|Storage buckets|Public and CMS|Two availability|Subnet outside|Overlapping subnet|Invalid CIDR|CIDR must|Private review|Output directory|Usage:)/.test(error.message)
    console.error(safe ? error.message : 'Review failed; inspect configuration privately.')
    process.exitCode = 1
  }
}
