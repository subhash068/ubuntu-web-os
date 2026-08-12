import urllib.request
import urllib.error
import re
from urllib.parse import urljoin
from fastapi import Request, Response

def handle_fastapi_proxy(request: Request, target_url: str, method: str = "GET") -> Response:
    try:
        # Read request body if present
        data = None
        if method in ("POST", "PUT", "PATCH"):
            data = request._body if hasattr(request, "_body") else None
            if not data:
                # Read body asynchronously from request
                # To do this synchronously inside this helper, we do it in main or use request.body()
                pass
                
        # Forward important headers
        headers = {}
        for key, val in request.headers.items():
            if key.lower() not in ["host", "connection", "content-length", "accept-encoding", "cookie"]:
                headers[key] = val
                
        if "User-Agent" not in headers:
            headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            
        req = urllib.request.Request(target_url, data=data, headers=headers, method=method)
        
        with urllib.request.urlopen(req, timeout=15) as response:
            content_type = response.headers.get("Content-Type", "application/octet-stream")
            content = response.read()
            
            if "text/html" in content_type:
                try:
                    html = content.decode("utf-8", errors="ignore")
                    base_url = target_url
                    
                    def replace_url(match):
                        attr = match.group(1)
                        val = match.group(2)
                        if val.startswith("/api/proxy") or val.startswith("/proxy/") or val.startswith("#") or val.startswith("javascript:") or val.startswith("data:"):
                            return match.group(0)
                        absolute = urljoin(base_url, val)
                        if absolute.startswith("https://"):
                            proxy_path = "/proxy/https/" + absolute[8:]
                        elif absolute.startswith("http://"):
                            proxy_path = "/proxy/http/" + absolute[7:]
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
                    if "<head>" in html:
                        html = html.replace("<head>", "<head>" + injection, 1)
                    elif "<html>" in html:
                        html = html.replace("<html>", "<html>" + injection, 1)
                    else:
                        html = injection + html
                        
                    content = html.encode("utf-8", errors="ignore")
                except Exception:
                    pass
                    
            # Build FastAPI response
            res_headers = {}
            skip_headers = ["transfer-encoding", "x-frame-options", "content-security-policy", "access-control-allow-origin", "content-length", "content-encoding"]
            for k, v in response.headers.items():
                if k.lower() not in skip_headers:
                    res_headers[k] = v
                    
            return Response(content=content, status_code=response.getcode(), headers=res_headers, media_type=content_type)
            
    except urllib.error.HTTPError as e:
        res_headers = {}
        skip_headers = ["transfer-encoding", "x-frame-options", "content-security-policy", "access-control-allow-origin", "content-length", "content-encoding"]
        for k, v in e.headers.items():
            if k.lower() not in skip_headers:
                res_headers[k] = v
        content = e.read()
        return Response(content=content, status_code=e.code, headers=res_headers)
        
    except Exception as e:
        error_html = f"<h2>Proxy Error</h2><p>Failed to load URL {target_url}: {str(e)}</p>"
        return Response(content=error_html.encode("utf-8"), status_code=500, media_type="text/html")
