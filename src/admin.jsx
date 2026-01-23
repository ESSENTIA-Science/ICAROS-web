import { useEffect, useRef, useState } from "react";
import "./admin.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";

const admin = () => {
    const [isAdmin, setIsAdmin] = useState(false);
    const [password, setPassword] = useState("");
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [images, setImages] = useState([]);
    const [posts, setPosts] = useState([]);
    const [postsLoading, setPostsLoading] = useState(false);
    const [postsError, setPostsError] = useState("");
    const [editingId, setEditingId] = useState(null);
    const bodyRef = useRef(null);
    const titleRef = useRef(null);

    useEffect(() => {
        return () => {
            images.forEach((image) => {
                if (image.url.startsWith("blob:")) {
                    URL.revokeObjectURL(image.url);
                }
            });
        };
    }, [images]);

    useEffect(() => {
        if (!isAdmin) return;
        fetchPosts();
    }, [isAdmin]);

    const fetchPosts = async () => {
        setPostsLoading(true);
        setPostsError("");
        const functionsUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-posts?action=list`;

        const response = await fetch(functionsUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ adminPw: password }),
        });

        if (!response.ok) {
            setPostsError(await response.text());
            setPosts([]);
            setPostsLoading(false);
            return;
        }

        const data = await response.json();
        setPosts(data?.data || []);
        setPostsLoading(false);
    };

    const handleLogin = (event) => {
        event.preventDefault();
        const adminPw = import.meta.env.VITE_ADMIN_PW || import.meta.env.ADMIN_PW;
        if (!password.trim() || !adminPw) return;
        if (password !== adminPw) return;
        setIsAdmin(true);
    };

    const handleImageChange = async (event) => {
        const files = Array.from(event.target.files || []);
        if (!files.length) return;

        const uploadedImages = [];
        const functionsUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-posts?action=upload`;

        for (const file of files) {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("adminPw", password);

            const response = await fetch(functionsUrl, {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                console.error("[admin] image upload error:", await response.text());
                continue;
            }

            const data = await response.json();
            if (!data?.publicUrl) continue;

            uploadedImages.push({
                name: file.name,
                url: data.publicUrl,
            });
        }

        if (uploadedImages.length) {
            setImages((prev) => [...prev, ...uploadedImages]);
            setBody((prev) => {
                const appended = uploadedImages
                    .map((image) => `![${image.name}](${image.url})`)
                    .join("\n");
                return prev ? `${prev}\n\n${appended}` : appended;
            });
        }

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

    const insertHeading = (level) => {
        const prefix = `${"#".repeat(level)} `;
        insertAtCursor(prefix);
    };

    const resetEditor = () => {
        setTitle("");
        setBody("");
        setImages([]);
        setEditingId(null);
    };

    const handleSubmit = async () => {
        if (!title.trim() || !body.trim()) return;
        const action = editingId ? "update" : "create";
        const functionsUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-posts?action=${action}`;

        const response = await fetch(functionsUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                adminPw: password,
                id: editingId,
                title: title.trim(),
                content_md: body,
            }),
        });

        if (!response.ok) {
            console.error("[admin] post insert error:", await response.text());
            return;
        }

        resetEditor();
        fetchPosts();
    };

    const handleEdit = (post) => {
        setEditingId(post.id);
        setTitle(post.title || "");
        setBody(post.content_md || "");
        requestAnimationFrame(() => {
            titleRef.current?.focus();
        });
    };

    const handleCancelEdit = () => {
        resetEditor();
    };

    const handleDelete = async (post) => {
        const ok = window.confirm(`Delete "${post.title}"?`);
        if (!ok) return;
        const functionsUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-posts?action=delete`;
        const response = await fetch(functionsUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ adminPw: password, id: post.id }),
        });

        if (!response.ok) {
            console.error("[admin] post delete error:", await response.text());
            return;
        }

        if (editingId === post.id) {
            resetEditor();
        }

        fetchPosts();
    };

    const formatDate = (value) => {
        if (!value) return "";
        return new Date(value).toLocaleDateString("en-CA");
    };

    return(
        <section className="admin">
            <p className="title">Admin Page</p>
            {isAdmin ? (
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
                                img
                                <input
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={handleImageChange}
                                />
                            </label>
                            <button type="button" className="toolbar-button" onClick={() => insertAtCursor("`{text}`", true)}>{"</>"}</button>
                        </div>
                        <textarea
                            id="post-body"
                            className="editor-textarea"
                            value={body}
                            ref={bodyRef}
                            onChange={(event) => {
                                console.log("[admin] body input:", event.target.value);
                                setBody(event.target.value);
                            }}
                            placeholder="(Markdown 문법 지원)"
                            rows={12}
                        />
                                                <div className="editor-actions">
                            <button className="editor-button" type="button" onClick={handleSubmit}>
                                {editingId ? "Update Post" : "Create Post"}
                            </button>
                            {editingId ? (
                                <button className="editor-button editor-button--ghost" type="button" onClick={handleCancelEdit}>
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
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                rehypePlugins={[rehypeHighlight]}
                            >
                                {body || ""}
                            </ReactMarkdown>
                        </div>
                    </div>
                </div>
                <div className="admin-posts">
                    <div className="admin-posts__header">
                        <h2 className="admin-posts__title">Posts</h2>
                        <button className="admin-posts__refresh" type="button" onClick={fetchPosts}>
                            Refresh
                        </button>
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
                                        <button
                                            type="button"
                                            className="admin-posts__button"
                                            onClick={() => handleEdit(post)}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            type="button"
                                            className="admin-posts__button admin-posts__button--danger"
                                            onClick={() => handleDelete(post)}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="admin-posts__status">No posts yet.</p>
                    )}
                </div>
            </div>
            )
            : (
                <form className="pw-input" onSubmit={handleLogin}>
                    <p className="pw-title">Admin Password</p>
                    <input
                        className="input-field"
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                    />
                    <button className="pw-button" type="submit">Login</button>
                </form>
            ) 
        }
        </section>
    )
}

export default admin;





