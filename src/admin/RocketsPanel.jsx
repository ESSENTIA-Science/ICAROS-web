import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { uploadImage, removeImageByUrl } from "../lib/storage";

const EMPTY = {
  id: "",
  name: "",
  series: "A",
  img: "",
  max_altitude_m: "",
  size_m: "",
  payload_kg: "",
  engines: [],
  sort_order: 0,
};

const toNum = (v) => (v === "" || v == null ? null : Number(v));

// 폼 엔진(문자열 필드) → DB jsonb(빈 값 제거)
const cleanEngines = (engines) =>
  engines.map((en) => {
    const out = {};
    if (en.type) out.type = en.type;
    if (en.thrust_n !== "" && en.thrust_n != null) out.thrust_n = Number(en.thrust_n);
    if (en.burn_time_s !== "" && en.burn_time_s != null) out.burn_time_s = Number(en.burn_time_s);
    if (en.count !== "" && en.count != null) out.count = Number(en.count);
    if (en.mode) out.mode = en.mode;
    return out;
  });

export default function RocketsPanel() {
  const [rockets, setRockets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchRockets();
  }, []);

  const fetchRockets = async () => {
    setLoading(true);
    setError("");
    const { data, error } = await supabase
      .from("rockets")
      .select("*")
      .order("series", { ascending: true })
      .order("sort_order", { ascending: true });
    if (error) setError(error.message);
    else setRockets(data || []);
    setLoading(false);
  };

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const resetForm = () => {
    setForm(EMPTY);
    setEditing(false);
  };

  const handleImg = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await uploadImage(file, "rockets");
      setField("img", url);
    } catch (err) {
      setError(err.message);
    }
    setUploading(false);
    event.target.value = "";
  };

  const addEngine = () => setForm((f) => ({ ...f, engines: [...f.engines, { type: "" }] }));
  const setEngine = (idx, key, val) =>
    setForm((f) => ({
      ...f,
      engines: f.engines.map((en, i) => (i === idx ? { ...en, [key]: val } : en)),
    }));
  const removeEngine = (idx) =>
    setForm((f) => ({ ...f, engines: f.engines.filter((_, i) => i !== idx) }));

  const handleSave = async () => {
    if (!form.id.trim() || !form.name.trim()) {
      setError("id와 name은 필수입니다.");
      return;
    }
    const record = {
      id: form.id.trim(),
      name: form.name.trim(),
      series: form.series,
      img: form.img || null,
      max_altitude_m: toNum(form.max_altitude_m),
      size_m: toNum(form.size_m),
      payload_kg: toNum(form.payload_kg),
      engines: cleanEngines(form.engines),
      sort_order: Number(form.sort_order) || 0,
    };
    const query = editing
      ? supabase.from("rockets").update(record).eq("id", form.id)
      : supabase.from("rockets").insert(record);
    const { error } = await query;
    if (error) {
      setError(error.message);
      return;
    }
    resetForm();
    fetchRockets();
  };

  const handleEdit = (r) => {
    setForm({
      id: r.id,
      name: r.name || "",
      series: r.series || "A",
      img: r.img || "",
      max_altitude_m: r.max_altitude_m ?? "",
      size_m: r.size_m ?? "",
      payload_kg: r.payload_kg ?? "",
      engines: (r.engines || []).map((en) => ({
        type: en.type ?? "",
        thrust_n: en.thrust_n ?? "",
        burn_time_s: en.burn_time_s ?? "",
        count: en.count ?? "",
        mode: en.mode ?? "",
      })),
      sort_order: r.sort_order ?? 0,
    });
    setEditing(true);
  };

  const handleDelete = async (r) => {
    if (!window.confirm(`Delete "${r.name}"?`)) return;
    await removeImageByUrl(r.img);
    const { error } = await supabase.from("rockets").delete().eq("id", r.id);
    if (error) {
      setError(error.message);
      return;
    }
    if (form.id === r.id) resetForm();
    fetchRockets();
  };

  return (
    <div className="cms-panel">
      <div className="cms-form">
        <h2 className="cms-form__title">{editing ? `로켓 수정: ${form.id}` : "로켓 추가"}</h2>
        {error ? <p className="admin-posts__status admin-posts__status--error">{error}</p> : null}

        <div className="cms-grid">
          <label className="cms-field">
            <span>ID (slug)</span>
            <input value={form.id} onChange={(e) => setField("id", e.target.value)} disabled={editing} placeholder="icx3" />
          </label>
          <label className="cms-field">
            <span>이름</span>
            <input value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="ICX-III" />
          </label>
          <label className="cms-field">
            <span>시리즈</span>
            <select value={form.series} onChange={(e) => setField("series", e.target.value)}>
              <option value="A">ICX 1/2 Series</option>
              <option value="B">ICX MV Series</option>
            </select>
          </label>
          <label className="cms-field">
            <span>정렬 순서</span>
            <input type="number" value={form.sort_order} onChange={(e) => setField("sort_order", e.target.value)} />
          </label>
          <label className="cms-field">
            <span>최대 고도 (m)</span>
            <input type="number" value={form.max_altitude_m} onChange={(e) => setField("max_altitude_m", e.target.value)} />
          </label>
          <label className="cms-field">
            <span>길이 (m)</span>
            <input type="number" step="0.1" value={form.size_m} onChange={(e) => setField("size_m", e.target.value)} />
          </label>
          <label className="cms-field">
            <span>페이로드 (kg)</span>
            <input type="number" step="0.1" value={form.payload_kg} onChange={(e) => setField("payload_kg", e.target.value)} />
          </label>
        </div>

        <div className="cms-field">
          <span>이미지</span>
          <div className="cms-img-row">
            {form.img ? <img className="cms-img-preview" src={form.img} alt="" /> : null}
            <label className="toolbar-upload">
              {uploading ? "업로드중…" : "이미지 선택"}
              <input type="file" accept="image/*" onChange={handleImg} disabled={uploading} />
            </label>
          </div>
        </div>

        <div className="cms-field">
          <div className="cms-engines__head">
            <span>엔진</span>
            <button type="button" className="toolbar-button" onClick={addEngine}>+ 엔진 추가</button>
          </div>
          {form.engines.map((en, idx) => (
            <div className="cms-engine" key={idx}>
              <input placeholder="type" value={en.type ?? ""} onChange={(e) => setEngine(idx, "type", e.target.value)} />
              <input placeholder="thrust_n" type="number" value={en.thrust_n ?? ""} onChange={(e) => setEngine(idx, "thrust_n", e.target.value)} />
              <input placeholder="burn_time_s" type="number" value={en.burn_time_s ?? ""} onChange={(e) => setEngine(idx, "burn_time_s", e.target.value)} />
              <input placeholder="count" type="number" value={en.count ?? ""} onChange={(e) => setEngine(idx, "count", e.target.value)} />
              <input placeholder="mode" value={en.mode ?? ""} onChange={(e) => setEngine(idx, "mode", e.target.value)} />
              <button type="button" className="admin-posts__button admin-posts__button--danger" onClick={() => removeEngine(idx)}>삭제</button>
            </div>
          ))}
        </div>

        <div className="editor-actions">
          <button className="editor-button" type="button" onClick={handleSave}>
            {editing ? "Update Rocket" : "Create Rocket"}
          </button>
          {editing ? (
            <button className="editor-button editor-button--ghost" type="button" onClick={resetForm}>Cancel</button>
          ) : null}
        </div>
      </div>

      <div className="admin-posts">
        <div className="admin-posts__header">
          <h2 className="admin-posts__title">Rockets</h2>
          <button className="admin-posts__refresh" type="button" onClick={fetchRockets}>Refresh</button>
        </div>
        {loading ? (
          <p className="admin-posts__status">Loading...</p>
        ) : rockets.length ? (
          <div className="admin-posts__list">
            {rockets.map((r) => (
              <div className="admin-posts__item" key={r.id}>
                <div className="admin-posts__meta">
                  <div className="admin-posts__title-text">
                    {r.name} <span className="cms-badge">{r.series}</span>
                  </div>
                  <div className="admin-posts__date">
                    {r.max_altitude_m ?? "-"}m · {r.size_m ?? "-"}m · {(r.engines || []).length} engine(s)
                  </div>
                </div>
                <div className="admin-posts__actions">
                  <button type="button" className="admin-posts__button" onClick={() => handleEdit(r)}>Edit</button>
                  <button type="button" className="admin-posts__button admin-posts__button--danger" onClick={() => handleDelete(r)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="admin-posts__status">No rockets yet.</p>
        )}
      </div>
    </div>
  );
}
