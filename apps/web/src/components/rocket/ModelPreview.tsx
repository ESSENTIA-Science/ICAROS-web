'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'

const Viewer = dynamic(() => import('./ModelViewer'), { ssr: false, loading: () => <p>3D 모델을 불러오는 중입니다…</p> })

export default function ModelPreview({ src, label }: { src: string; label: string }) {
  const [open, setOpen] = useState(false)
  return <div>
    {open ? <Viewer src={src} label={label} /> : <button type="button" onClick={() => setOpen(true)}>3D 모델 보기</button>}
  </div>
}
