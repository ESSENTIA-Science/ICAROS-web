'use client'

import { useEffect, useRef } from 'react'
import styles from './ModelStage.module.css'

export default function ModelViewer({ src, label, onReady, onError }: {
  src: string
  label: string
  onReady: () => void
  onError: () => void
}) {
  const host = useRef<HTMLDivElement>(null)

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
        const [THREE, { GLTFLoader }, { OrbitControls }, { MeshoptDecoder }] = await Promise.all([
          import('three'),
          import('three/examples/jsm/loaders/GLTFLoader.js'),
          import('three/examples/jsm/controls/OrbitControls.js'),
          import('three/examples/jsm/libs/meshopt_decoder.module.js'),
        ])
        if (disposed || !element) return

        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        element.append(renderer.domElement)
        scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 3))
        const keyLight = new THREE.DirectionalLight(0xffffff, 2)
        keyLight.position.set(3, 5, 4)
        scene.add(keyLight)

        const loaded = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(src)
        if (disposed) return
        model = loaded.scene
        scene.add(model)
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const radius = Math.max(size.x, size.y, size.z)
        if (!Number.isFinite(radius) || radius <= 0) throw new Error('Empty model')

        camera.aspect = element.clientWidth / element.clientHeight || 1
        const fitSize = Math.max(size.y, size.x / camera.aspect, size.z)
        const distance = (fitSize * 1.3) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))
        const direction = new THREE.Vector3(0.45, 0.2, 1).normalize()
        camera.position.copy(center).addScaledVector(direction, distance)
        camera.near = Math.max(radius / 1000, 0.001)
        camera.far = radius * 100
        camera.updateProjectionMatrix()
        controls = new OrbitControls(camera, renderer.domElement)
        controls.target.copy(center)
        controls.enableDamping = true
        controls.dampingFactor = 0.04
        controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        controls.autoRotateSpeed = 0.6
        controls.update()

        const resize = () => {
          if (!element || !renderer) return
          const width = element.clientWidth
          const height = element.clientHeight
          if (!width || !height) return
          renderer.setSize(width, height)
          camera.aspect = width / height
          camera.updateProjectionMatrix()
        }
        observer = new ResizeObserver(resize)
        observer.observe(element)
        resize()

        let firstFrame = true
        const draw = () => {
          if (disposed || !renderer) return
          controls?.update()
          renderer.render(scene, camera)
          if (firstFrame) {
            firstFrame = false
            onReady()
          }
          frame = requestAnimationFrame(draw)
        }
        draw()
      } catch {
        if (!disposed) onError()
      }
    }

    void start()
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer?.disconnect()
      controls?.dispose()
      model?.traverse((node) => {
        const mesh = node as import('three').Mesh
        if (!mesh.isMesh) return
        mesh.geometry.dispose()
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        materials.forEach((material) => material.dispose())
      })
      renderer?.dispose()
      renderer?.domElement.remove()
    }
  }, [src, onReady, onError])

  return <div ref={host} role="region" aria-label={`${label} 3D 모델`} className={styles.viewer} />
}
