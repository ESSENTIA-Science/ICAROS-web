import cf from 'cloudfront';
const kvs = cf.kvs();

async function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri === '/admin' || uri.indexOf('/admin/') === 0 ||
      uri === '/api' || uri.indexOf('/api/') === 0) return request;
  if (uri.indexOf('/__releases/') === 0 || uri.indexOf('/__staging/') === 0) {
    return { statusCode: 404, statusDescription: 'Not Found' };
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
