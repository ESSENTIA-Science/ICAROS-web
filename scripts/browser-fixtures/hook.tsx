import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useAutosave } from '../../apps/cms/src/lib/useAutosave'
import { flushCmsChanges, getCmsChanges, resetCmsChanges } from '../../apps/cms/src/lib/cmsChanges'
const calls: string[] = []
let release: (() => void) | null = null
let first = true
function Editor() {
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState('')
  const autosave = useAutosave({ key: 'shared-record', dirty: draft !== saved, fingerprint: draft, delay: 20,
    save: async () => { calls.push(draft); if (first) { first = false; await new Promise<void>(resolve => { release = resolve }) }; setSaved(draft) } })
  return <label>Lifecycle draft<input value={draft} onChange={event => setDraft(event.target.value)} /><span>{autosave.status}</span></label>
}
function Harness() {
  const [mounted, setMounted] = useState(true)
  return <><button onClick={() => setMounted(value => !value)}>Toggle mount</button>{mounted && <Editor />}</>
}
resetCmsChanges()
Object.assign(window, { hookHarness: { calls, release: () => release?.(), flush: flushCmsChanges, state: getCmsChanges } })
createRoot(document.getElementById('root')!).render(<Harness />)
