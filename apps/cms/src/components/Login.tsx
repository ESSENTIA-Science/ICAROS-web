import { useEffect } from 'react'

export default function Login({ error }: { error?: string }) {
  useEffect(() => {
    if (!error) location.replace('/api/admin/auth/start')
  }, [error])

  return <div className="gate"><div className="gateCard">
    <h1 lang="en">ICAROS Admin</h1><p>{error ? '로그인 연결을 확인해 주세요.' : 'Cognito 로그인으로 이동 중…'}</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    <a className="primary" href="/api/admin/auth/start">Cognito로 로그인</a>
  </div></div>
}
