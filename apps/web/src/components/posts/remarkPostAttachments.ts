import type { Root, RootContent } from 'mdast'
import { publicBodyMediaUrl } from './BodyMedia'

export type BodyAttachment = { kind: 'image' | 'pdf' | 'video'; src: string; title: string; posterSrc?: string | null }
type Node = { type: string; url?: string; identifier?: string; children?: Node[] }

/** Append metadata-only media as Markdown nodes; parsed body references take precedence. */
export function remarkPostAttachments(attachments: readonly BodyAttachment[] = []) {
  return (tree: Root) => {
    const definitions = new Map<string, string>()
    const visit = (node: Node, read: (node: Node) => void) => { read(node); node.children?.forEach(child => visit(child, read)) }
    visit(tree, node => {
      if (node.type === 'definition' && node.identifier && node.url) definitions.set(node.identifier.toLowerCase(), node.url)
    })
    const used = new Set<string>()
    visit(tree, node => {
      const url = node.type === 'image' || node.type === 'link' ? node.url
        : node.type === 'imageReference' || node.type === 'linkReference' ? definitions.get(node.identifier?.toLowerCase() ?? '') : null
      const src = url ? publicBodyMediaUrl(url) : null
      if (src) used.add(src)
    })
    for (const attachment of attachments) {
      const src = publicBodyMediaUrl(attachment.src)
      if (!src || used.has(src) || !['image', 'pdf', 'video'].includes(attachment.kind)) continue
      const child: RootContent = { type: 'paragraph', children: [attachment.kind === 'image'
        ? { type: 'image', url: src, alt: attachment.title }
        : { type: 'link', url: src, title: `icaros:${attachment.kind}`, children: [{ type: 'text', value: attachment.title }],
          data: { hProperties: { 'data-body-media-poster': attachment.kind === 'video' ? publicBodyMediaUrl(attachment.posterSrc ?? undefined) ?? undefined : undefined } } }] }
      tree.children.push(child)
      used.add(src)
    }
  }
}
