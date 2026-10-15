export function subscribeDocumentVisible(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

export function readDocumentVisible(): boolean {
  return !document.hidden
}
