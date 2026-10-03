import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import test from 'node:test'
import { renderConfig } from './render-config.mjs'

const input = {
  privateIpv4: '10.200.10.10', lambdaCidrs: ['10.200.241.0/24', '10.200.242.0/24'],
  hosts: { cognitoAuth: 'auth.example.invalid', cognitoJwks: 'jwks.example.invalid',
    essentia: 'essentia.example.invalid', codebuild: 'codebuild.example.invalid', kvs: 'kvs.example.invalid' },
}

// Evaluate the generated ACL subset, not a second copy of the renderer's policy.
// Requests here already have Squid-parsed host/port. Raw HTTP parser behavior is not modeled.
// Real Squid parsing is a separate no-listener deployment check; this is not a network test.
function evaluate(config, request) {
  const definitions = new Map([['all', () => true]])
  const ipv4 = value => value.split('.').reduce((n, part) => n * 256 + Number(part), 0)
  const inCidr = (value, cidr) => {
    const [network, prefix] = cidr.split('/')
    const block = 2 ** (32 - Number(prefix))
    return Math.floor(ipv4(value) / block) === Math.floor(ipv4(network) / block)
  }
  const match = name => name.startsWith('!') ? !match(name.slice(1)) : definitions.get(name)?.(request)
  for (const line of config.split('\n')) {
    const [directive, name, kind, ...args] = line.trim().split(/\s+/)
    if (directive === 'acl') {
      switch (kind) {
        case 'src': definitions.set(name, r => args.some(cidr => inCidr(r.source, cidr))); break
        case 'method': definitions.set(name, r => args.includes(r.method)); break
        case 'port': definitions.set(name, r => args.includes(String(r.port))); break
        case 'dstdomain': {
          assert.equal(args.shift(), '-n', 'host ACL must not reverse-resolve IP literals')
          definitions.set(name, r => args.some(host => host.startsWith('.')
            ? r.host === host.slice(1) || r.host.endsWith(host) : r.host.toLowerCase() === host))
          break
        }
        case 'url_regex': {
          assert.equal(args.shift(), '-i')
          const expression = new RegExp(args.join('|'), 'i')
          definitions.set(name, r => expression.test(`${r.host}:${r.port}`))
          break
        }
        case 'req_header': definitions.set(name, r => new RegExp(args[1]).test(r.headers?.[args[0].toLowerCase()] ?? '')); break
        case 'maxconn': definitions.set(name, r => (r.connections ?? 1) > Number(args[0])); break
        default: throw new Error(`Unhandled ACL type ${kind}`)
      }
    } else if (directive === 'http_access' && [kind, ...args].every(match)) {
      return name === 'allow'
    }
  }
  return false
}
const request = { source: '10.200.241.12', method: 'CONNECT', host: input.hosts.cognitoAuth, port: 443 }

test('generated policy allows only exact named CONNECT:443 destinations from Lambda CIDRs', () => {
  const { squidConfig } = renderConfig(input)
  for (const host of Object.values(input.hosts)) assert.equal(evaluate(squidConfig, { ...request, host }), true)
  assert.equal(evaluate(squidConfig, { ...request, source: '10.200.242.99' }), true)
  assert.equal(evaluate(squidConfig, { ...request, host: 'AUTH.EXAMPLE.INVALID' }), true)
  assert.match(squidConfig, /^http_port 10\.200\.10\.10:3128$/m)
  assert.equal(squidConfig.match(/^http_port /gm).length, 1)
})

for (const change of [
  { host: 'unknown.example.invalid' }, { host: 'sub.auth.example.invalid' }, { host: 'auth.example.invalid.attacker.invalid' },
  { host: '127.0.0.1' }, { host: '169.254.169.254' }, { host: '10.200.10.10' }, { host: '1.1.1.1' },
  { host: '[::1]' }, { host: '2130706433' }, { port: 80 }, { port: 3128 }, { port: 8443 },
  { method: 'GET' }, { method: 'POST' }, { method: 'HEAD' }, { method: 'OPTIONS' }, { method: 'TRACE' },
  { source: '10.200.10.12' }, { source: '198.51.100.10' }, { source: '127.0.0.1' },
  { connections: 17 },
  { headers: { 'proxy-authorization': 'Basic fake' } },
]) {
  test(`generated CONNECT policy denies ${JSON.stringify(change)}`, () => {
    assert.equal(evaluate(renderConfig(input).squidConfig, { ...request, ...change }), false)
  })
}

test('config rejects nonprivate addresses, CIDR expansion, and injectable/ambiguous hosts', () => {
  for (const privateIpv4 of ['0.0.0.0', '127.0.0.1', '169.254.169.254', '198.51.100.1', '::1', '010.0.0.1', '10.1.1.256'])
    assert.throws(() => renderConfig({ ...input, privateIpv4 }))
  for (const lambdaCidrs of [[], ['0.0.0.0/0'], ['10.0.0.0/8'], ['172.16.0.0/12'], ['10.200.241.12/24'], ['198.51.100.0/24'], ['::/0']])
    assert.throws(() => renderConfig({ ...input, lambdaCidrs }))
  for (const host of ['*.example.invalid', '.example.invalid', 'https://auth.example.invalid', 'auth.example.invalid:443',
    'auth.example.invalid/path', 'auth.example.invalid\nhttp_access allow all', 'user@auth.example.invalid',
    '1.1.1.1', '[::1]', '2130706433', 'auth.example.invalid.', 'auth.example.invalid#', 'auth example.invalid'])
    assert.throws(() => renderConfig({ ...input, hosts: { ...input.hosts, cognitoAuth: host } }))
  assert.throws(() => renderConfig({ ...input, hosts: { ...input.hosts, unknown: 'extra.example.invalid' } }))
  assert.throws(() => renderConfig({ ...input, extra: true }))
})

