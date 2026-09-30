import { useState, type FormEvent } from 'react'
import { api } from '../lib/api/client'
import type { Session } from '../lib/api/types'

export default function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try { onLogin(await api.login(email, password)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '로그인에 실패했습니다.') }
    finally { setBusy(false) }
  }
  return <div className="gate"><div className="gateCard">
    <h1 lang="en">ICAROS Admin</h1><p>관리자 계정으로 로그인해 주세요.</p>
    <form onSubmit={submit}>
      {error && <p className="notice error" role="alert">{error}</p>}
      <label>이메일<input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} autoFocus /></label>
      <label>비밀번호<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required maxLength={512} /></label>
      <button className="primary" disabled={busy}>{busy ? '확인 중…' : '로그인'}</button>
    </form>
  </div></div>
}
