import type { PMREMGenerator, WebGLRenderTarget } from 'three'
import type { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

export function bakeEnvironment(pmrem: PMREMGenerator, room: RoomEnvironment): WebGLRenderTarget {
  try {
    return pmrem.fromScene(room, 0.04)
  } finally {
    room.dispose()
    pmrem.dispose()
  }
}
