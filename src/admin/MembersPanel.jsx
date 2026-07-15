import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { uploadImage, removeImageByUrl } from "../lib/storage";

const EMPTY = { id: null, name: "", role: "", school: "", image: "", sort_order: 0 };

export default function MembersPanel() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    setLoading(true);
    setError("");
    const { data, error } = await supabase
      .from("members")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) setError(error.message);
    else setMembers(data || []);
    setLoading(false);
  };

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const resetForm = () => setForm(EMPTY);

  const handleImg = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await uploadImage(file, "members");
      setField("image", url);
    } catch (err) {
      setError(err.message);
    }
    setUploading(false);
    event.target.value = "";
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError("이름은 필수입니다.");
      return;
    }
    const record = {
      name: form.name.trim(),
      role: form.role.trim() || null,
      school: form.school.trim() || null,
      image: form.image || null,
      sort_order: Number(form.sort_order) || 0,
    };
    const query = form.id
      ? supabase.from("members").update(record).eq("id", form.id)
      : supabase.from("members").insert(record);
    const { error } = await query;
    if (error) {
      setError(error.message);
      return;
    }
    resetForm();
    fetchMembers();
  };

  const handleEdit = (m) => {
    setForm({
      id: m.id,
      name: m.name || "",
      role: m.role || "",
      school: m.school || "",
      image: m.image || "",
      sort_order: m.sort_order ?? 0,
    });
  };

  const handleDelete = async (m) => {
    if (!window.confirm(`Delete "${m.name}"?`)) return;
    await removeImageByUrl(m.image);
    const { error } = await supabase.from("members").delete().eq("id", m.id);
    if (error) {
      setError(error.message);
      return;
    }
    if (form.id === m.id) resetForm();
    fetchMembers();
  };

  return (
    <div className="cms-panel">
      <div className="cms-form">
        <h2 className="cms-form__title">{form.id ? `멤버 수정: ${form.name}` : "멤버 추가"}</h2>
        {error ? <p className="admin-posts__status admin-posts__status--error">{error}</p> : null}

        <div className="cms-grid">
          <label className="cms-field">
            <span>이름</span>
            <input value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="홍길동" />
          </label>
          <label className="cms-field">
            <span>역할</span>
            <input value={form.role} onChange={(e) => setField("role", e.target.value)} placeholder="추진공학부" />
          </label>
          <label className="cms-field">
            <span>학교</span>
            <input value={form.school} onChange={(e) => setField("school", e.target.value)} placeholder="○○고등학교" />
          </label>
          <label className="cms-field">
            <span>정렬 순서</span>
            <input type="number" value={form.sort_order} onChange={(e) => setField("sort_order", e.target.value)} />
          </label>
        </div>

        <div className="cms-field">
          <span>프로필 이미지</span>
          <div className="cms-img-row">
            {form.image ? <img className="cms-img-preview cms-img-preview--round" src={form.image} alt="" /> : null}
            <label className="toolbar-upload">
              {uploading ? "업로드중…" : "이미지 선택"}
              <input type="file" accept="image/*" onChange={handleImg} disabled={uploading} />
            </label>
          </div>
        </div>

        <div className="editor-actions">
          <button className="editor-button" type="button" onClick={handleSave}>
            {form.id ? "Update Member" : "Create Member"}
          </button>
          {form.id ? (
            <button className="editor-button editor-button--ghost" type="button" onClick={resetForm}>Cancel</button>
          ) : null}
        </div>
      </div>

      <div className="admin-posts">
        <div className="admin-posts__header">
          <h2 className="admin-posts__title">Members</h2>
          <button className="admin-posts__refresh" type="button" onClick={fetchMembers}>Refresh</button>
        </div>
        {loading ? (
          <p className="admin-posts__status">Loading...</p>
        ) : members.length ? (
          <div className="admin-posts__list">
            {members.map((m) => (
              <div className="admin-posts__item" key={m.id}>
                <div className="admin-posts__meta">
                  <div className="admin-posts__title-text">{m.name}</div>
                  <div className="admin-posts__date">{m.role || "-"}{m.school ? ` · ${m.school}` : ""}</div>
                </div>
                <div className="admin-posts__actions">
                  <button type="button" className="admin-posts__button" onClick={() => handleEdit(m)}>Edit</button>
                  <button type="button" className="admin-posts__button admin-posts__button--danger" onClick={() => handleDelete(m)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="admin-posts__status">No members yet.</p>
        )}
      </div>
    </div>
  );
}
