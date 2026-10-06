function handler(event) {
  var request = event.request;
  // No bucket-root listing, raw UUID source keys, or proxy-only portraits.
  if ((request.method !== 'GET' && request.method !== 'HEAD') ||
      !/^\/published\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[a-f0-9]{64}\.(?:jpe?g|png|webp|avif|gif|mp4|glb|pdf)$/.test(request.uri)) {
    return { statusCode: 404, statusDescription: 'Not Found' };
  }
  return request;
}
