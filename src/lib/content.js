import { supabase } from "./supabase";

/**
 * site_content 전체를 { key: value } 맵으로 로드.
 * 실패 시 빈 객체 → 호출측의 defaults 로 폴백.
 */
export const fetchSiteContent = async () => {
  const { data, error } = await supabase.from("site_content").select("key, value");
  if (error) {
    console.error("[site_content] fetch error:", error);
    return {};
  }
  return Object.fromEntries((data || []).map((row) => [row.key, row.value]));
};

/** 저장할 { key: value } 맵을 upsert. */
export const saveSiteContent = async (entries) => {
  const rows = Object.entries(entries).map(([key, value]) => ({
    key,
    value: value == null ? null : String(value),
    updated_at: new Date().toISOString(),
  }));
  return supabase.from("site_content").upsert(rows);
};
