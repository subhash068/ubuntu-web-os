package engine

import (
	"log"
	"net/http"
)

type Server struct {
	addr       string
	mux        *http.ServeMux
	hub        *Hub
	dbMgr      *DBManager
	dockerMgr  *DockerManager
	dnsManager *DNSManager
	proxy      *ReverseProxy
	gitMgr     *GitManager
}

func NewServer(addr string) *Server {
	mux := http.NewServeMux()
	hub := newHub()
	
	dbMgr, err := NewDBManager("deployments.db")
	if err != nil {
		log.Printf("Warning: failed to initialize database: %v. Running in memory mode.", err)
	}

	dnsManager := NewDNSManager(dbMgr)

	s := &Server{
		addr:       addr,
		mux:        mux,
		hub:        hub,
		dbMgr:      dbMgr,
		dockerMgr:  NewDockerManager(),
		dnsManager: dnsManager,
		gitMgr:     NewGitManager(),
	}
	s.proxy = NewReverseProxy(dnsManager)

	s.routes()

	return s
}

func (s *Server) routes() {
	// REST API routes
	s.mux.HandleFunc("GET /api/status", s.handleStatus())
	s.mux.HandleFunc("POST /api/deploy", s.handleDeploy())
	s.mux.HandleFunc("POST /api/upload", s.handleUpload())
	s.mux.HandleFunc("GET /api/dns/{domain}", s.handleDNSLookup())
	s.mux.HandleFunc("GET /api/deployments", s.handleListDeployments())
	s.mux.HandleFunc("GET /api/logs/{containerID}", s.handleContainerLogs())
	s.mux.HandleFunc("DELETE /api/deployments/{domain}", s.handleDeleteDeployment())
	s.mux.HandleFunc("POST /api/webhooks/github", s.handleGithubWebhook())
	s.mux.HandleFunc("GET /api/system/ip", s.handleSystemIP())
	s.mux.HandleFunc("GET /api/dns/check/{domain}", s.handleDNSCheck())

	// WebSocket route
	s.mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		serveWs(s.hub, w, r)
	})
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) Start() error {
	go s.hub.run()
	
	go func() {
		if err := s.proxy.Start(); err != nil {
			log.Fatalf("Reverse proxy failed: %v", err)
		}
	}()

	log.Printf("Server starting on %s", s.addr)
	return http.ListenAndServe(s.addr, corsMiddleware(s.mux))
}
