import { useEffect, useState } from "react";
import { fetchSiteContent, saveSiteContent } from "../lib/content";

// 편집 대상 필드 정의. 슬로건은 **단어**=강조.
const SECTIONS = [
  {
    title: "About",
    fields: [
      { key: "about.slogan", label: "슬로건 (**단어** = 강조)", type: "text" },
      { key: "about.body", label: "본문", type: "textarea" },
    ],
  },
  {
    title: "Vision",
    fields: [
      { key: "vision.slogan", label: "슬로건 (**단어** = 강조)", type: "text" },
      { key: "vision.body", label: "본문", type: "textarea" },
    ],
  },
  {
    title: "Research Areas",
    fields: [
      { key: "research.uav.title", label: "UAV 제목", type: "text" },
      { key: "research.uav.body", label: "UAV 본문", type: "textarea" },
      { key: "research.control.title", label: "Flight Control 제목", type: "text" },
      { key: "research.control.body", label: "Flight Control 본문", type: "textarea" },
      { key: "research.rocketry.title", label: "Rocketry 제목", type: "text" },
      { key: "research.rocketry.body", label: "Rocketry 본문", type: "textarea" },
    ],
  },
  {
    title: "Mission",
    fields: [
      { key: "mission.body", label: "본문", type: "textarea" },
      { key: "mission.list", label: "주요 활동 (한 줄에 하나)", type: "textarea" },
    ],
  },
  {
    title: "Donate",
    fields: [
      { key: "donate.intro", label: "소개 문구", type: "textarea" },
      { key: "donate.usage_title", label: "사용처 제목", type: "text" },
      { key: "donate.usage_list", label: "사용처 목록 (한 줄에 하나)", type: "textarea" },
      { key: "donation.goal", label: "목표액 (원)", type: "number" },
      { key: "donation.current", label: "현재 후원액 (원)", type: "number" },
    ],
  },
  {
    title: "Contact",
    fields: [{ key: "contact.body", label: "본문", type: "textarea" }],
  },
];

const ALL_KEYS = SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

export default function LandingPanel() {
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    (async () => {
      const map = await fetchSiteContent();
      const initial = {};
      ALL_KEYS.forEach((k) => {
        initial[k] = map[k] ?? "";
      });
      setValues(initial);
      setLoading(false);
    })();
  }, []);

  const setField = (key, value) => setValues((v) => ({ ...v, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    setStatus("");
    const { error } = await saveSiteContent(values);
    setSaving(false);
    setStatus(error ? `저장 실패: ${error.message}` : "저장되었습니다.");
  };

  if (loading) return <p className="admin-posts__status">Loading...</p>;

  return (
    <div className="cms-form cms-form--wide">
      <div className="cms-form__header">
        <h2 className="cms-form__title">랜딩 문구 · 기부 현황</h2>
        <div className="editor-actions">
          <button className="editor-button" type="button" onClick={handleSave} disabled={saving}>
            {saving ? "저장중…" : "Save All"}
          </button>
        </div>
      </div>
      {status ? <p className="admin-posts__status">{status}</p> : null}

      {SECTIONS.map((section) => (
        <fieldset className="cms-section" key={section.title}>
          <legend>{section.title}</legend>
          {section.fields.map((field) => (
            <label className="cms-field" key={field.key}>
              <span>{field.label}</span>
              {field.type === "textarea" ? (
                <textarea
                  className="cms-textarea"
                  rows={4}
                  value={values[field.key] ?? ""}
                  onChange={(e) => setField(field.key, e.target.value)}
                />
              ) : (
                <input
                  type={field.type === "number" ? "number" : "text"}
                  value={values[field.key] ?? ""}
                  onChange={(e) => setField(field.key, e.target.value)}
                />
              )}
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}
