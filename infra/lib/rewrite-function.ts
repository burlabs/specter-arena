/**
 * CloudFront serves a default root object only at the distribution root, so a request
 * for `/pr-12/` or `/pr-12` would miss the uploaded `/pr-12/index.html`. This viewer-request
 * function maps directory-style paths to their index file. It runs on the CloudFront
 * Functions JavaScript 2.0 runtime, so it is kept as source text.
 */
export const REWRITE_FUNCTION_CODE = `function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (/^\\/pr-\\d+$/.test(uri)) {
    request.uri = uri + '/index.html';
  }
  return request;
}`;
