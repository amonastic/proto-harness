const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const rootDir = path.resolve(__dirname, '..');
const DEFAULT_PORT = 18765;
const port = Number(process.argv[2] || process.env.PORT || DEFAULT_PORT);
const maxPort = port + 20;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pdf': 'application/pdf'
};

function sendNoStoreHeaders(response, statusCode, contentType) {
  response.writeHead(statusCode, {
    'Content-Type': contentType || 'application/octet-stream',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Content-Type-Options': 'nosniff'
  });
}

function resolveRequestPath(requestUrl) {
  const url = new URL(requestUrl, `http://localhost:${port}`);
  const decodedPath = decodeURIComponent(url.pathname);
  const normalizedPath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.resolve(rootDir, `.${normalizedPath}`);

  if (!filePath.startsWith(rootDir + path.sep) && filePath !== rootDir) {
    return null;
  }

  return filePath;
}

function handleRequest(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendNoStoreHeaders(response, 405, 'text/plain; charset=utf-8');
    response.end('Method Not Allowed');
    return;
  }

  let filePath = resolveRequestPath(request.url);
  if (!filePath) {
    sendNoStoreHeaders(response, 403, 'text/plain; charset=utf-8');
    response.end('Forbidden');
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch (error) {
    sendNoStoreHeaders(response, 404, 'text/plain; charset=utf-8');
    response.end('Not Found');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendNoStoreHeaders(response, 404, 'text/plain; charset=utf-8');
      response.end('Not Found');
      return;
    }

    const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    sendNoStoreHeaders(response, 200, contentType);
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    response.end(data);
  });
}

function listen(targetPort) {
  const server = http.createServer(handleRequest);

  server.once('error', error => {
    if (error.code === 'EADDRINUSE' && targetPort < maxPort) {
      listen(targetPort + 1);
      return;
    }

    console.error(`Failed to start local server on port ${targetPort}: ${error.message}`);
    process.exitCode = 1;
  });

  server.listen(targetPort, () => {
    console.log(`Local no-cache server running at http://127.0.0.1:${targetPort}/`);
    if (targetPort !== port) {
      console.log(`Port ${port} was busy; using ${targetPort} instead.`);
    }
    console.log(`Workspace root: ${rootDir}`);
  });
}

listen(port);
