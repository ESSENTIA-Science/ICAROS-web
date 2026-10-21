import type { Root } from 'mdast'

type Node = {
  type: string
  value?: string
  position?: { start: { offset?: number }; end: { offset?: number } }
  children?: Node[]
}

// remark-directive는 "14:30", "결과:성공" 같은 일반 문장의 콜론도 directive로 해석한다.
// text·leaf directive는 원문 그대로 되돌리고, 갤러리 등 container directive만 남긴다.
export function remarkRestoreTextDirectives() {
  return (tree: Root, file: { value?: unknown }) => {
    const source = typeof file.value === 'string' ? file.value : ''
    const raw = (node: Node): string | null => {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      return start === undefined || end === undefined ? null : source.slice(start, end)
    }
    const visit = (node: Node) => {
      if (!node.children) return
      node.children = node.children.map(child => {
        if (child.type !== 'textDirective' && child.type !== 'leafDirective') {
          visit(child)
          return child
        }
        const value = raw(child) ?? ''
        const text: Node = { type: 'text', value }
        return child.type === 'leafDirective' ? { type: 'paragraph', children: [text] } : text
      })
    }
    visit(tree as Node)
  }
}
