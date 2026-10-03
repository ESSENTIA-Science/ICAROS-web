// Template renderer replaces this origin from a private, validated parameter.
const cmsOrigin = '__CMS_ORIGIN__';
function handler(event) {
  var request = event.request;
  if (!/^https:\/\/[a-zA-Z0-9.-]+$/.test(cmsOrigin) ||
      !/^\/admin(?:\/[a-zA-Z0-9/_.,-]*)?$/.test(request.uri) ||
      /(?:^|\/)\.{1,2}(?:\/|$)/.test(request.uri) || request.uri.indexOf('//') !== -1) {
    return { statusCode: 404, statusDescription: 'Not Found' };
  }
  // Drop legacy queries: public URLs must not carry auth codes or editor state across origins.
  return { statusCode: 308, statusDescription: 'Permanent Redirect',
    headers: { location: { value: cmsOrigin + '/admin/' },
      'cache-control': { value: 'private, no-store' } } };
}
