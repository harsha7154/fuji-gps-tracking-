const { getDefaultConfig } = require('expo/metro-config');
const https = require('https');
const http = require('http');

const config = getDefaultConfig(__dirname);

config.server = config.server || {};
const originalEnhanceMiddleware = config.server.enhanceMiddleware;

config.server.enhanceMiddleware = (middleware, server) => {
  const enhanced = originalEnhanceMiddleware
    ? originalEnhanceMiddleware(middleware, server)
    : middleware;

  return (req, res, next) => {
    if (req.url && req.url.startsWith('/__api_proxy__/')) {
      const requestPath = req.url.replace('/__api_proxy__/', '');

      let liferayBaseUrl = process.env.EXPO_PUBLIC_LIFERAY_BASE_URL || 'https://13.233.171.171:8443';
      try {
        const fs = require('fs');
        const envPath = require('path').join(__dirname, '.env');
        const envFile = fs.readFileSync(envPath, 'utf8');
        const match = envFile.match(/^EXPO_PUBLIC_LIFERAY_BASE_URL=(.*)$/m);
        if (match) {
          liferayBaseUrl = match[1].trim();
        }
      } catch (e) {
        // ignore
      }

      const targetUrl = new URL(requestPath, liferayBaseUrl);
      const isHttps = targetUrl.protocol === 'https:';
      const defaultPort = isHttps ? 443 : 80;

      const options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || defaultPort,
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers: {
          ...req.headers,
          host: `${targetUrl.hostname}:${targetUrl.port || defaultPort}`,
        },
      };

      if (isHttps) {
        options.rejectUnauthorized = false;
      }

      // CORS Preflight handling
      if (req.method === 'OPTIONS') {
        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
          'Access-Control-Allow-Headers': '*',
        });
        return res.end();
      }

      const requestModule = isHttps ? https : require('http');

      console.log(`[Metro API Proxy] Forwarding ${req.method} ${requestPath} -> ${targetUrl.toString()}`);

      const proxyReq = requestModule.request(options, (proxyRes) => {
        const responseHeaders = {
          ...proxyRes.headers,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
          'Access-Control-Allow-Headers': '*',
        };

        console.log(`[Metro API Proxy] Received ${proxyRes.statusCode} from ${targetUrl.toString()}`);

        res.writeHead(proxyRes.statusCode || 500, responseHeaders);
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.error('[Metro API Proxy Error]:', err.message);
        res.writeHead(502, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ error: err.message }));
      });

      req.pipe(proxyReq);
      return;
    }

    return enhanced(req, res, next);
  };
};

module.exports = config;
