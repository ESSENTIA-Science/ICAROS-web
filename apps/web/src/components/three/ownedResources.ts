import type { BufferGeometry, Material, Object3D, Skeleton, Texture } from 'three'

/** Only for scenes exclusively owned by a GLTFLoader, never useLoader cache assets. */
export function disposeOwnedScenes(scenes: Object3D[]): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  const skeletons = new Set<Skeleton>()
  const bitmaps = new Set<ImageBitmap>()
  for (const scene of scenes) scene.traverse(node => {
    const mesh = node as Object3D & { geometry?: BufferGeometry; material?: Material | Material[]; skeleton?: Skeleton }
    if (mesh.geometry) geometries.add(mesh.geometry)
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material)
    if (mesh.skeleton) skeletons.add(mesh.skeleton)
  })
  for (const material of materials) for (const value of Object.values(material)) {
    if (value && typeof value === 'object' && 'isTexture' in value && value.isTexture) textures.add(value as Texture)
  }
  for (const texture of textures) {
    const images: unknown[] = Array.isArray(texture.image) ? texture.image : [texture.image]
    for (const image of images) if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) bitmaps.add(image)
    texture.dispose()
  }
  for (const bitmap of bitmaps) bitmap.close()
  for (const material of materials) material.dispose()
  for (const geometry of geometries) geometry.dispose()
  for (const skeleton of skeletons) skeleton.dispose()
}
