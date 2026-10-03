import cf from 'cloudfront';
const kvs = cf.kvs();

async function handler(event) {
  var request = event.request;
  var uri = request.uri;
  // Never let origin-key prefixes or noncanonical paths become public routes.
  // Reject encoded separators/dots/percent signs, including nested encoding.
  if (typeof uri !== 'string' || uri.charAt(0) !== '/' ||
      /[\\\u0000-\u001f\u007f?#]/.test(uri) || uri.indexOf('//') !== -1 ||
      /%(?:2e|2f|5c|25)/i.test(uri)) {
    return { statusCode: 404, statusDescription: 'Not Found' };
  }
  var decoded;
  try { decoded = decodeURIComponent(uri); } catch (error) {
    return { statusCode: 404, statusDescription: 'Not Found' };
  }
  if (/[\\\u0000-\u001f\u007f?#]/.test(decoded) ||
      /(?:^|\/)\.{1,2}(?:\/|$)/.test(decoded) ||
      /^\/(?:releases|release-assets|__release-assets|__releases|__staging|snapshots)(?:\/|$)/i.test(decoded)) {
    return { statusCode: 404, statusDescription: 'Not Found' };
  }
  if (/^\/(?:compat-media-index|published-member-media|manifest|snapshot)\.json$/i.test(decoded)) {
    return { statusCode: 404, statusDescription: 'Not Found' };
  }
  // Next export's RSC metadata uses !/$ only inside a bounded __next basename.
  // Directory segments stay strict; arbitrary punctuation paths fail closed.
  var rsc = /^(?:\/[a-zA-Z0-9_.,-]+)*\/__next\.[a-zA-Z0-9_.,!$-]+\.txt$/.test(decoded);
  if (/[!$]/.test(decoded) && !rsc) {
    return { statusCode: 404, statusDescription: 'Not Found' };
  }
  if (rsc) uri = decoded;
  // Other public behaviors own the CMS redirect and the UUID-only API proxy.
  // Never let a missing association expose these routes through the FE origin.
  if (/^\/(?:admin|api)(?:\/|$)/i.test(decoded)) {
    return { statusCode: 404, statusDescription: 'Not Found' };
  }
  if (decoded.indexOf('/_release') === 0) {
    var scoped = /^\/_release\/([a-f0-9]{64})\/((?:_next\/static|assets)\/[a-zA-Z0-9/_.,-]+\.(?:js|css|woff2?|ttf|otf|png|jpe?g|webp|avif|gif|ico|svg|glb|pdf|mp4))$/.exec(uri);
    if (!scoped) return { statusCode: 404, statusDescription: 'Not Found' };
    if (/^assets\/(?:local-media|proxy-members|private)(?:\/|$)/.test(scoped[2]) ||
        (/^assets\/img\/member\//.test(scoped[2]) && scoped[2] !== 'assets/img/member/profile.webp')) {
      return { statusCode: 404, statusDescription: 'Not Found' };
    }
    request.uri = '/release-assets/' + scoped[1] + '/' + scoped[2];
    return request;
  }
  var release;
  try { release = await kvs.get('release'); } catch (error) {
    return { statusCode: 503, statusDescription: 'Service Unavailable' };
  }
  if (!/^releases\/v[1-9][0-9]*-[a-f0-9]{64}$/.test(release)) {
    return { statusCode: 503, statusDescription: 'Service Unavailable' };
  }
  if (uri === '/') uri = '/index.html';
  else if (uri.charAt(uri.length - 1) === '/') uri += 'index.html';
  else if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) uri += '/index.html';
  request.uri = '/' + release + uri;
  return request;
}
