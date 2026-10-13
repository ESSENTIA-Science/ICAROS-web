import '../../../app/tokens.css'
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BufferGeometry, Material, Texture, Scene as ThreeScene } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import ModelStage from '../../rocket/ModelStage.tsx'
import ModelViewer from '../../rocket/ModelViewer.tsx'
import Scene from '../Scene.tsx'
import HeroStage from '../HeroStage.tsx'
import { DEFAULT_STAGE } from '../config.ts'

// Count actual Three calls. GPU memory values are renderer.info counts, not bytes.
const stats = { renders: 0, ready: 0, errors: 0, geometryDisposes: 0, materialDisposes: 0, textureDisposes: 0, roomDisposes: 0, rendererDisposes: 0, bitmapCloses: 0, requests: 0, memories: [] }
const renderers = new WeakSet()
ThreeScene.prototype.onBeforeRender = function (renderer) {
  stats.renders++
  stats.memories.push({ ...renderer.info.memory })
  if (stats.memories.length > 10) stats.memories.shift()
  if (!renderers.has(renderer)) {
    renderers.add(renderer)
    const dispose = renderer.dispose
    renderer.dispose = function () { stats.rendererDisposes++; return dispose.call(this) }
  }
}
for (const [prototype, key] of [[BufferGeometry.prototype, 'geometryDisposes'], [Material.prototype, 'materialDisposes'], [Texture.prototype, 'textureDisposes'], [RoomEnvironment.prototype, 'roomDisposes']]) {
  const dispose = prototype.dispose
  prototype.dispose = function (...args) { stats[key]++; return dispose.apply(this, args) }
}
if (globalThis.ImageBitmap) {
  const close = ImageBitmap.prototype.close
  ImageBitmap.prototype.close = function () { stats.bitmapCloses++; return close.call(this) }
}
const fetchOriginal = window.fetch.bind(window)
window.fetch = async (...args) => {
  const url = typeof args[0] === 'string' ? args[0] : args[0].url
  if (url?.includes('icx-2.glb')) {
    stats.requests++
    const delay = Number(new URL(url, location.href).searchParams.get('delay'))
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
  }
  return fetchOriginal(...args)
}

function texturedModel() {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0])
  const bytes = new Uint8Array(positions.buffer)
  const buffer = btoa(String.fromCharCode(...bytes))
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 2
  const context = canvas.getContext('2d')
  context.fillStyle = 'white'; context.fillRect(0, 0, 2, 2)
  const uvBytes = new Uint8Array(new Float32Array([0, 0, 1, 0, 0.5, 1]).buffer)
  const uvBuffer = btoa(String.fromCharCode(...uvBytes))
  const gltf = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    buffers: [{ uri: `data:application/octet-stream;base64,${buffer}`, byteLength: 36 }, { uri: `data:application/octet-stream;base64,${uvBuffer}`, byteLength: 24 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 1, byteOffset: 0, byteLength: 24 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' }],
    images: [{ uri: canvas.toDataURL('image/png') }], textures: [{ source: 0 }],
    materials: [{ doubleSided: true, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, roughnessFactor: 0.8 } }],
  }
  return URL.createObjectURL(new Blob([JSON.stringify(gltf)], { type: 'model/gltf+json' }))
}
const ready = () => { stats.ready++; document.querySelector('#status').textContent = 'ready' }
const error = () => { stats.errors++; document.querySelector('#status').textContent = 'error' }
let setOptions
function Fixture() {
  const [options, update] = useState({ mode: 'detail', active: true, reduced: false, autoRotate: true, enabledMobile: false, src: DEFAULT_STAGE.src })
  useEffect(() => { setOptions = update }, [update])
  useEffect(() => { window.graphicsHarness.committedActive = options.active }, [options.active])
  if (options.mode === 'none') return null
  if (options.mode === 'detail-stage') return React.createElement(ModelStage, { src: options.src, label: 'synthetic-stage' }, React.createElement('div', null, 'synthetic poster'))
  if (options.mode === 'stage') return React.createElement(HeroStage, { src: options.src, autoRotate: options.autoRotate, enabledMobile: options.enabledMobile })
  if (options.mode === 'hero') return React.createElement('div', { id: 'hero-canvas' }, React.createElement(Scene, { target: document.querySelector('#hero-target'), config: { ...DEFAULT_STAGE, src: options.src, autoRotate: options.autoRotate }, reducedMotion: options.reduced, onReady: ready, onError: error }))
  return React.createElement(ModelViewer, { src: options.src, label: 'synthetic lifecycle', active: options.active, onReady: ready, onError: error })
}
const root = createRoot(document.querySelector('#root'))
root.render(React.createElement(Fixture))
window.graphicsHarness = {
  stats,
  set: options => setOptions(previous => ({ ...previous, ...options })),
  setDelayed: (options, milliseconds) => setTimeout(() => setOptions(previous => ({ ...previous, ...options })), milliseconds),
  texturedModel,
  reset: () => { for (const key of Object.keys(stats)) stats[key] = key === 'memories' ? [] : 0 },
  unmount: () => root.unmount(),
}
