/**
 * 마크다운 본문·상류 발췌 → 카드용 한 줄 발췌.
 *
 * `/posts` 갤러리 카드는 제목 아래 두 줄을 쓴다. 그 두 줄에 마크다운 기호나 이미지 URL 이
 * 그대로 들어가면 카드가 소스 코드처럼 읽힌다. 그래서 **그리기 직전에** 평문으로 접는다.
 *
 * 두 원본이 같은 함수를 본다 — 레거시(`legacy_posts.content_md`)와 ESSENTIA(상세 본문 ·
 * 목록 응답의 `excerpt`). 발췌 규칙이 소스별로 갈라지면 같은 격자 안에서 카드 두 종류의
 * 톤이 달라진다.
 *
 * 이미지는 **대체 텍스트까지 버린다.** 실제 값이 `1000035345.jpg` 같은 카메라 파일명이라
 * 남겨 두면 발췌 첫머리가 숫자열이 된다. 사진은 카드 위쪽 프레임이 이미 보여 주고 있다.
 *
 * ## 왜 두 단계인가 — `plainExcerpt` 와 `cardExcerpt`
 *
 * `plainExcerpt` 는 **마크다운을 걷어내는** 일만 한다. 걷어내고도 산문이 아닌 값이 남는다:
 * 사진 한 장만 올린 글의 상류 `excerpt` 는 `1000034096` 같은 카메라 파일명이고, 상류가
 * 발췌를 만들 때 하이픈까지 지우기 때문에(`community/client.ts`) UUID 가 통째로 한 덩어리
 * 문자열이 되어 온다. 그래서 **판정은 따로** 있다 — `cardExcerpt` 가 마지막 문지기다.
 *
 * 카드에 쓰는 값은 **반드시 `cardExcerpt` 를 통과한다.** 예전에는 상세 호출이 성공했을
 * 때만 본문에서 만든 발췌로 덮었고, 그래서 그 호출이 실패하는 순간 카메라 파일명이 그대로
 * 카드에 남았다. 보장이 성공 경로에만 걸려 있으면 그건 보장이 아니다.
 */

/** 경로처럼 생긴 이미지 토큰. 상류 발췌에는 이게 공백 없이 본문과 붙어서 온다. */
const IMAGE_PATH = /\S*\/\S+\.(?:png|jpe?g|gif|webp|avif|heic|heif|bmp|svg)\b/gi

/**
 * 잘린 끝단의 **미완성** 마크다운 토큰.
 *
 * 본문을 앞에서 N자만 읽어 오면(`feed.ts` 의 `LEGACY_HEAD_CHARS`) 절단면이 이미지 토큰
 * 한가운데일 수 있다 — `![IMG_1420.jpeg](/api/media/38d6069c-7364` 처럼 닫는 `)` 도
 * 확장자도 없는 조각이 남는다. 그러면 아래 이미지 규칙 어느 것에도 걸리지 않고
 * 원시 토큰이 그대로 카드로 샌다.
 *
 * 그래서 **다른 규칙보다 먼저** 꼬리의 미완성 토큰을 떼어 낸다. 절단 위치가 어디였든
 * 구조적으로 막히므로, 자르는 쪽 상수를 바꿔도 이 결함이 다시 생기지 않는다.
 */
const DANGLING_TAIL = /!?\[[^\]]*(?:\]\([^)]*)?$/

export function plainExcerpt(source: string, max = 110): string {
  const text = source
    // 절단면 정리가 먼저다 — 아래 규칙들은 "닫힌" 토큰만 안다.
    .replace(DANGLING_TAIL, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(IMAGE_PATH, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (text.length <= max) return text
  // 자르고 남은 꼬리 공백까지 지운 뒤에 말줄임을 붙인다 — "…" 앞에 빈칸이 남으면 눈에 띈다.
  return `${text.slice(0, max).trimEnd()}…`
}

/** 이미지 확장자로 끝나는 토큰. 꼬리에 `…`·`)` 같은 것이 붙어 있어도 잡는다. */
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif|heic|heif|bmp|tiff?|svg)(?:$|[^\p{L}\p{N}])/iu

/** 앞뒤 구두점(말줄임표 포함)을 떼고 알맹이만 남긴다. */
const trimPunct = (t: string): string =>
  t.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '')

/**
 * 산문이 아닌 토큰.
 *
 * 상류 발췌에서 실제로 관측된 것들이다:
 * `1000034096`(카메라 파일명) · `IMG_1420.jpeg` ·
 * `16bb4baa88634df48acad5ed13719f921000035345.jpg`(하이픈이 지워진 UUID + 파일명) ·
 * `/api/media/38d6069c-7364`(절단된 경로).
 *
 * **연도를 죽이지 않는다** — `2026` 은 네 자리라 아래 `\d{5,}` 에 걸리지 않는다.
 * 한글 토큰은 `[0-9a-z]` 규칙에 애초에 해당하지 않는다.
 */
function isNoiseToken(token: string): boolean {
  if (IMAGE_EXT.test(token)) return true

  const core = trimPunct(token)
  if (!core) return false // 순수 구두점. 버릴 이유가 없다 — 판정은 아래 `hasWords` 가 한다.

  if (/^\d{5,}$/.test(core)) return true // 1000034096
  if (/^[0-9a-f]{16,}$/i.test(core)) return true // 하이픈이 지워진 UUID · 해시
  if (core.length >= 12 && /^[0-9a-z]+$/i.test(core) && /\d/.test(core)) return true
  // 경로 조각. 슬래시만으로는 "A/B" 같은 산문을 죽이므로 숫자나 선행 슬래시를 함께 본다.
  if (core.includes('/') && (token.startsWith('/') || /\d/.test(core))) return true

  return false
}

/** 글자가 둘 이상 이어지는 곳이 한 군데도 없으면 그건 문장이 아니다. */
const HAS_WORDS = /\p{L}{2,}/u

/**
 * **카드에 찍어도 되는 발췌.** 산문이 아니면 빈 문자열이다.
 *
 * 빈 문자열이어도 카드는 성립한다(`PostCard` 가 `<p>` 를 아예 그리지 않는다). 의미 없는
 * 숫자열이 제목 밑에 붙어 있는 것보다 없는 편이 낫다 — 그 판단은 이 함수 하나가 내린다.
 */
export function cardExcerpt(source: string, max = 110): string {
  const plain = plainExcerpt(source, max)
  if (!plain) return ''

  const kept = plain
    .split(' ')
    .filter((t) => !isNoiseToken(t))
    .join(' ')
    .trim()

  return HAS_WORDS.test(kept) ? kept : ''
}
