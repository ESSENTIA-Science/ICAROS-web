import { useCallback, useEffect, useState } from "react";
import "./posts.css";
import { supabase } from "./lib/supabase";
import IcarosLogo from "./assets/logo_black.svg";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";

const PAGE_SIZE = 12;

const Posts = () => {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const [modalContent, setModalContent] = useState("");
  const [modalLoading, setModalLoading] = useState(false);

  // 목록은 경량 컬럼만(content_md 제외) + range 페이지네이션
  const fetchPage = useCallback(async (from) => {
    const { data, error } = await supabase
      .from("posts")
      .select("id, title, cover_url, summary, created_at")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("[posts] fetch error:", error);
      return [];
    }
    setHasMore((data?.length || 0) === PAGE_SIZE);
    return data || [];
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setPosts(await fetchPage(0));
      setLoading(false);
    })();
  }, [fetchPage]);

  const loadMore = async () => {
    setLoadingMore(true);
    const next = await fetchPage(posts.length);
    setPosts((prev) => [...prev, ...next]);
    setLoadingMore(false);
  };

  // 모달 열 때만 본문(content_md) 개별 조회
  const openPost = async (post) => {
    setSelectedPost(post);
    setModalContent("");
    setModalLoading(true);
    const { data, error } = await supabase
      .from("posts")
      .select("content_md")
      .eq("id", post.id)
      .single();
    if (error) console.error("[posts] load content error:", error);
    setModalContent(data?.content_md || "");
    setModalLoading(false);
  };

  const closePost = () => {
    setSelectedPost(null);
    setModalContent("");
  };

  const formatDate = (value) =>
    value ? new Date(value).toLocaleDateString("en-CA") : "";

  return (
    <section className="gallery-section">
      <h1>Posts</h1>

      {loading ? (
        <p className="posts-loading">Loading...</p>
      ) : posts.length === 0 ? (
        <p className="posts-loading">No posts yet.</p>
      ) : (
        <>
          <div className="posts-grid">
            {posts.map((post) => (
              <article
                className="post-card"
                key={post.id}
                onClick={() => openPost(post)}
                role="button"
                tabIndex={0}
              >
                <div className="post-card__media">
                  {post.cover_url ? (
                    <img
                      src={post.cover_url}
                      alt={post.title}
                      loading="lazy"
                      decoding="async"
                      className="post-card__img"
                    />
                  ) : (
                    <div className="post-card__placeholder">
                      <img src={IcarosLogo} alt="ICAROS" />
                    </div>
                  )}
                </div>
                <div className="post-card__body">
                  <time className="post-card__date">{formatDate(post.created_at)}</time>
                  <h3 className="post-card__title">{post.title}</h3>
                  <p className="post-card__excerpt">{post.summary}</p>
                </div>
              </article>
            ))}
          </div>

          {hasMore ? (
            <div className="posts-more">
              <button
                type="button"
                className="posts-more__btn"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading..." : "더 보기"}
              </button>
            </div>
          ) : null}
        </>
      )}

      {selectedPost && (
        <div className="post-modal-overlay" onClick={closePost}>
          <div className="post-modal" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="post-modal__close" onClick={closePost}>
              닫기
            </button>
            <div className="post-modal__title">{selectedPost.title}</div>
            <div className="post-modal__divider" />
            <div className="post-modal__content">
              {modalLoading ? (
                <p className="posts-loading">Loading...</p>
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                >
                  {modalContent}
                </ReactMarkdown>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default Posts;
