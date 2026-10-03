/** CMS CTA targets stay on the public site or jump to an existing home section. */
export function isInternalCtaHref(value: string): boolean {
  return value === '#support' || value === '#contact' ||
    /^\/(?:vehicles|missions|posts|member)(?:\/[a-zA-Z0-9_-]+){0,3}\/?$/.test(value)
}
