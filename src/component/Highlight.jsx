// site_content 슬로건의 **단어** 를 .g-highlight span 으로 렌더.
export default function Highlight({ text = "" }) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const match = part.match(/^\*\*([^*]+)\*\*$/);
    return match ? (
      <span key={i} className="g-highlight">
        {match[1]}
      </span>
    ) : (
      <span key={i}>{part}</span>
    );
  });
}
