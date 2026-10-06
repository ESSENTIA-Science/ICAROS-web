import type { Root } from 'mdast'

type Directive = {
  type: string
  name?: string
  value?: string
  attributes?: Record<string, string | null> | null
  data?: { hName?: string; hProperties?: Record<string, string> }
  children?: Directive[]
}

function imageCount(node: Directive): number {
  if (node.type !== 'paragraph' || !node.children?.length ||
      node.children.some(child => child.type !== 'image' && (child.type !== 'text' || child.value?.trim()))) return 0
  return node.children.filter(child => child.type === 'image').length
}

export function remarkGallery() {
  return (tree: Root) => {
    const visit = (node: Directive) => {
      if (node.type === 'containerDirective' && node.name === 'gallery') {
        const columns = node.attributes?.columns
        const align = node.attributes?.align ?? 'center'
        if (['1', '2', '3'].includes(columns ?? '') && ['left', 'center', 'right'].includes(align)) {
          const data = node.data ?? (node.data = {})
          data.hName = 'div'
          data.hProperties = { 'data-gallery-columns': columns!, 'data-gallery-align': align }
        }
        return
      }
      const children = node.children
      if (!children) return
      for (let index = 0; index < children.length;) {
        if (!imageCount(children[index]!)) { visit(children[index]!); index++; continue }
        let end = index
        let count = 0
        while (end < children.length && imageCount(children[end]!)) count += imageCount(children[end++]!)
        if (count > 1) {
          const gallery: Directive = {
            type: 'containerDirective', name: 'gallery', attributes: { columns: '2', align: 'center' },
            children: children.splice(index, end - index),
          }
          children.splice(index, 0, gallery)
          visit(gallery)
        }
        index++
      }
    }
    visit(tree as unknown as Directive)
  }
}
