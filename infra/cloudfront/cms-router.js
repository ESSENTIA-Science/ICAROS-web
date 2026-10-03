function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (typeof uri !== 'string' || /[\\%\u0000-\u001f\u007f?#]/.test(uri) ||
      uri.indexOf('//') !== -1 || /(?:^|\/)\.{1,2}(?:\/|$)/.test(uri)) {
    return { statusCode: 404, statusDescription: 'Not Found' };
  }
  if (uri === '/api' || uri.indexOf('/api/') === 0) {
    return { statusCode: 404, statusDescription: 'Not Found' };
  }
  if (uri === '/' || uri === '/admin/') request.uri = '/admin/index.html';
  else if (uri === '/admin') return { statusCode: 308, statusDescription: 'Permanent Redirect',
    headers: { location: { value: '/admin/' }, 'cache-control': { value: 'private, no-store' } } };
  else if (!/^\/admin\/[a-zA-Z0-9/_.,-]+$/.test(uri)) return { statusCode: 404, statusDescription: 'Not Found' };
  return request;
}
