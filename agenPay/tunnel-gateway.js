const http = require('http');
const { URL } = require('url');

const GATEWAY_PORT = Number(process.env.TUNNEL_GATEWAY_PORT || 8787);
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3001';
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'http://127.0.0.1:3002';

function targetForPath(pathname) {
  if (pathname.startsWith('/backend/')) {
    return { target: BACKEND_URL, stripPrefix: '/backend' };
  }

  if (pathname === '/backend') {
    return { target: BACKEND_URL, stripPrefix: '/backend' };
  }

  if (pathname.startsWith('/facilitator/')) {
    return { target: FACILITATOR_URL, stripPrefix: '/facilitator' };
  }

  if (pathname === '/facilitator') {
    return { target: FACILITATOR_URL, stripPrefix: '/facilitator' };
  }

  return { target: FRONTEND_URL, stripPrefix: '' };
}

function rewritePath(originalPath, stripPrefix) {
  if (!stripPrefix) return originalPath;

  const rewritten = originalPath.slice(stripPrefix.length);
  return rewritten.length > 0 ? rewritten : '/';
}

function proxyRequest(req, res) {
  const reqUrl = new URL(req.url, 'http://localhost');
  const { target, stripPrefix } = targetForPath(reqUrl.pathname);
  const upstreamBase = new URL(target);

  const upstreamPath = rewritePath(reqUrl.pathname, stripPrefix) + reqUrl.search;

  const options = {
    protocol: upstreamBase.protocol,
    hostname: upstreamBase.hostname,
    port: upstreamBase.port,
    method: req.method,
    path: upstreamPath,
    headers: {
      ...req.headers,
      host: upstreamBase.host,
      'x-forwarded-host': req.headers.host || '',
      'x-forwarded-proto': 'https',
      'x-forwarded-prefix': stripPrefix,
    },
  };

  const upstreamReq = http.request(options, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });

  upstreamReq.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'upstream_unreachable',
        message: err.message,
        target,
      })
    );
  });

  req.pipe(upstreamReq);
}

const server = http.createServer(proxyRequest);

server.listen(GATEWAY_PORT, () => {
  console.log(`Tunnel gateway listening on http://127.0.0.1:${GATEWAY_PORT}`);
  console.log(`  / -> ${FRONTEND_URL}`);
  console.log(`  /backend/* -> ${BACKEND_URL} (prefix stripped)`);
  console.log(`  /facilitator/* -> ${FACILITATOR_URL} (prefix stripped)`);
});