test('rendering is deterministic, does not mutate input, and carries no runtime secrets', () => {
  const frozen = Object.freeze({ ...input, lambdaCidrs: Object.freeze([...input.lambdaCidrs]), hosts: Object.freeze({ ...input.hosts }) })
  assert.deepEqual(renderConfig(frozen), renderConfig(input))
  const { squidConfig } = renderConfig(input)
  for (const directive of ['access_log none', 'cache_log /dev/null', 'cache_store_log none', 'cache deny all',
    'cache_mem 0 MB', 'pid_filename none', 'pinger_enable off', 'icp_port 0', 'htcp_port 0'])
    assert.ok(squidConfig.includes(`${directive}\n`), directive)
  assert.doesNotMatch(squidConfig, /^(?:include|cache_dir|ssl_bump|https_port|auth_param|cache_peer) /m)
  assert.ok(squidConfig.includes('http_access deny !tunnel'))
  assert.ok(squidConfig.includes('http_access allow lambda_sources tunnel tls_port allowed_hosts exact_authority'))
  assert.equal(squidConfig.trim().endsWith('http_access deny all'), true)
})

test('systemd Docker options bound resources and preserve original Lambda source IPs', () => {
  const { systemdUnit } = renderConfig(input)
  for (const option of ['--platform=linux/arm64', '--network=host', '--memory=128m', '--memory-swap=128m', '--cpus=0.25',
    '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--pids-limit=64', '--ulimit=nofile=256:256',
    '--restart=unless-stopped', '--log-driver=none', '--user=proxy', '--mount=type=bind,src=/etc/icaros-egress/squid.conf,dst=/etc/squid/squid.conf,readonly'])
    assert.ok(systemdUnit.includes(option), option)
  assert.doesNotMatch(systemdUnit, /--(?:privileged|publish|env|volume)=/)
  assert.ok(systemdUnit.includes('Type=oneshot'))
  assert.ok(systemdUnit.includes('RemainAfterExit=yes'))
})

test('container uses official bookworm slim, Debian Squid and a nonroot no-daemon entrypoint', () => {
  const dockerfile = readFileSync(new URL('./Dockerfile', import.meta.url), 'utf8')
  assert.match(dockerfile, /^FROM debian:bookworm-slim$/m)
  assert.match(dockerfile, /install -y --no-install-recommends squid/)
  assert.match(dockerfile, /^USER proxy$/m)
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/sbin\/squid", "-N", "-f", "\/etc\/squid\/squid.conf", "-d", "0"\]/)
  assert.match(dockerfile, /exit 101/)
})

test('valid private address families and real SDK endpoint shapes remain accepted', () => {
  for (const [privateIpv4, lambdaCidrs] of [
    ['172.16.10.10', ['172.16.241.0/24']], ['192.168.10.10', ['192.168.241.0/24']],
  ]) assert.doesNotThrow(() => renderConfig({ ...input, privateIpv4, lambdaCidrs }))
  assert.doesNotThrow(() => renderConfig({ ...input, hosts: {
    cognitoAuth: 'placeholder.auth.ap-northeast-2.amazoncognito.com',
    cognitoJwks: 'cognito-idp.ap-northeast-2.amazonaws.com', essentia: 'essentia.example.invalid',
    codebuild: 'codebuild.ap-northeast-2.amazonaws.com', kvs: '000000000000.cloudfront-kvs.global.api.aws',
  } }))
})


test('CLI emits restricted files without leaking inputs and refuses overwrites', () => {
  const root = fileURLToPath(new URL('./.generated/', import.meta.url))
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const directory = mkdtempSync(join(root, 'cli-'))
  try {
    const inputPath = join(directory, 'input.local.json')
    const output = join(directory, 'out')
    writeFileSync(inputPath, JSON.stringify(input), { mode: 0o600 })
    const run = () => spawnSync(process.execPath, [fileURLToPath(new URL('./render-config.mjs', import.meta.url)), inputPath, output], { encoding: 'utf8' })
    const rendered = run()
    assert.equal(rendered.status, 0, rendered.stderr)
    assert.equal(rendered.stdout, '')
    assert.equal(rendered.stderr, '')
    for (const file of ['squid.conf', 'icaros-egress.service']) assert.equal(statSync(join(output, file)).mode & 0o777, 0o600)
    assert.equal(readFileSync(join(output, 'squid.conf'), 'utf8'), renderConfig(input).squidConfig)
    const repeat = run()
    assert.equal(repeat.status, 1)
    assert.equal(repeat.stdout, '')
    assert.equal(repeat.stderr, 'Egress rendering failed. Check input and use a fresh output directory.\n')
    assert.equal(readFileSync(join(output, 'squid.conf'), 'utf8'), renderConfig(input).squidConfig)
    writeFileSync(inputPath, JSON.stringify({ ...input, hosts: { ...input.hosts, cognitoAuth: 'https://sensitive.example.invalid' } }))
    const invalid = run()
    assert.equal(invalid.status, 1)
    assert.equal(invalid.stderr, repeat.stderr)
    assert.doesNotMatch(invalid.stderr, /sensitive|example|10\.200/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
