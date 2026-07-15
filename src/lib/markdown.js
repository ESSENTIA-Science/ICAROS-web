// 게시글 Markdown 파생 유틸 — posts.jsx / admin.jsx 공유.
// 목록 카드용 커버·요약 추출과, 삭제 시 Storage 정리를 위한 이미지 경로 추출.

const IMAGE_RE = /!\[[^\]]*\]\(([^)]+)\)/;

/** 본문 첫 번째 이미지 URL (없으면 "") */
export const extractFirstImage = (markdown = "") => {
  const match = markdown.match(IMAGE_RE);
  return match ? match[1] : "";
};

/** 마크다운 기호를 제거한 순수 텍스트 */
export const stripMarkdown = (markdown = "") =>
  markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\n+/g, " ")
    .trim();

/** 목록 카드용 요약 (기본 160자, 초과 시 말줄임) */
export const buildSummary = (markdown = "", max = 160) => {
  const text = stripMarkdown(markdown);
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
};

/**
 * 본문에 삽입된 Supabase Storage public URL 에서 오브젝트 경로를 추출.
 * 게시글 삭제 시 고아 이미지 정리에 사용.
 * @returns {string[]} 예: ["posts/uuid.webp"]
 */
export const extractStoragePaths = (markdown = "", bucket = "post-img") => {
  const re = /\/storage\/v1\/object\/public\/([^/]+)\/([^\s)"']+)/g;
  const paths = [];
  let m;
  while ((m = re.exec(markdown)) !== null) {
    if (m[1] === bucket) {
      try {
        paths.push(decodeURIComponent(m[2]));
      } catch {
        paths.push(m[2]);
      }
    }
  }
  return paths;
};
