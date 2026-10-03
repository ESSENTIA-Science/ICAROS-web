export type GalleryColumns = 1 | 2 | 3
export type GalleryAlign = 'left' | 'center' | 'right'
export type GalleryImage = { src: string; alt: string; caption: string }
export type MarkdownChange = { value: string; start: number; end: number }

function insertBlock(value: string, from: number, to: number, block: string): MarkdownChange {
  const before = value.slice(0, from)
  const after = value.slice(to)
  const prefix = before && !before.endsWith('\n\n') ? before.endsWith('\n') ? '\n' : '\n\n' : ''
  const suffix = after && !after.startsWith('\n\n') ? after.startsWith('\n') ? '\n' : '\n\n' : ''
  const next = before + prefix + block + suffix + after
  const cursor = before.length + prefix.length + block.length
  return { value: next, start: cursor, end: cursor }
}

function splitCells(line: string): string[] {
  const cells: string[] = []
  let current = ''
  const source = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (char === '\\' && source[index + 1] === '|') { current += '|'; index++; continue }
    if (char === '|') { cells.push(current.trim()); current = ''; continue }
    current += char
  }
  cells.push(current.trim())
  return cells
}

export function readTableAt(value: string, cursor: number): { from: number; to: number; cells: string[][] } | null {
  const lines = value.split('\n')
  const offsets: number[] = []
  let offset = 0
  for (const line of lines) { offsets.push(offset); offset += line.length + 1 }
  const position = lines.findIndex((line, index) => cursor >= offsets[index]! && cursor <= offsets[index]! + line.length)
  if (position < 0) return null
  let first = position
  let last = position
  while (first > 0 && lines[first - 1]?.trim().startsWith('|')) first--
  while (last + 1 < lines.length && lines[last + 1]?.trim().startsWith('|')) last++
  if (last - first < 1 || !lines[first]?.trim().startsWith('|')) return null
  const cells = lines.slice(first, last + 1).map(splitCells)
  if (!cells[1]?.length || cells[1].some(cell => !/^:?-{3,}:?$/.test(cell)) || cells[0]?.length !== cells[1].length) return null
  return { from: offsets[first]!, to: offsets[last]! + lines[last]!.length,
    cells: [cells[0]!, ...cells.slice(2).map(row => cells[0]!.map((_, index) => row[index] ?? ''))] }
}

export function insertTableMarkdown(value: string, from: number, to: number, cells: string[][]): MarkdownChange {
  const width = Math.max(1, cells[0]?.length ?? 1)
  const row = (items: string[]) => `| ${Array.from({ length: width }, (_, index) => (items[index] ?? '').trim().replace(/\|/g, '\\|')).join(' | ')} |`
  const block = [row(cells[0] ?? []), row(Array(width).fill('---')), ...cells.slice(1).map(row)].join('\n')
  return insertBlock(value, from, to, block)
}

export function parseSpreadsheetCells(value: string): string[][] {
  const rows = value.replace(/\r\n?/g, '\n').trimEnd().split('\n').map(line => line.split('\t').map(cell => cell.trim()))
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  return rows.map(row => Array.from({ length: width }, (_, index) => row[index] ?? ''))
}

const galleryPattern = /:::gallery\{columns=([123])(?: align=(left|center|right))?\}\n\n([\s\S]*?)\n\n:::/g
const imagePattern = /^!\[([^\]]*)\]\((\S+?)(?: "([^"]*)")?\)$/

export function readSelectedImages(value: string, from: number, to: number): GalleryImage[] {
  const lines = value.slice(from, to).trim().split(/\n+/).map(line => line.trim()).filter(Boolean)
  if (!lines.length) return []
  const images: GalleryImage[] = []
  for (const line of lines) {
    const image = imagePattern.exec(line)
    if (!image) return []
    images.push({ alt: image[1]!, src: image[2]!, caption: image[3] ?? '' })
  }
  return images
}

export function readGalleryAt(value: string, cursor: number): { from: number; to: number; columns: GalleryColumns; align: GalleryAlign; images: GalleryImage[] } | null {
  for (const match of value.matchAll(galleryPattern)) {
    const from = match.index
    const to = from + match[0].length
    if (cursor < from || cursor > to) continue
    const images: GalleryImage[] = []
    for (const line of match[3]!.split(/\n\s*\n/)) {
      const image = imagePattern.exec(line.trim())
      if (!image) return null
      images.push({ alt: image[1]!, src: image[2]!, caption: image[3] ?? '' })
    }
    return { from, to, columns: Number(match[1]) as GalleryColumns, align: (match[2] ?? 'center') as GalleryAlign, images }
  }
  return null
}

export function insertGalleryMarkdown(value: string, from: number, to: number, images: GalleryImage[], columns: GalleryColumns, align: GalleryAlign): MarkdownChange {
  const position = columns === 1 && align !== 'center' ? ` align=${align}` : ''
  const imageLines = images.map(image => {
    const alt = image.alt.trim().replaceAll('[', '').replaceAll(']', '').replaceAll('\\', '') || '이미지'
    const caption = image.caption.trim().replaceAll('"', "'")
    return `![${alt}](${image.src}${caption ? ` "${caption}"` : ''})`
  })
  return insertBlock(value, from, to, `:::gallery{columns=${columns}${position}}\n\n${imageLines.join('\n\n')}\n\n:::`)
}
