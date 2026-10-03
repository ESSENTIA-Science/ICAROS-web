import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PublicationControls, { warnBeforeLeaving } from './PublicationControls'
import { completeCmsPublication, getCmsChanges, noteCmsChange, startCmsPublication } from '../lib/cmsChanges'

it('places one global publication action alongside the saving state', () => {
  const html = renderToStaticMarkup(<PublicationControls />)
  expect(html).toContain('변경사항 반영하기')
  expect(html).not.toContain('사이트 전체 게시</button>')
})

it('warns before closing with unpublished edits or an outstanding publication request', () => {
  const preventDefault = vi.fn()
  const event = { preventDefault, returnValue: undefined } as unknown as BeforeUnloadEvent
  noteCmsChange()
  warnBeforeLeaving(event)
  expect(preventDefault).toHaveBeenCalledTimes(1)
  startCmsPublication('warning-test', getCmsChanges().revision)
  completeCmsPublication('warning-test')
  preventDefault.mockClear()
  warnBeforeLeaving(event)
  expect(preventDefault).not.toHaveBeenCalled()
  warnBeforeLeaving(event, true)
  expect(preventDefault).toHaveBeenCalledTimes(1)
})
