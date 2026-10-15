/* Browser harness replaces Next routing/image wrappers, preserving native DOM events. */
/* eslint-disable @next/next/no-img-element -- The test exercises native image load/error events. */
import type { ComponentProps } from 'react'
export const usePathname = () => '/'
export function Link({ href, children, scroll, ...props }: ComponentProps<'a'> & { scroll?: boolean }) {
  void scroll
  return <a href={href} {...props}>{children}</a>
}
type TestImageProps = Omit<ComponentProps<'img'>, 'src'> & { src?: string | { src: string; width: number; height: number } }
export function Image({ src, alt, width, height, onError, className, sizes }: TestImageProps) {
  const metadata = typeof src === 'object' ? src : null
  return <img src={typeof src === 'string' ? src : metadata?.src} alt={alt} width={metadata?.width ?? width} height={metadata?.height ?? height} onError={onError} className={className} sizes={sizes} />
}
