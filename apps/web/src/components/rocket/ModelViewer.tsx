'use client'

import { useEffect, useRef, useState } from 'react'

export default function ModelViewer({ src, label }: { src: string; label: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    const element = host.current
    if (!element) return
    let disposed = false
    let frame = 0
    let renderer: import('three').WebGLRenderer | undefined
    let model: import('three').Object3D | undefined
    let controls: import('three/examples/jsm/controls/OrbitControls.js').OrbitControls | undefined
    let observer: ResizeObserver | undefined
    async function start() {
      try {
        const [THREE, { GLTFLoader }, { OrbitControls }] = await Promise.all([
          import('three'), import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/controls/OrbitControls.js'),
        ])
        if (disposed || !element) return
        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        element.append(renderer.domElement)
        scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 3))
        const loaded = await new GLTFLoader().loadAsync(src)
        if (disposed) return
        model = loaded.scene
        scene.add(model)
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const radius = Math.max(size.x, size.y, size.z)
        if (!Number.isFinite(radius) || radius <= 0) throw new Error('Empty model')
        camera.position.set(center.x + radius * 1.6, center.y + radius, center.z + radius * 1.6)
        camera.near = Math.max(radius / 1000, 0.001)
        camera.far = radius * 100
        camera.updateProjectionMatrix()
        controls = new OrbitControls(camera, renderer.domElement)
        controls.target.copy(center)
        controls.update()
        observer = new ResizeObserver(() => {
          if (!element || !renderer) return
          const width = element.clientWidth
          const height = element.clientHeight
          if (!width || !height) return
          renderer.setSize(width, height)
          camera.aspect = width / height
          camera.updateProjectionMatrix()
        })
        observer.observe(element)
        function draw() {
          if (disposed || !renderer) return
          controls?.update()
          renderer.render(scene, camera)
          frame = requestAnimationFrame(draw)
        }
        draw()
      } catch { if (!disposed) setError(true) }
    }
    void start()
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer?.disconnect()
      controls?.dispose()
      model?.traverse((node) => {
        if ('geometry' in node && node.geometry instanceof Object && 'dispose' in node.geometry) (node.geometry as { dispose: () => void }).dispose()
      })
      renderer?.dispose()
      renderer?.domElement.remove()
    }
  }, [src])
  return <div role="region" aria-label={`${label} 3D 모델`} style={{ height: '24rem', aspectRatio: '1', background: 'var(--bg-sunken)' }}>
    {error ? <p>3D 모델을 표시할 수 없습니다. 위 사진을 참고해 주세요.</p> : <div ref={host} style={{ width: '100%', height: '100%' }} />}
  </div>
}
