import urllib.request
import urllib.error
import re
from urllib.parse import urljoin

def handle_proxy_request(handler, target_url, method='GET'):
    try:
        # Read request body if present
        data = None
        content_length = handler.headers.get('Content-Length')
        if content_length:
            data = handler.rfile.read(int(content_length))

        # Forward important headers
        headers = {}
        for key in handler.headers:
            if key.lower() not in ['host', 'connection', 'content-length']:
                headers[key] = handler.headers[key]
                
        # Fallback User-Agent if none provided
        if 'User-Agent' not in headers:
            headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

        req = urllib.request.Request(target_url, data=data, headers=headers, method=method)
        
        with urllib.request.urlopen(req, timeout=15) as response:
            content_type = response.headers.get('Content-Type', 'application/octet-stream')
            content = response.read()
            
            if 'text/html' in content_type:
                try:
                    html = content.decode('utf-8', errors='ignore')
                    base_url = target_url
                    
                    def replace_url(match):
                        attr = match.group(1)
                        val = match.group(2)
                        if val.startswith('/api/proxy') or val.startswith('/proxy/') or val.startswith('#') or val.startswith('javascript:') or val.startswith('data:'):
                            return match.group(0)
                        absolute = urljoin(base_url, val)
                        if absolute.startswith('https://'):
                            proxy_path = '/proxy/https/' + absolute[8:]
                        elif absolute.startswith('http://'):
                            proxy_path = '/proxy/http/' + absolute[7:]
                        else:
                            proxy_path = absolute
                        return f'{attr}="{proxy_path}"'
                        
                    html = re.sub(r'(href|src|action)=["\']([^"\']+)["\']', replace_url, html)
                    
                    # Inject fetch/XHR overrides
                    injection = """<script>
(function() {
    const origin = window.location.origin;
    const proxyPrefixHttps = origin + '/proxy/https/';
    const proxyPrefixHttp = origin + '/proxy/http/';

    function toProxyUrl(url) {
        if (!url) return url;
        let str = String(url);
        if (str.startsWith(proxyPrefixHttps) || str.startsWith(proxyPrefixHttp) || str.startsWith(origin + '/api/proxy')) {
            return url;
        }
        let absUrl;
        try {
            absUrl = new URL(url, window.location.href).href;
        } catch(e) {
            return url;
        }
        if (absUrl.startsWith('https://')) {
            return proxyPrefixHttps + absUrl.substring(8);
        } else if (absUrl.startsWith('http://')) {
            return proxyPrefixHttp + absUrl.substring(7);
        }
        return url;
    }

    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        if (typeof input === 'string') {
            input = toProxyUrl(input);
        } else if (input && input.url) {
            try {
                const newUrl = toProxyUrl(input.url);
                input = new Request(newUrl, input);
            } catch(e) {}
        }
        return originalFetch(input, init);
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
        url = toProxyUrl(url);
        return originalOpen.apply(this, arguments);
    };
})();
</script>"""
                    if '<head>' in html:
                        html = html.replace('<head>', '<head>' + injection, 1)
                    elif '<html>' in html:
                        html = html.replace('<html>', '<html>' + injection, 1)
                    else:
                        html = injection + html
                        
                    content = html.encode('utf-8', errors='ignore')
                except Exception:
                    pass
                    
            handler.send_response(response.getcode())
            
            # Forward headers back, but strip restrictive ones
            skip_headers = ['transfer-encoding', 'x-frame-options', 'content-security-policy', 'access-control-allow-origin', 'content-length', 'content-encoding']
            for k, v in response.headers.items():
                if k.lower() not in skip_headers:
                    handler.send_header(k, v)
                    
            handler.send_header('Content-Length', str(len(content)))
            handler.end_headers()
            handler.wfile.write(content)
            return
            
    except urllib.error.HTTPError as e:
        handler.send_response(e.code)
        
        # Forward headers back, stripping restrictive ones
        skip_headers = ['transfer-encoding', 'x-frame-options', 'content-security-policy', 'access-control-allow-origin', 'content-length', 'content-encoding']
        for k, v in e.headers.items():
            if k.lower() not in skip_headers:
                handler.send_header(k, v)
                
        content = e.read()
        handler.send_header('Content-Length', str(len(content)))
        handler.end_headers()
        handler.wfile.write(content)
        return
        
    except Exception as e:
        handler.send_response(500)
        handler.send_header('Content-Type', 'text/html')
        handler.end_headers()
        handler.wfile.write(f"<h2>Proxy Error</h2><p>Failed to load URL {target_url}: {str(e)}</p>".encode('utf-8'))
        return
