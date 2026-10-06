import type { Root } from 'mdast'

type Directive = {
  type: string
  name?: string
  attributes?: Record<string, string | null> | null
  data?: { hName?: string; hProperties?: Record<string, string> }
  children?: Directive[]
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
      }
      node.children?.forEach(visit)
    }
    visit(tree as unknown as Directive)
  }
}
