import { Children, isValidElement, useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { markdown as markdownLanguage } from '@codemirror/lang-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkDirective from 'remark-directive'
import ImagePreview from './ImagePreview'
import { resourcesApi } from '../lib/api/resources'
import { insertGalleryMarkdown, insertTableMarkdown, parseSpreadsheetCells, readGalleryAt, readSelectedImages, readTableAt, type GalleryAlign, type GalleryColumns, type GalleryImage } from './markdownBlocks'
import { remarkGallery } from './remarkGallery'
import MarkdownBodyMedia from './MarkdownBodyMedia'
import { bodyMediaFileKind, insertBodyMediaMarkdown, rememberBodyMediaPreview } from './bodyMedia'

type Format = 'heading' | 'bold' | 'italic' | 'link' | 'list' | 'quote' | 'code'
const tools: { format: Format; label: string; title: string }[] = [
  { format: 'heading', label: 'H2', title: '제목' },
  { format: 'bold', label: 'B', title: '굵게' },
  { format: 'italic', label: 'I', title: '기울임' },
  { format: 'link', label: '링크', title: '링크' },
  { format: 'list', label: '목록', title: '목록' },
  { format: 'quote', label: '인용', title: '인용' },
  { format: 'code', label: '</>', title: '인라인 코드' },
]
const embeddedImage = /!\[([^\]]*)\]\(\/api\/media\/([0-9a-f-]{36})\)/gi
const privateMedia = /^\/api\/media\/([0-9a-f-]{36})$/i

function PreviewImage({ src, alt, title }: ComponentProps<'img'>) {
  const id = privateMedia.exec(src || '')?.[1]
  return id ? <ImagePreview mediaId={id} alt={alt || '본문 이미지'} /> : <img src={src} alt={alt || ''} title={title} />
}

function previewImages(node: ReactNode): { src: string; alt: string; caption: string }[] {
  if (!isValidElement<{ src?: string; alt?: string; title?: string; children?: ReactNode }>(node)) return []
  if (node.type === PreviewImage) return node.props.src ? [{ src: node.props.src, alt: node.props.alt ?? '', caption: node.props.title ?? '' }] : []
  return Children.toArray(node.props.children).flatMap(previewImages)
}

function previewCaption(alt: string, caption: string): string | null {
  const explicit = caption.trim()
  if (explicit) return explicit
  const value = alt.trim()
  return value && !/^(?:IMG[_-]?\d+|DSC[_-]?\d+|PXL[_-]?\d+)(?:\.[a-z0-9]+)?$/i.test(value) ? value : null
}

function GalleryPreview({ children, ...props }: ComponentProps<'div'>) {
  const columns = props['data-gallery-columns' as keyof typeof props]
  if (!columns) return <div {...props}>{children}</div>
  const align = props['data-gallery-align' as keyof typeof props]
  const images = Children.toArray(children).flatMap(previewImages)
  return <div className="markdownGallery" data-gallery-columns={columns} data-gallery-align={align} role="group" aria-label="사진 모음">
    {images.map((image, index) => {
      const caption = previewCaption(image.alt, image.caption)
      return <figure key={`${image.src}-${index}`}>
        <PreviewImage src={image.src} alt={image.alt} />
        {caption && <figcaption>{caption}</figcaption>}
      </figure>
    })}
  </div>
}

class ImageWidget extends WidgetType {
  private root: Root | null = null
  constructor(readonly mediaId: string, readonly alt: string) { super() }
  eq(other: ImageWidget) { return this.mediaId === other.mediaId && this.alt === other.alt }
  toDOM() {
    const element = document.createElement('span')
    element.className = 'markdownEditorImage'
    this.root = createRoot(element)
    this.root.render(<ImagePreview mediaId={this.mediaId} alt={this.alt || '본문 이미지'} />)
    return element
  }
  destroy() { this.root?.unmount(); this.root = null }
}

function imageDecorations(view: EditorView): DecorationSet {
  const ranges = []
  for (const match of view.state.doc.toString().matchAll(embeddedImage)) {
    const start = match.index
    const end = start + match[0].length
    if (view.state.selection.ranges.some(range => range.empty
      ? range.from > start && range.from < end
      : range.from < end && range.to > start)) continue
    ranges.push(Decoration.replace({ widget: new ImageWidget(match[2]!, match[1]!) }).range(start, end))
  }
  return Decoration.set(ranges)
}

