import type { Root, RootContent } from 'mdast'
import { publicBodyMediaUrl } from './BodyMedia'

export type BodyAttachment = { kind: 'image' | 'pdf' | 'video'; src: string; title: string; posterSrc?: string | null; width?: number; height?: number }
type Node = { type: string; url?: string; identifier?: string; children?: Node[]; data?: { hProperties?: Record<string, unknown> } }

/** Append metadata-only media as Markdown nodes; parsed body references take precedence. */
export function remarkPostAttachments(attachments: readonly BodyAttachment[] = []) {
  return (tree: Root) => {
    const definitions = new Map<string, string>()
    const visit = (node: Node, read: (node: Node) => void) => { read(node); node.children?.forEach(child => visit(child, read)) }
    visit(tree, node => {
      if (node.type === 'definition' && node.identifier && node.url) definitions.set(node.identifier.toLowerCase(), node.url)
    })
    const used = new Set<string>()
    const images = new Map(attachments.filter(attachment => attachment.kind === 'image').map(attachment => [publicBodyMediaUrl(attachment.src), attachment]))
    visit(tree, node => {
      const url = node.type === 'image' || node.type === 'link' ? node.url
        : node.type === 'imageReference' || node.type === 'linkReference' ? definitions.get(node.identifier?.toLowerCase() ?? '') : null
      const src = url ? publicBodyMediaUrl(url) : null
      if (src) {
        used.add(src)
        const attachment = images.get(src)
        if ((node.type === 'image' || node.type === 'imageReference') && attachment?.width && attachment.height) {
          node.data = { ...node.data, hProperties: { ...node.data?.hProperties, width: attachment.width, height: attachment.height } }
        }
      }
    })
    for (const attachment of attachments) {
      const src = publicBodyMediaUrl(attachment.src)
      if (!src || used.has(src) || !['image', 'pdf', 'video'].includes(attachment.kind)) continue
      const child: RootContent = { type: 'paragraph', children: [attachment.kind === 'image'
        ? { type: 'image', url: src, alt: attachment.title, data: { hProperties: { width: attachment.width, height: attachment.height } } }
        : { type: 'link', url: src, title: `icaros:${attachment.kind}`, children: [{ type: 'text', value: attachment.title }],
          data: { hProperties: { 'data-body-media-poster': attachment.kind === 'video' ? publicBodyMediaUrl(attachment.posterSrc ?? undefined) ?? undefined : undefined } } }] }
      tree.children.push(child)
      used.add(src)
    }
  }
}
