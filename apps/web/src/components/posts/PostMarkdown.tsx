/* eslint-disable @next/next/no-img-element -- 정적 스냅샷의 승인된 URL을 그대로 렌더링한다. */
import { Children, isValidElement, type ComponentProps, type ImgHTMLAttributes, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkDirective from 'remark-directive'
import PostImageGallery from './PostImageGallery'
import { remarkGallery } from '../../lib/markdown/gallery'
import BodyMedia, { bodyMediaKind, publicBodyMediaUrl } from './BodyMedia'
import { remarkPostAttachments, type BodyAttachment } from './remarkPostAttachments'

function MarkdownImage({ src, alt, title }: ComponentProps<'img'>) {
  return src ? <img src={src} alt={alt ?? ''} title={title} loading="lazy" decoding="async" /> : null
}

function isImage(node: ReactNode): node is ReactElement<ImgHTMLAttributes<HTMLImageElement>> {
  return isValidElement<ImgHTMLAttributes<HTMLImageElement>>(node) && (node.type === 'img' || node.type === MarkdownImage)
}

function Paragraph({ children }: ComponentProps<'p'>) {
  const nodes = Children.toArray(children).filter(child => typeof child !== 'string' || child.trim())
  const images = nodes.filter(isImage)
  const galleryImages = images.map(image => ({ src: typeof image.props.src === 'string' ? image.props.src : '', alt: image.props.alt ?? '', caption: image.props.title }))
  if (galleryImages.length > 1 && galleryImages.length === nodes.length && galleryImages.every(image => image.src)) {
    return <PostImageGallery images={galleryImages} />
  }
  return <p>{children}</p>
}

function collectImages(node: ReactNode): { src: string; alt: string; caption: string }[] {
  if (!isValidElement<{ src?: string; alt?: string; title?: string; children?: ReactNode }>(node)) return []
  if (node.type === 'img' || node.type === MarkdownImage) return typeof node.props.src === 'string' ? [{ src: node.props.src, alt: node.props.alt ?? '', caption: node.props.title ?? '' }] : []
  return Children.toArray(node.props.children).flatMap(collectImages)
}

function GalleryBlock({ children, ...props }: ComponentProps<'div'>) {
  const columns = Number(props['data-gallery-columns' as keyof typeof props])
  if (![1, 2, 3].includes(columns)) return <div {...props}>{children}</div>
  const align = props['data-gallery-align' as keyof typeof props]
  const images = Children.toArray(children).flatMap(collectImages)
  return images.length ? <PostImageGallery images={images} columns={columns as 1 | 2 | 3} align={align === 'left' || align === 'right' ? align : 'center'} /> : null
}

function linkLabel(node: ReactNode): string {
  return Children.toArray(node).map(child => typeof child === 'string' || typeof child === 'number' ? String(child)
    : isValidElement<{ children?: ReactNode }>(child) ? linkLabel(child.props.children) : '').join('') || '본문 첨부'
}

function MarkdownLink({ href, title, children, ...props }: ComponentProps<'a'> & { 'data-body-media-poster'?: string }) {
  const kind = bodyMediaKind(title)
  const src = kind ? publicBodyMediaUrl(href) : null
  return kind && src ? <BodyMedia src={src} kind={kind} label={linkLabel(children)} posterSrc={props['data-body-media-poster']}>{children}</BodyMedia> : <a href={href} title={title}>{children}</a>
}

export default function PostMarkdown({ content, allowedElements, attachments }: { content: string; allowedElements?: string[]; attachments?: readonly BodyAttachment[] }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm, remarkDirective, [remarkPostAttachments, attachments], remarkGallery]} skipHtml allowedElements={allowedElements} components={{ p: Paragraph, div: GalleryBlock, img: MarkdownImage, a: MarkdownLink }}>{content}</ReactMarkdown>
}
