import { supabase } from "./supabase";
import { extractStoragePaths } from "./markdown";

// 모든 CMS 이미지는 post-img 버킷을 폴더로 구분해 공유(posts/ rockets/ members/).
export const STORAGE_BUCKET = "post-img";

/** 파일 업로드 후 public URL 반환. 실패 시 throw. */
export const uploadImage = async (file, folder = "misc") => {
  const ext = file.name?.split(".").pop() || "bin";
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw error;
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
};

/** 버킷에 속한 public URL이면 오브젝트를 삭제(외부 URL·비어있으면 무시). */
export const removeImageByUrl = async (url) => {
  if (!url) return;
  const [path] = extractStoragePaths(url, STORAGE_BUCKET);
  if (!path) return;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([path]);
  if (error) console.error("[storage] remove error:", error.message);
};
