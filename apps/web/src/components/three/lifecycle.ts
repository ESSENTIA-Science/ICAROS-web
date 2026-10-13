/** One pending frame; static controls stop once damping settles. */
export function createRenderLoop(
  draw: () => boolean,
  request: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancel: (frame: number) => void = cancelAnimationFrame,
) {
  let frame = 0
  let active = false
  let continuous = false
  let disposed = false
  const invalidate = () => {
    if (disposed || !active || frame !== 0) return
    frame = request(() => {
      frame = 0
      if (disposed || !active) return
      const changed = draw()
      if (continuous || changed) invalidate()
    })
  }
  return {
    invalidate,
    setActive(value: boolean) {
      active = value
      if (active) invalidate()
      else { cancel(frame); frame = 0 }
    },
    setContinuous(value: boolean) {
      continuous = value
      if (continuous) invalidate()
    },
    dispose() {
      disposed = true
      cancel(frame)
      frame = 0
    },
  }
}
