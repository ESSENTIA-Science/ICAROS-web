/** Keep in sync with CloudFront's _release gate (Zeno owns the router). */
export function sharedAssetPath(path) {
  return /^(?:_next\/static|assets)\/[a-zA-Z0-9/_.,-]+\.(?:js|css|woff2?|ttf|otf|png|jpe?g|webp|avif|gif|ico|svg|glb|pdf|mp4)$/.test(path) &&
    !path.split('/').some(part => !part || part === '.' || part === '..') &&
    !/^assets\/(?:local-media|proxy-members|private)(?:\/|$)/.test(path) &&
    (!path.startsWith('assets/img/member/') || path === 'assets/img/member/profile.webp')
}
