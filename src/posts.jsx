import { useEffect, useState } from "react";
import "./posts.css";
import { supabase } from "./lib/supabase";
import IcarosLogo from "./assets/logo_black.svg";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";

const Posts = () => {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPost, setSelectedPost] = useState(null);

  useEffect(() => {
    const fetchPosts = async () => {
      const { data, error } = await supabase
        .from("posts")
        .select("id, title, content_md, created_at")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[posts] fetch error:", error);
        setPosts([]);
      } else {
        setPosts(data || []);
      }

      setLoading(false);
    };

    fetchPosts();
  }, []);

  const extractFirstImage = (markdown = "") => {
    const match = markdown.match(/!\[[^\]]*\]\(([^)]+)\)/);
    return match ? match[1] : "";
  };

  const stripMarkdown = (markdown = "") =>
    markdown
      .replace(/```[\s\S]*?```/g, "")
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^>\s?/gm, "")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/[*_`]/g, "")
      .replace(/\n+/g, " ")
      .trim();

  const formatDate = (value) => {
    if (!value) return "";
    return new Date(value).toLocaleDateString("en-CA");
  };

  return (
    <section className="gallery-section">
      <h1>Posts</h1>

      {loading ? (
        <p className="posts-loading">Loading...</p>
      ) : (
        <div className="posts-grid">
          {posts.map((post) => {
            const cover = extractFirstImage(post.content_md);
            const summary = stripMarkdown(post.content_md);

            return (
              <article
                className="post-card"
                key={post.id}
                onClick={() => setSelectedPost(post)}
                role="button"
                tabIndex={0}
              >
                <div className="post-card__media">
                  {cover ? (
                    <img
                      src={cover}
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
                  <p className="post-card__excerpt">{summary}</p>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {selectedPost && (
        <div
          className="post-modal-overlay"
          onClick={() => setSelectedPost(null)}
        >
          <div className="post-modal" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="post-modal__close"
              onClick={() => setSelectedPost(null)}
            >
              닫기
            </button>
            <div className="post-modal__title">{selectedPost.title}</div>
            <div className="post-modal__divider" />
            <div className="post-modal__content">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
              >
                {selectedPost.content_md || ""}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default Posts;
