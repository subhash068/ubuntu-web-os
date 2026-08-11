package engine

import (
	"context"
	"crypto/tls"
	"errors"
	"log"
	"strings"
	"net/http"
	"net/http/httputil"

	"golang.org/x/crypto/acme/autocert"
)

// ReverseProxy handles routing incoming requests based on the Host header and automated SSL
type ReverseProxy struct {
	dnsManager *DNSManager
}

// NewReverseProxy creates a new instance of ReverseProxy
func NewReverseProxy(dnsManager *DNSManager) *ReverseProxy {
	return &ReverseProxy{
		dnsManager: dnsManager,
	}
}

// Start initializes and runs the reverse proxy server
func (p *ReverseProxy) Start() error {
	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			// Strip port from Host header if present
			host := req.Host
			if strings.Contains(host, ":") {
				host = strings.Split(host, ":")[0]
			}

			ip, err := p.dnsManager.GetRecord(host)
			if err != nil {
				log.Printf("Proxy error: Domain not found for Host '%s'", host)
				req.URL.Scheme = "http"
				req.URL.Host = "0.0.0.0"
				return
			}

			req.URL.Scheme = "http"
			req.URL.Host = ip
			// We intentionally do NOT overwrite req.Host so the backend and the ErrorHandler 
			// see the original domain name (e.g., my-app.com)

			log.Printf("Proxying request for %s to %s", req.Host, req.URL.Host)
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			host := r.Host
			if strings.Contains(host, ":") {
				host = strings.Split(host, ":")[0]
			}

			log.Printf("Reverse Proxy error for %s: %v", host, err)

			_, dnsErr := p.dnsManager.GetRecord(host)
			if dnsErr != nil {
				http.Error(w, "502 Site Not Found", http.StatusBadGateway)
				return
			}

			http.Error(w, "503 Service Unavailable (Container offline)", http.StatusServiceUnavailable)
		},
	}

	// Autocert manager configuration
	manager := &autocert.Manager{
		Prompt: autocert.AcceptTOS,
		Cache:  autocert.DirCache("certs"),
		HostPolicy: func(ctx context.Context, host string) error {
			// Skip Let's Encrypt for local domains, localhost, or raw IPs
			if host == "localhost" || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".localhost") {
				return errors.New("cannot request certificates for local/internal domains")
			}
			_, err := p.dnsManager.GetRecord(host)
			if err != nil {
				return errors.New("host not configured in our DNS manager")
			}
			return nil
		},
	}

	// Start HTTP server on port 80 to answer ACME challenges and redirect public traffic to HTTPS
	go func() {
		log.Println("Starting HTTP server on port 80 for ACME challenges and HTTPS redirection...")
		
		// Fallback handler for non-ACME challenge requests on port 80
		fallback := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			host := r.Host
			if strings.Contains(host, ":") {
				host = strings.Split(host, ":")[0]
			}
			
			// If it's a local testing domain or localhost, proxy it directly via HTTP (no HTTPS needed/available)
			if host == "localhost" || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".localhost") {
				proxy.ServeHTTP(w, r)
				return
			}
			
			// Otherwise, redirect public domain requests to secure HTTPS
			target := "https://" + r.Host + r.URL.RequestURI()
			log.Printf("Redirecting HTTP request for %s to %s", r.Host, target)
			http.Redirect(w, r, target, http.StatusMovedPermanently)
		})

		err := http.ListenAndServe(":80", manager.HTTPHandler(fallback))
		if err != nil {
			log.Printf("Port 80 server failed: %v", err)
		}
	}()

	// Start HTTPS proxy server on port 443
	server := &http.Server{
		Addr:    ":443",
		Handler: proxy,
		TLSConfig: &tls.Config{
			GetCertificate: manager.GetCertificate,
		},
	}

	log.Printf("Reverse Proxy starting on port :443 (HTTPS)")
	return server.ListenAndServeTLS("", "")
}
