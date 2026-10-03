function handler(event) {
  var request = event.request;
  if ((request.method !== 'GET' && request.method !== 'HEAD') ||
      !/^\/api\/media\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(request.uri)) {
    return { statusCode: 404, statusDescription: 'Not Found',
      headers: { 'cache-control': { value: 'private, no-store' } } };
  }
  return request;
}
