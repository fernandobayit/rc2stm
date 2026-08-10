const { serveHTTP } = require('stremio-addon-sdk');
const http = require('http');
const httpProxy = require('http-proxy');
const axios = require('axios');
const addon = require('./index');

const PORT = process.env.PORT || 8000;
const INTERNAL_PORT = 8001;

serveHTTP(addon, { port: INTERNAL_PORT }, () => {
    console.log(`Stremio addon running internally on port ${INTERNAL_PORT}`);
});

const proxy = httpProxy.createProxyServer({ target: `http://127.0.0.1:${INTERNAL_PORT}` });

const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
    
    if (parsedUrl.pathname === '/proxy') {
        const targetUrl = parsedUrl.searchParams.get('url');
        if (!targetUrl) { res.writeHead(400, {'Content-Type': 'text/plain'}); res.end('Missing url'); return; }
        
        try {
            const isPlaylist = targetUrl.endsWith('.m3u8') || targetUrl.includes('.m3u8?');
            const response = await axios.get(targetUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Referer': new URL(targetUrl).origin + '/' },
                responseType: isPlaylist ? 'text' : 'arraybuffer', timeout: 15000, maxRedirects: 5
            });
            
            const contentType = response.headers['content-type'] || (isPlaylist ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
            
            if (isPlaylist) {
                let body = response.data;
                const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
                const proxyBase = `http://${req.headers.host}/proxy?url=`;
                body = body.split('\n').map(line => {
                    const trimmed = line.trim();
                    if (trimmed && !trimmed.startsWith('#')) {
                        let fullUrl = trimmed.startsWith('http') ? trimmed : trimmed.startsWith('/') ? new URL(trimmed, targetUrl).href : baseUrl + trimmed;
                        return `${proxyBase}${encodeURIComponent(fullUrl)}`;
                    }
                    if (trimmed.startsWith('#') && trimmed.includes('URI="')) {
                        return trimmed.replace(/URI="([^"]+)"/g, (m, uri) => {
                            let fullUri = uri.startsWith('http') ? uri : uri.startsWith('/') ? new URL(uri, targetUrl).href : baseUrl + uri;
                            return `URI="${proxyBase}${encodeURIComponent(fullUri)}"`;
                        });
                    }
                    return line;
                }).join('\n');
                res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
                res.end(body);
            } else {
                res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*', 'Content-Length': response.data.length });
                res.end(response.data);
            }
        } catch (e) {
            console.error('Proxy error:', targetUrl.substring(0, 80), e.message);
            res.writeHead(502, {'Content-Type': 'text/plain'}); res.end('Proxy error: ' + e.message);
        }
        return;
    }
    proxy.web(req, res);
});

proxy.on('error', (err, req, res) => {
    if (!res.headersSent) { res.writeHead(502, {'Content-Type': 'text/plain'}); res.end('Bad gateway: ' + err.message); }
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/manifest.json`);
});