import { useEffect, useState } from "react";
import "./admin.css";
import { supabase } from "./lib/supabase";
import PostsPanel from "./admin/PostsPanel";
import RocketsPanel from "./admin/RocketsPanel";
import MembersPanel from "./admin/MembersPanel";
import LandingPanel from "./admin/LandingPanel";

const TABS = [
  { key: "posts", label: "Posts", Panel: PostsPanel },
  { key: "rockets", label: "Rockets", Panel: RocketsPanel },
  { key: "members", label: "Members", Panel: MembersPanel },
  { key: "landing", label: "Landing", Panel: LandingPanel },
];

const Admin = () => {
  const [session, setSession] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecking, setAdminChecking] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState("");
  const [activeTab, setActiveTab] = useState("posts");

  // 세션 구독
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthChecking(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, []);

  // 세션 → 관리자 여부(RLS 기준 is_admin())
  useEffect(() => {
    if (!session) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    setAdminChecking(true);
    supabase.rpc("is_admin").then(({ data, error }) => {
      if (cancelled) return;
      setIsAdmin(!error && data === true);
      setAdminChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setAuthError("");
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) return;
    setSigningIn(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });
    setSigningIn(false);
    if (error) {
      setAuthError(error.message);
      return;
    }
    // 성공 시 onAuthStateChange 가 세션을 설정
    setPassword("");
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setEmail("");
    setPassword("");
  };

  // ── 인증 단계 ──
  if (authChecking) {
    return (
      <section className="admin">
        <p className="title">Admin Page</p>
        <p className="admin-posts__status">Loading...</p>
      </section>
    );
  }

  if (!session) {
    return (
      <section className="admin">
        <p className="title">Admin Page</p>
        <form className="pw-input" onSubmit={handleLogin}>
          <p className="pw-title">관리자 로그인</p>
          <input
            className="input-field"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="admin@example.com"
            autoComplete="email"
          />
          <input
            className="input-field"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="비밀번호"
            autoComplete="current-password"
          />
          <button className="pw-button" type="submit" disabled={signingIn}>
            {signingIn ? "로그인 중…" : "로그인"}
          </button>
          {authError ? (
            <p className="admin-posts__status admin-posts__status--error">{authError}</p>
          ) : null}
        </form>
      </section>
    );
  }

  if (adminChecking) {
    return (
      <section className="admin">
        <p className="title">Admin Page</p>
        <p className="admin-posts__status">권한 확인 중...</p>
      </section>
    );
  }

  if (!isAdmin) {
    return (
      <section className="admin">
        <p className="title">Admin Page</p>
        <div className="pw-input">
          <p className="admin-posts__status admin-posts__status--error">
            이 계정({session.user.email})에는 관리자 권한이 없습니다.
          </p>
          <button className="pw-button" type="button" onClick={handleLogout}>로그아웃</button>
        </div>
      </section>
    );
  }

  // ── 관리자 콘솔 ──
  const ActivePanel = TABS.find((t) => t.key === activeTab)?.Panel ?? PostsPanel;

  return (
    <section className="admin">
      <div className="admin-topbar">
        <p className="title">Admin Page</p>
        <div className="admin-topbar__session">
          <span className="editor-session__email">{session.user.email}</span>
          <button type="button" className="editor-button editor-button--ghost" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      <nav className="admin-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`admin-tab${activeTab === tab.key ? " admin-tab--active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <ActivePanel />
    </section>
  );
};

export default Admin;
