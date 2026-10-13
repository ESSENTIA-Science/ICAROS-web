import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

const lifecycle = await import('../lifecycle.ts')
const resources = await import('../ownedResources.ts')
const environment = await import('../environment.ts')

function rafFixture() {
  let next = 0
  const pending = new Map()
  let renders = 0
  let changed = false
  const loop = lifecycle.createRenderLoop(() => { renders++; const result = changed; changed = false; return result }, callback => {
    pending.set(++next, callback)
    return next
  }, id => pending.delete(id))
  const tick = () => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback()) }
  return { loop, pending, tick, changed: () => { changed = true }, renders: () => renders }
}

test('static viewer renders once and sleeps; controls damping and resize can request more frames', () => {
  assert.equal(typeof lifecycle.createRenderLoop, 'function', 'render lifetime controller is required')
  const f = rafFixture()
  f.loop.setActive(true)
  f.tick()
  assert.equal(f.renders(), 1)
  assert.equal(f.pending.size, 0)
  f.changed(); f.loop.invalidate(); f.tick()
  assert.equal(f.pending.size, 1)
  f.tick()
  assert.equal(f.pending.size, 0)
  f.loop.invalidate(); f.tick()
  assert.equal(f.renders(), 4)
})

test('offscreen, hidden and dispose cancel queued frames; reentry resumes continuous rotation', () => {
  assert.equal(typeof lifecycle.createRenderLoop, 'function')
  const f = rafFixture()
  f.loop.setContinuous(true); f.loop.setActive(true)
  f.tick(); f.tick()
  assert.equal(f.renders(), 2)
  assert.equal(f.pending.size, 1)
  f.loop.setActive(false); f.loop.invalidate(); f.tick()
  assert.equal(f.renders(), 2)
  assert.equal(f.pending.size, 0)
  f.loop.setActive(true); f.tick()
  assert.equal(f.renders(), 3)
  f.loop.setContinuous(false); f.tick()
  assert.equal(f.pending.size, 0)
  f.loop.setContinuous(true); f.loop.dispose(); f.loop.setActive(true); f.loop.invalidate(); f.tick()
  assert.equal(f.renders(), 4)
  assert.equal(f.pending.size, 0)
})

test('exclusive GLB scenes dispose actual shared Three resources once, including textures and bitmap', () => {
  assert.equal(typeof resources.disposeOwnedScenes, 'function', 'exclusive scene cleanup is required')
  let closes = 0
  class Bitmap { close() { closes++ } }
  const previous = globalThis.ImageBitmap
  globalThis.ImageBitmap = Bitmap
  try {
    const bitmap = new Bitmap()
    const map = new Texture(bitmap)
    const normalMap = new Texture(bitmap)
    const geometry = new BoxGeometry()
    const material = new MeshStandardMaterial({ map, normalMap })
    const scene = new Group()
    const otherScene = new Group()
    scene.add(new Mesh(geometry, material), new Mesh(geometry, [material, material]))
    otherScene.add(new Mesh(geometry, material))
    const counts = { geometry: 0, material: 0, map: 0, normalMap: 0 }
    for (const [key, value] of Object.entries({ geometry, material, map, normalMap })) value.addEventListener('dispose', () => counts[key]++)
    resources.disposeOwnedScenes([scene, otherScene])
    assert.deepEqual(counts, { geometry: 1, material: 1, map: 1, normalMap: 1 })
    assert.equal(closes, 1)
  } finally { globalThis.ImageBitmap = previous }
})

for (const fails of [false, true]) test(`temporary actual RoomEnvironment disposed when PMREM ${fails ? 'fails' : 'succeeds'}`, () => {
  assert.equal(typeof environment.bakeEnvironment, 'function')
  const room = new RoomEnvironment()
  const geometries = new Set(), materials = new Set()
  room.traverse(node => { if (node.isMesh) { geometries.add(node.geometry); materials.add(node.material) } })
  assert.equal(geometries.size, 1)
  assert.equal(materials.size, 8)
  let geometryCount = 0, materialCount = 0, generatorCount = 0
  geometries.forEach(value => value.addEventListener('dispose', () => geometryCount++))
  materials.forEach(value => value.addEventListener('dispose', () => materialCount++))
  const output = { texture: new Texture() }
  const generator = { fromScene: source => { assert.equal(source, room); if (fails) throw Error('synthetic GPU failure'); return output }, dispose: () => { generatorCount++ } }
  if (fails) assert.throws(() => environment.bakeEnvironment(generator, room), /synthetic GPU failure/)
  else assert.equal(environment.bakeEnvironment(generator, room), output)
  assert.equal(geometryCount, 1)
  assert.equal(materialCount, 8)
  assert.equal(generatorCount, 1)
})

const capabilities = await import('../capabilities.ts')
const visibility = await import('../visibility.ts')

test('mobile breakpoint subscription reevaluates desktop promotion and removes its listener', () => {
  assert.equal(typeof capabilities.subscribeMobileViewport, 'function')
  const previous = globalThis.window
  const mq = new EventTarget()
  mq.matches = false
  globalThis.window = { matchMedia: () => mq }
  let changes = 0
  try {
    const unsubscribe = capabilities.subscribeMobileViewport(() => { changes++ })
    mq.matches = true; mq.dispatchEvent(new Event('change'))
    assert.equal(capabilities.probe({ enabledDesktop: true, enabledMobile: false }), 'mobile-disabled')
    assert.equal(changes, 1)
    unsubscribe(); mq.dispatchEvent(new Event('change'))
    assert.equal(changes, 1)
  } finally { globalThis.window = previous }
})

test('document visibility reports hidden state and unsubscribes', () => {
  assert.equal(typeof visibility.subscribeDocumentVisible, 'function')
  const previous = globalThis.document
  const document = new EventTarget()
  document.hidden = false
  globalThis.document = document
  let changes = 0
  try {
    const unsubscribe = visibility.subscribeDocumentVisible(() => { changes++ })
    assert.equal(visibility.readDocumentVisible(), true)
    document.hidden = true; document.dispatchEvent(new Event('visibilitychange'))
    assert.equal(visibility.readDocumentVisible(), false)
    assert.equal(changes, 1)
    unsubscribe(); document.dispatchEvent(new Event('visibilitychange'))
    assert.equal(changes, 1)
  } finally { globalThis.document = previous }
})

const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
const { PerspectiveCamera } = await import('three')

test('actual OrbitControls damping settles with the same render controller', () => {
  const camera = new PerspectiveCamera(45, 1, 0.01, 1000)
  camera.position.set(0, 0, 5)
  const controls = new OrbitControls(camera)
  controls.enableDamping = true
  controls.dampingFactor = 0.04
  controls.autoRotate = false
  let next = 0, renders = 0
  const pending = new Map()
  const loop = lifecycle.createRenderLoop(() => { renders++; return controls.update() }, callback => { pending.set(++next, callback); return next }, id => pending.delete(id))
  controls.addEventListener('change', loop.invalidate)
  loop.setActive(true)
  let ticks = 0
  const drain = () => {
    while (pending.size && ticks++ < 500) {
      const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback())
    }
    assert.equal(pending.size, 0, 'damping must stop scheduling')
  }
  drain()
  assert.equal(renders, 1)
  const initialX = camera.position.x
  controls.rotateLeft(0.3)
  drain()
  assert.ok(renders > 2 && renders < 500)
  assert.notEqual(camera.position.x, initialX)
  loop.dispose()
})