const inlineImages = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = imageDecorations(view) }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = imageDecorations(update.view)
  }
}, { decorations: plugin => plugin.decorations })

export function formatMarkdown(value: string, start: number, end: number, format: Format): { value: string; start: number; end: number } {
  const selected = value.slice(start, end)
  const wrap = (before: string, after = before, placeholder = '텍스트') => {
    const inner = selected || placeholder
    return { value: value.slice(0, start) + before + inner + after + value.slice(end), start: start + before.length, end: start + before.length + inner.length }
  }
  if (format === 'bold') return wrap('**')
  if (format === 'italic') return wrap('*')
  if (format === 'code') return wrap('`')
  if (format === 'link') return wrap('[', '](https://)', '링크 텍스트')
  const prefix = format === 'heading' ? '## ' : format === 'list' ? '- ' : '> '
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const lineEnd = value.indexOf('\n', end)
  const finish = lineEnd < 0 ? value.length : lineEnd
  const block = value.slice(lineStart, finish)
  const updated = (block || '텍스트').split('\n').map(line => `${prefix}${line}`).join('\n')
  return { value: value.slice(0, lineStart) + updated + value.slice(finish), start: lineStart, end: lineStart + updated.length }
}

export function insertImageMarkdown(value: string, start: number, end: number, mediaId: string, name: string) {
  const alt = name.replace(/\.[^.]+$/, '').replace(/[[\]\\]/g, '').trim() || '이미지'
  const markdown = `![${alt}](/api/media/${mediaId})`
  return { value: value.slice(0, start) + markdown + value.slice(end), start: start + markdown.length, end: start + markdown.length }
}

