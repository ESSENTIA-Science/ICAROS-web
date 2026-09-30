import { useCallback, useEffect, useState } from 'react'
import Login from './components/Login'
import Editor from './components/Editor'
import ResourceEditor from './components/ResourceEditor'
import MissionsEditor from './components/MissionsEditor'
import PostCreate from './components/PostCreate'
import AttachmentsEditor from './components/AttachmentsEditor'
import VehicleMediaEditor from './components/VehicleMediaEditor'
import { resourceTabs, type ResourceKind } from './lib/resources'
import { api, ApiError } from './lib/api/client'
import type { ContentKind, ContentMap, Post, Session } from './lib/api/types'
import { publicationLabel } from './lib/editor'

const tabs: { id: ContentKind; label: string; description: string }[] = [
  { id: 'rockets', label: '로켓', description: '로켓 기체 정보와 제원을 편집합니다.' },
  { id: 'site', label: '사이트 설정', description: '공개 사이트의 문구와 설정값을 편집합니다.' },
  { id: 'posts', label: '게시글', description: 'ESSENTIA 원본 게시글을 CMS API를 통해 편집합니다.' },
]
const groups = [
  { label: '홈', ids: ['panels'] },
  { label: '기체', ids: ['rockets', 'vehicles', 'vehicle-types', 'vehicle-series'] },
  { label: '기록', ids: ['posts', 'post-attachments', 'missions'] },
  { label: '팀', ids: ['members', 'departments'] },
  { label: '후원', ids: ['donation-rounds'] },
  { label: '설정', ids: ['site'] },
] as const
const settingLabels: Record<string, string> = {
  'donation.goal': '후원 목표 금액', 'donation.current': '현재 후원 금액',
  'donation.round_label': '후원 차수', 'nav.about': '소개 메뉴 이름', 'nav.rocket': '기체 메뉴 이름', 'nav.posts': '기록 메뉴 이름',
  'nav.member': '멤버 메뉴 이름',
}

function initialTab(): ContentKind {
  const tab = new URLSearchParams(location.search).get('tab')
  return tabs.find(item => item.id === tab)?.id ?? 'site'
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [sessionError, setSessionError] = useState('')
  const [tab, setTab] = useState<ContentKind | ResourceKind>(() => { const value = new URLSearchParams(location.search).get('tab'); return resourceTabs.find(item => item.id === value)?.id ?? initialTab() })
  const [items, setItems] = useState<ContentMap[ContentKind][]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [creatingPost, setCreatingPost] = useState(false)

  const load = useCallback(async (kind: ContentKind) => {
    setLoading(true); setError(''); setSelected('')
    try {
      const records = await api.list(kind)
      setItems(records)
      setSelected(records[0]?.id ?? '')
    } catch (cause) {
      setItems([])
      setError(cause instanceof Error ? cause.message : '목록을 불러오지 못했습니다.')
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) setSession(null)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    api.session().then(setSession).catch(cause => {
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) setSession(null)
      else { setSessionError(cause instanceof Error ? cause.message : '세션을 확인하지 못했습니다.'); setSession(undefined) }
    })
  }, [])
  useEffect(() => { if (session && tabs.some(item => item.id === tab)) queueMicrotask(() => void load(tab as ContentKind)) }, [session, tab, load])

  function switchTab(next: ContentKind | ResourceKind) {
    setCreatingPost(false)
    history.replaceState(null, '', `${location.pathname}?tab=${next}`)
    setTab(next)
  }
  async function logout() {
    try { await api.logout(); setSession(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '로그아웃에 실패했습니다.') }
  }
  const active = items.find(item => item.id === selected)
  function update(record: ContentMap[ContentKind]) { setItems(previous => previous.map(item => item.id === record.id ? record : item)) }
  function createdPost(post: Post) {
    setItems(previous => [post, ...previous.filter(item => item.id !== post.id)])
    setSelected(post.id)
    setCreatingPost(false)
  }

  if (session === undefined) return <div className="gate"><div className="gateCard"><h1>ICAROS Admin</h1>{sessionError ? <><p className="notice error" role="alert">{sessionError}</p><button onClick={() => location.reload()}>다시 시도</button></> : <p>세션 확인 중…</p>}</div></div>
  if (session === null) return <Login onLogin={setSession} />
  const current = [...tabs, ...resourceTabs].find(item => item.id === tab)!
  return <div className="shell"><a className="skip" href="#admin-main">본문으로 건너뛰기</a>
    <header className="topbar"><div className="topbarInner"><div className="brand"><strong>ICAROS</strong><span>ADMIN</span></div><div className="who"><span>{session.displayName || session.email}</span><button onClick={logout}>로그아웃</button></div></div></header>
    <nav className="tabs" aria-label="관리 영역"><div className="tabList">{groups.map(group => <div className="tabGroup" key={group.label}><span className="tabGroupLabel">{group.label}</span><div>{group.ids.map(id => { const item = [...tabs, ...resourceTabs].find(candidate => candidate.id === id)!; return <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => switchTab(id)}>{item.label}</button> })}</div></div>)}</div></nav>
    <main id="admin-main">{import.meta.env.VITE_ICAROS_DEMO === '1' && <p className="notice" role="status">로컬 DB 읽기 전용 미리보기입니다. 저장과 게시 기능은 연결되지 않았습니다.</p>}<div className="panelHead"><div><p className="eyebrow">CONTENT MANAGEMENT</p><h1>{current.label}</h1><p>{current.description}</p></div>{tab === 'posts' && <button onClick={() => setCreatingPost(true)} disabled={import.meta.env.VITE_ICAROS_DEMO === '1' || loading}>새 게시글</button>}{tabs.some(item => item.id === tab) && <button onClick={() => void load(tab as ContentKind)} disabled={loading}>새로고침</button>}</div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {tab === 'post-attachments' ? <AttachmentsEditor /> : tab === 'vehicles' ? <VehicleMediaEditor /> : tab === 'missions' ? <MissionsEditor /> : !tabs.some(item => item.id === tab) ? <ResourceEditor key={tab} kind={tab as ResourceKind} /> : loading ? <div className="card">불러오는 중…</div> : <div className="workspace"><aside className="card list" aria-label="콘텐츠 목록"><h2>목록 <span className="count">{items.length}</span></h2>{items.length === 0 ? <p className="empty">표시할 콘텐츠가 없습니다.</p> : <div className="listItems">{items.map(item => {
        const title = 'name' in item ? item.name : 'value' in item ? settingLabels[item.id] ?? item.id : item.title
        return <button key={item.id} className="listItem" aria-current={!creatingPost && selected === item.id ? 'true' : undefined} onClick={() => { setCreatingPost(false); setSelected(item.id) }}><strong>{title || item.id}</strong><small>{publicationLabel(item.publishState)}</small></button>
      })}</div>}</aside>
      <div className="workArea">{tab === 'posts' && creatingPost ? <PostCreate onCreated={createdPost} /> : active ? <Editor key={`${tab}:${active.id}`} kind={tab as ContentKind} record={active as ContentMap[ContentKind]} onSaved={update} /> : <div className="card empty">항목을 선택하세요.</div>}</div></div>}
    </main>
  </div>
}
