import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";
import { supabase } from "../lib/supabase";
import { extractFirstImage, buildSummary, extractStoragePaths } from "../lib/markdown";
import { uploadImage, STORAGE_BUCKET } from "../lib/storage";

export default function PostsPanel() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [uploading, setUploading] = useState(false);
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const bodyRef = useRef(null);
  const titleRef = useRef(null);

  useEffect(() => {
    fetchPosts();
  }, []);

  const fetchPosts = async () => {
    setPostsLoading(true);
    setPostsError("");
    const { data, error } = await supabase
      .from("posts")
      .select("id, title, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      setPostsError(error.message);
      setPosts([]);
    } else {
      setPosts(data || []);
    }
    setPostsLoading(false);
  };

  const handleImageChange = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setUploading(true);

    const uploaded = [];
    for (const file of files) {
      try {
        const { url } = await uploadImage(file, "posts");
        uploaded.push({ name: file.name, url });
      } catch (error) {
        console.error("[admin] image upload error:", error.message);
      }
    }

    if (uploaded.length) {
      setBody((prev) => {
        const appended = uploaded
          .map((image) => `![${image.name}](${image.url})`)
          .join("\n");
        return prev ? `${prev}\n\n${appended}` : appended;
      });
    }
    setUploading(false);
    event.target.value = "";
  };

  const insertAtCursor = (text, wrap = false) => {
    const textarea = bodyRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = body.slice(start, end);
    const insertText = wrap ? text.replace("{text}", selected || "text") : text;
    const next = body.slice(0, start) + insertText + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      const cursor = start + insertText.length;
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  const insertHeading = (level) => insertAtCursor(`${"#".repeat(level)} `);

  const resetEditor = () => {
    setTitle("");
    setBody("");
    setEditingId(null);
  };

  const handleSubmit = async () => {
    if (!title.trim() || !body.trim()) return;
    const record = {
      title: title.trim(),
      content_md: body,
      cover_url: extractFirstImage(body) || null,
      summary: buildSummary(body),
    };
    const query = editingId
      ? supabase.from("posts").update(record).eq("id", editingId)
      : supabase.from("posts").insert(record);
    const { error } = await query;
    if (error) {
      console.error("[admin] post save error:", error.message);
      setPostsError(error.message);
      return;
    }
    resetEditor();
    fetchPosts();
  };

  const handleEdit = async (post) => {
    const { data, error } = await supabase
      .from("posts")
      .select("content_md")
      .eq("id", post.id)
      .single();
    if (error) {
      console.error("[admin] load post error:", error.message);
      return;
    }
    setEditingId(post.id);
    setTitle(post.title || "");
    setBody(data?.content_md || "");
    requestAnimationFrame(() => titleRef.current?.focus());
  };

  const handleDelete = async (post) => {
    if (!window.confirm(`Delete "${post.title}"?`)) return;

    const { data: full } = await supabase
      .from("posts")
      .select("content_md")
      .eq("id", post.id)
      .single();
    const paths = extractStoragePaths(full?.content_md || "", STORAGE_BUCKET);
    if (paths.length) {
      const { error: rmError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove(paths);
      if (rmError) console.error("[admin] storage cleanup error:", rmError.message);
    }

    const { error } = await supabase.from("posts").delete().eq("id", post.id);
    if (error) {
      setPostsError(error.message);
      return;
    }
    if (editingId === post.id) resetEditor();
    fetchPosts();
  };

  const formatDate = (value) =>
    value ? new Date(value).toLocaleDateString("en-CA") : "";

  return (
    <div className="admin-wrapper">
      <div className="editor">
        <div className="editor-form">
          <label className="editor-label" htmlFor="post-title">게시글 작성</label>
          <input
            ref={titleRef}
            id="post-title"
            className="editor-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="제목"
          />

          <label className="editor-label" htmlFor="post-body">내용</label>
          <div className="editor-toolbar">
            <button type="button" className="toolbar-button" onClick={() => insertHeading(1)}>H1</button>
            <button type="button" className="toolbar-button" onClick={() => insertHeading(2)}>H2</button>
            <button type="button" className="toolbar-button" onClick={() => insertHeading(3)}>H3</button>
            <span className="toolbar-divider" />
            <button type="button" className="toolbar-button" onClick={() => insertAtCursor("**{text}**", true)}>B</button>
            <button type="button" className="toolbar-button" onClick={() => insertAtCursor("*{text}*", true)}>I</button>
            <span className="toolbar-divider" />
            <button type="button" className="toolbar-button" onClick={() => insertAtCursor("> ")}>"</button>
            <button type="button" className="toolbar-button" onClick={() => insertAtCursor("[text](url)", false)}>link</button>
            <label className="toolbar-upload">
              {uploading ? "업로드중…" : "img"}
              <input type="file" accept="image/*" multiple onChange={handleImageChange} disabled={uploading} />
            </label>
            <button type="button" className="toolbar-button" onClick={() => insertAtCursor("`{text}`", true)}>{"</>"}</button>
          </div>
          <textarea
            id="post-body"
            className="editor-textarea"
            value={body}
            ref={bodyRef}
            onChange={(event) => setBody(event.target.value)}
            placeholder="(Markdown 문법 지원)"
            rows={12}
          />
          <div className="editor-actions">
            <button className="editor-button" type="button" onClick={handleSubmit}>
              {editingId ? "Update Post" : "Create Post"}
            </button>
            {editingId ? (
              <button className="editor-button editor-button--ghost" type="button" onClick={resetEditor}>
                Cancel Edit
              </button>
            ) : null}
          </div>
        </div>

        <div className="editor-preview">
          <p className="editor-label">미리보기</p>
          <div className="preview-content">
            {title ? (
              <>
                <div className="preview-title">{title}</div>
                <hr className="preview-title-divider" />
              </>
            ) : null}
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {body || ""}
            </ReactMarkdown>
          </div>
        </div>
      </div>

      <div className="admin-posts">
        <div className="admin-posts__header">
          <h2 className="admin-posts__title">Posts</h2>
          <button className="admin-posts__refresh" type="button" onClick={fetchPosts}>Refresh</button>
        </div>
        {postsLoading ? (
          <p className="admin-posts__status">Loading...</p>
        ) : postsError ? (
          <p className="admin-posts__status admin-posts__status--error">{postsError}</p>
        ) : posts.length ? (
          <div className="admin-posts__list">
            {posts.map((post) => (
              <div className="admin-posts__item" key={post.id}>
                <div className="admin-posts__meta">
                  <div className="admin-posts__title-text">{post.title}</div>
                  <div className="admin-posts__date">{formatDate(post.created_at)}</div>
                </div>
                <div className="admin-posts__actions">
                  <button type="button" className="admin-posts__button" onClick={() => handleEdit(post)}>Edit</button>
                  <button type="button" className="admin-posts__button admin-posts__button--danger" onClick={() => handleDelete(post)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="admin-posts__status">No posts yet.</p>
        )}
      </div>
    </div>
  );
}