export default function MarkdownField({ label, value, onChange, rows = 6, disabled = false }: {
  label: string; value: string; onChange: (value: string) => void; rows?: number; disabled?: boolean
}) {
  const id = useId()
  const mountRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pdfRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const selectionRef = useRef({ start: 0, end: 0 })
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [panel, setPanel] = useState<'table' | 'gallery' | null>(null)
  const [tableCells, setTableCells] = useState<string[][]>([['항목', '값'], ['', '']])
  const [spreadsheet, setSpreadsheet] = useState('')
  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>([])
  const [columns, setColumns] = useState<GalleryColumns>(2)
  const [align, setAlign] = useState<GalleryAlign>('center')
  const editRange = useRef({ from: 0, to: 0 })
  useEffect(() => {
    if (!mountRef.current) return
    const extensions: Extension[] = [markdownLanguage(), inlineImages, EditorView.lineWrapping,
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          selectionRef.current = { start: update.changes.mapPos(selectionRef.current.start, -1), end: update.changes.mapPos(selectionRef.current.end, 1) }
          onChangeRef.current(update.state.doc.toString())
        }
      })]
    if (disabled) extensions.push(EditorState.readOnly.of(true))
    const view = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: mountRef.current })
    viewRef.current = view
    return () => { viewRef.current = null; view.destroy() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled])
  useEffect(() => {
    const view = viewRef.current
    if (view && view.state.doc.toString() !== value) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }, [value])
  function replace(result: { value: string; start: number; end: number }) {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result.value }, selection: { anchor: result.start, head: result.end } })
    view.focus()
  }
  function apply(format: Format) {
    const view = viewRef.current
    if (!view) return
    const selection = view.state.selection.main
    replace(formatMarkdown(view.state.doc.toString(), selection.from, selection.to, format))
  }
  function openTable() {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    const source = view.state.doc.toString()
    const existing = from === to ? readTableAt(source, from) : null
    editRange.current = existing ? { from: existing.from, to: existing.to } : { from, to }
    setTableCells(existing?.cells ?? (from !== to && source.slice(from, to).includes('\t') ? parseSpreadsheetCells(source.slice(from, to)) : [['항목', '값'], ['', '']]))
    setSpreadsheet('')
    setPanel('table')
  }
  function openGallery() {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    const source = view.state.doc.toString()
    const existing = from === to ? readGalleryAt(source, from) : null
    editRange.current = existing ? { from: existing.from, to: existing.to } : { from, to }
    setGalleryImages(existing?.images ?? (from !== to ? readSelectedImages(source, from, to) : []))
    setColumns(existing?.columns ?? 2)
    setAlign(existing?.align ?? 'center')
    setPanel('gallery')
  }
  function updateCell(row: number, column: number, text: string) {
    setTableCells(previous => previous.map((items, index) => index === row ? items.map((cell, cellIndex) => cellIndex === column ? text : cell) : items))
  }
  function updateImage(index: number, key: 'alt' | 'caption', text: string) {
    setGalleryImages(previous => previous.map((image, imageIndex) => imageIndex === index ? { ...image, [key]: text } : image))
  }
  function moveImage(index: number, delta: number) {
    setGalleryImages(previous => {
      const next = [...previous]
      const target = index + delta
      if (target < 0 || target >= next.length) return previous
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return next
    })
  }
  async function uploadGallery(files: FileList) {
    setUploading(true)
    setUploadError('')
    try {
      for (const file of Array.from(files)) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('JPG, PNG, WebP 이미지만 선택할 수 있습니다.')
        const media = await resourcesApi.upload(file)
        setGalleryImages(previous => [...previous, { src: `/api/media/${media.id}`, alt: file.name.replace(/\.[^.]+$/, ''), caption: '' }])
      }
    } catch (error) { setUploadError(error instanceof Error ? error.message : '이미지 업로드에 실패했습니다.') }
    finally { setUploading(false) }
  }
  async function uploadFile(file: File, expectedKind: 'image' | 'pdf' | 'video') {
    if (disabled || uploading) return
    setUploading(true)
    setUploadError('')
    try {
      const kind = bodyMediaFileKind(file)
      if (kind !== expectedKind) throw new Error('선택한 삽입 도구에 맞는 파일 형식을 선택하세요.')
      const media = await resourcesApi.upload(file)
      const view = viewRef.current
      if (!view) return
      const { start, end } = selectionRef.current
      if (kind !== 'image') rememberBodyMediaPreview(media.id, file, kind)
      replace(kind === 'image' ? insertImageMarkdown(view.state.doc.toString(), start, end, media.id, file.name)
        : insertBodyMediaMarkdown(view.state.doc.toString(), start, end, media.id, file.name, kind))
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : '이미지 업로드에 실패했습니다.')
    } finally { setUploading(false) }
  }
  return <div className="markdownField">
    <label id={id}>{label}</label>
    <div className="editorToolbar" role="toolbar" aria-label={`${label} 서식 도구`}>
      {tools.map(tool => <button key={tool.format} type="button" title={tool.title} aria-label={tool.title} disabled={disabled}
        onMouseDown={event => event.preventDefault()} onClick={() => apply(tool.format)}>{tool.label}</button>)}
      <button type="button" title="이미지 삽입" aria-label="이미지 삽입" disabled={disabled || uploading}
        onMouseDown={event => event.preventDefault()} onClick={() => {
          const selection = viewRef.current?.state.selection.main
          if (selection) selectionRef.current = { start: selection.from, end: selection.to }
          fileRef.current?.click()
        }}>{uploading ? '업로드 중…' : '이미지'}</button>
      <button type="button" aria-label="표 편집" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={openTable}>표</button>
      <button type="button" aria-label="이미지 배치" disabled={disabled || uploading} onMouseDown={event => event.preventDefault()} onClick={openGallery}>이미지 배치</button>
      <input ref={fileRef} className="markdownImageInput" type="file" accept="image/jpeg,image/png,image/webp" tabIndex={-1}
        aria-label={`${label} 이미지 파일`} disabled={disabled || uploading} onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void uploadFile(file, 'image')
        }} />
      {([{ kind: 'pdf', label: 'PDF', accept: 'application/pdf', ref: pdfRef }, { kind: 'video', label: '영상', accept: 'video/mp4', ref: videoRef }] as const).map(tool => <span key={tool.kind}>
        <button type="button" title={`${tool.label} 삽입`} aria-label={`${tool.label} 삽입`} disabled={disabled || uploading} onMouseDown={event => event.preventDefault()} onClick={() => {
          const selection = viewRef.current?.state.selection.main
          if (selection) selectionRef.current = { start: selection.from, end: selection.to }
          tool.ref.current?.click()
        }}>{tool.label}</button>
        <input ref={tool.ref} className="markdownImageInput" type="file" accept={tool.accept} tabIndex={-1} aria-label={`${label} ${tool.label} 파일`} disabled={disabled || uploading} onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void uploadFile(file, tool.kind)
        }} />
      </span>)}
    </div>
    {panel === 'table' && <section className="markdownToolPanel" aria-label="표 편집">
      <h3>표 편집</h3>
      <div className="markdownTableScroll"><table><tbody>{tableCells.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, columnIndex) => <td key={columnIndex}><input aria-label={`${rowIndex === 0 ? '제목' : `${rowIndex}행`} ${columnIndex + 1}열`} value={cell} onChange={event => updateCell(rowIndex, columnIndex, event.target.value)} /></td>)}</tr>)}</tbody></table></div>
      <div className="actions">
        <button type="button" onClick={() => setTableCells(previous => [...previous, Array(previous[0]?.length ?? 1).fill('')])}>행 추가</button>
        <button type="button" disabled={tableCells.length <= 2} onClick={() => setTableCells(previous => previous.slice(0, -1))}>마지막 행 삭제</button>
        <button type="button" onClick={() => setTableCells(previous => previous.map(row => [...row, '']))}>열 추가</button>
        <button type="button" disabled={(tableCells[0]?.length ?? 0) <= 1} onClick={() => setTableCells(previous => previous.map(row => row.slice(0, -1)))}>마지막 열 삭제</button>
      </div>
      <label>스프레드시트 데이터 붙여넣기<textarea value={spreadsheet} onChange={event => setSpreadsheet(event.target.value)} placeholder="탭으로 구분된 셀을 붙여넣으세요" /></label>
      <button type="button" disabled={!spreadsheet.trim()} onClick={() => { setTableCells(parseSpreadsheetCells(spreadsheet)); setSpreadsheet('') }}>데이터 반영</button>
      <div className="actions"><button type="button" onClick={() => {
        const view = viewRef.current
        if (!view) return
        replace(insertTableMarkdown(view.state.doc.toString(), editRange.current.from, editRange.current.to, tableCells))
        setPanel(null)
      }}>본문에 적용</button><button type="button" onClick={() => setPanel(null)}>취소</button></div>
    </section>}
    {panel === 'gallery' && <section className="markdownToolPanel" aria-label="이미지 배치 편집">
      <h3>이미지 배치</h3>
      <div className="actions"><label>열 수<select value={columns} onChange={event => setColumns(Number(event.target.value) as GalleryColumns)}><option value={1}>1열</option><option value={2}>2열</option><option value={3}>3열</option></select></label>
        {columns === 1 && <label>정렬<select value={align} onChange={event => setAlign(event.target.value as GalleryAlign)}><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></select></label>}</div>
      <label>사진 여러 장 추가<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploading} onChange={event => { const files = event.target.files; if (files?.length) void uploadGallery(files); event.target.value = '' }} /></label>
      <ol className="markdownGalleryItems">{galleryImages.map((image, index) => <li key={`${image.src}-${index}`}>
        <PreviewImage src={image.src} alt={image.alt} />
        <label>대체 텍스트<input value={image.alt} onChange={event => updateImage(index, 'alt', event.target.value)} /></label>
        <label>캡션<input value={image.caption} onChange={event => updateImage(index, 'caption', event.target.value)} /></label>
        <div className="actions"><button type="button" aria-label={`${index + 1}번 사진 위로`} disabled={index === 0} onClick={() => moveImage(index, -1)}>위로</button><button type="button" aria-label={`${index + 1}번 사진 아래로`} disabled={index === galleryImages.length - 1} onClick={() => moveImage(index, 1)}>아래로</button><button type="button" onClick={() => setGalleryImages(previous => previous.filter((_, imageIndex) => imageIndex !== index))}>제거</button></div>
      </li>)}</ol>
      <div className="actions"><button type="button" disabled={uploading || galleryImages.length === 0} onClick={() => {
        const view = viewRef.current
        if (!view) return
        replace(insertGalleryMarkdown(view.state.doc.toString(), editRange.current.from, editRange.current.to, galleryImages, columns, align))
        setPanel(null)
      }}>본문에 적용</button><button type="button" disabled={uploading} onClick={() => setPanel(null)}>취소</button></div>
    </section>}
    <div ref={mountRef} className="markdownEditor" role="textbox" aria-labelledby={id} aria-multiline="true" style={{ minHeight: `${Math.max(rows, 3) * 2.4}rem` }} />
    {uploadError && <p className="notice error" role="alert">{uploadError}</p>}
    <div className="markdownRendered" aria-label={`${label} 미리보기`}><ReactMarkdown remarkPlugins={[remarkGfm, remarkDirective, remarkGallery]} skipHtml components={{ img: PreviewImage, div: GalleryPreview, a: MarkdownBodyMedia }}>{value}</ReactMarkdown></div>
  </div>
}
