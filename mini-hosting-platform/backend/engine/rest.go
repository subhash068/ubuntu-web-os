package engine

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type StatusResponse struct {
	Status string `json:"status"`
	Uptime string `json:"uptime"`
}

func (s *Server) handleStatus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		resp := StatusResponse{
			Status: "OK",
			Uptime: "100%", // Mock value
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

type DeployRequest struct {
	Domain    string            `json:"domain"`
	ImageName string            `json:"imageName,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
	GithubUrl string            `json:"githubUrl,omitempty"`
	Replicas  int               `json:"replicas,omitempty"`
}

type DeployResponse struct {
	Domain      string `json:"domain"`
	IP          string `json:"ip"`
	ContainerID string `json:"containerID"`
	Error       string `json:"error,omitempty"`
}

func (s *Server) handleDeploy() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req DeployRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Read base domain configuration from environment
		baseDomain := os.Getenv("BASE_DOMAIN")
		if baseDomain == "" {
			baseDomain = "localhost"
		}

		rawDomain := strings.TrimSpace(req.Domain)
		if rawDomain == "" {
			// Auto-generate subdomain if domain input is blank
			rawDomain = fmt.Sprintf("app-%d.%s", time.Now().Unix(), baseDomain)
		}

		domains := parseDomains(rawDomain)
		if len(domains) == 0 {
			http.Error(w, "At least one valid domain is required", http.StatusBadRequest)
			return
		}

		imageToRun := req.ImageName
		if req.GithubUrl != "" && s.gitMgr != nil {
			// Generate temp dir
			tempDir, err := os.MkdirTemp("", "git-*")
			if err == nil {
				defer os.RemoveAll(tempDir)
				if err := s.gitMgr.Clone(req.GithubUrl, tempDir); err == nil {
					// Build it
					imageName := fmt.Sprintf("git-%s", domains[0])
					if err := s.dockerMgr.BuildImage(tempDir, imageName); err == nil {
						imageToRun = imageName
					} else {
						log.Printf("Failed to build git repo: %v", err)
					}
				} else {
					log.Printf("Failed to clone git repo: %v", err)
				}
			}
		}

		if imageToRun == "" {
			imageToRun = "nginx:alpine" // Fallback to default
		}

		// Cleanup: Check if any of the target domains are already deployed in another container group
		if s.dbMgr != nil {
			for _, dom := range domains {
				oldDep, err := s.dbMgr.GetDeploymentByDomain(dom)
				if err == nil && oldDep != nil {
					log.Printf("Domain %s is already deployed under container group %s. Cleaning up old containers.", dom, oldDep.ContainerID)
					
					// Stop all replicas of the old conflicting deployment
					ids := strings.Split(oldDep.ContainerID, ",")
					for _, id := range ids {
						trimmed := strings.TrimSpace(id)
						if trimmed != "" {
							s.dockerMgr.StopContainer(trimmed)
						}
					}

					// Remove from DB
					s.dbMgr.DeleteDeployment(dom)

					// Unregister all associated domains of the old deployment from DNSManager
					oldDoms := parseDomains(oldDep.Domain)
					for _, od := range oldDoms {
						s.dnsManager.RemoveRecord(od)
					}
				}
			}
		}

		var containerIDs []string
		var targetAddrs []string
		replicas := req.Replicas
		if replicas <= 0 {
			replicas = 1
		}

		for i := 0; i < replicas; i++ {
			id, ip, err := s.dockerMgr.RunContainer(imageToRun, req.Env)
			if err != nil {
				// Clean up any partially created containers
				for _, cleanId := range containerIDs {
					s.dockerMgr.StopContainer(cleanId)
				}
				http.Error(w, fmt.Sprintf("Failed to spin up container replica %d: %v", i+1, err), http.StatusInternalServerError)
				return
			}
			containerIDs = append(containerIDs, id)
			targetAddrs = append(targetAddrs, ip)
		}

		joinedIDs := strings.Join(containerIDs, ",")
		joinedAddrs := strings.Join(targetAddrs, ",")

		// Map all domains in DNS manager
		for _, dom := range domains {
			if err := s.dnsManager.AddRecord(dom, joinedAddrs); err != nil {
				for _, cleanId := range containerIDs {
					s.dockerMgr.StopContainer(cleanId) // Rollback
				}
				http.Error(w, "Failed to map DNS: "+err.Error(), http.StatusConflict)
				return
			}
		}

		joinedDomains := strings.Join(domains, ",")

		if s.dbMgr != nil {
			if err := s.dbMgr.SaveDeployment(&Deployment{
				Domain:        joinedDomains,
				ContainerID:   joinedIDs,
				ImageName:     imageToRun,
				TargetAddr:    joinedAddrs,
				GithubRepoUrl: req.GithubUrl,
			}); err != nil {
				s.hub.broadcast <- []byte("Warning: Failed to persist deployment to DB: " + err.Error())
			}
		}

		resp := DeployResponse{
			Domain:      joinedDomains,
			IP:          joinedAddrs,
			ContainerID: joinedIDs,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

type DNSResponse struct {
	IP    string `json:"ip"`
	Error string `json:"error,omitempty"`
}

func (s *Server) handleDNSLookup() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		domain := r.PathValue("domain") // Go 1.22+ wildcard matching
		if domain == "" {
			http.Error(w, "Domain required", http.StatusBadRequest)
			return
		}

		ip, err := s.dnsManager.GetRecord(domain)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}

		resp := DNSResponse{
			IP: ip,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

type UploadResponse struct {
	ImageName string `json:"imageName"`
}

func (s *Server) handleUpload() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.ParseMultipartForm(10 << 20) // 10 MB limit
		file, handler, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "Error Retrieving the File", http.StatusBadRequest)
			return
		}
		defer file.Close()

		// Create a temporary directory for extraction
		tmpDir, err := os.MkdirTemp("", "upload-*")
		if err != nil {
			http.Error(w, "Server Error: unable to create temp dir", http.StatusInternalServerError)
			return
		}

		// Save the zip file temporarily
		zipPath := filepath.Join(tmpDir, handler.Filename)
		dst, err := os.Create(zipPath)
		if err != nil {
			http.Error(w, "Server Error: unable to save file", http.StatusInternalServerError)
			return
		}
		defer dst.Close()
		io.Copy(dst, file)

		// Unzip it
		err = unzip(zipPath, tmpDir)
		if err != nil {
			http.Error(w, "Failed to unzip: "+err.Error(), http.StatusBadRequest)
			return
		}

		// Build the image
		imageName := fmt.Sprintf("custom-app-%d", time.Now().Unix())
		
		// Find the actual directory containing the Dockerfile
		// In case the user zipped a folder instead of the files directly
		buildDir := tmpDir
		err = filepath.Walk(tmpDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if !info.IsDir() && info.Name() == "Dockerfile" {
				buildDir = filepath.Dir(path)
				return filepath.SkipDir // Found it, stop searching
			}
			return nil
		})
		
		if err != nil {
			log.Printf("Error searching for Dockerfile: %v", err)
		}

		// The Docker manager will build the directory containing the Dockerfile
		err = s.dockerMgr.BuildImage(buildDir, imageName)
		if err != nil {
			http.Error(w, "Failed to build image: "+err.Error(), http.StatusInternalServerError)
			return
		}

		resp := UploadResponse{
			ImageName: imageName,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

// Simple utility function to unzip files
func unzip(src, dest string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()

	for _, f := range r.File {
		fpath := filepath.Join(dest, f.Name)
		if !strings.HasPrefix(fpath, filepath.Clean(dest)+string(os.PathSeparator)) {
			return fmt.Errorf("illegal file path: %s", fpath)
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(fpath, os.ModePerm)
			continue
		}

		if err = os.MkdirAll(filepath.Dir(fpath), os.ModePerm); err != nil {
			return err
		}

		outFile, err := os.OpenFile(fpath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
		if err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			outFile.Close()
			return err
		}

		_, err = io.Copy(outFile, rc)
		outFile.Close()
		rc.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) handleListDeployments() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.dbMgr == nil {
			http.Error(w, "Database not available", http.StatusInternalServerError)
			return
		}
		records, err := s.dbMgr.GetAllDeployments()
		if err != nil {
			http.Error(w, "Failed to get deployments: "+err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(records)
	}
}

type LogsResponse struct {
	Logs  string `json:"logs"`
	Error string `json:"error,omitempty"`
}

func (s *Server) handleContainerLogs() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		containerID := r.PathValue("containerID")
		if containerID == "" {
			http.Error(w, "Container ID required", http.StatusBadRequest)
			return
		}

		logs, err := s.dockerMgr.GetContainerLogs(containerID)
		if err != nil {
			http.Error(w, "Failed to get logs: "+err.Error(), http.StatusInternalServerError)
			return
		}

		resp := LogsResponse{
			Logs: logs,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

func (s *Server) handleDeleteDeployment() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		domain := r.PathValue("domain")
		if domain == "" {
			http.Error(w, "Domain required", http.StatusBadRequest)
			return
		}

		// Look up container IDs from DB
		if s.dbMgr != nil {
			dep, err := s.dbMgr.GetDeploymentByDomain(domain)
			if err == nil && dep != nil {
				// Stop all container replicas
				ids := strings.Split(dep.ContainerID, ",")
				for _, id := range ids {
					trimmed := strings.TrimSpace(id)
					if trimmed != "" {
						s.dockerMgr.StopContainer(trimmed)
					}
				}
				
				// Unregister all associated domains of this deployment from DNS manager
				oldDoms := parseDomains(dep.Domain)
				for _, od := range oldDoms {
					s.dnsManager.RemoveRecord(od)
				}

				// Delete from DB
				s.dbMgr.DeleteDeployment(domain)
			}
		}

		w.WriteHeader(http.StatusOK)
	}
}

type GithubWebhookPayload struct {
	Repository struct {
		CloneURL string `json:"clone_url"`
	} `json:"repository"`
	Ref string `json:"ref"`
}

func (s *Server) handleGithubWebhook() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var payload GithubWebhookPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if payload.Ref != "refs/heads/main" && payload.Ref != "refs/heads/master" {
			w.WriteHeader(http.StatusOK)
			return
		}

		repoUrl := payload.Repository.CloneURL
		if repoUrl == "" {
			http.Error(w, "missing clone_url", http.StatusBadRequest)
			return
		}

		deps, err := s.dbMgr.GetAllDeployments()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		for _, dep := range deps {
			if dep.GithubRepoUrl == repoUrl {
				go func(d Deployment) {
					log.Printf("Webhook triggered redeploy for domain %s from %s", d.Domain, repoUrl)
					
					tempDir, err := os.MkdirTemp("", "git-*")
					if err != nil {
						log.Printf("Failed to create temp dir: %v", err)
						return
					}
					defer os.RemoveAll(tempDir)

					if err := s.gitMgr.Clone(repoUrl, tempDir); err != nil {
						log.Printf("Failed to clone: %v", err)
						return
					}

					imageName := fmt.Sprintf("git-%s", parseDomains(d.Domain)[0])
					if err := s.dockerMgr.BuildImage(tempDir, imageName); err != nil {
						log.Printf("Failed to build image: %v", err)
						return
					}

					// Redeploy with the same number of replicas as the previous deployment
					oldIPs := strings.Split(d.TargetAddr, ",")
					replicas := len(oldIPs)
					if replicas <= 0 {
						replicas = 1
					}

					var newIDs []string
					var newIPs []string

					for i := 0; i < replicas; i++ {
						id, ip, err := s.dockerMgr.RunContainer(imageName, nil)
						if err != nil {
							for _, cid := range newIDs {
								s.dockerMgr.StopContainer(cid) // Rollback
							}
							log.Printf("Failed to run container replica %d during webhook redeployment: %v", i+1, err)
							return
						}
						newIDs = append(newIDs, id)
						newIPs = append(newIPs, ip)
					}

					joinedNewIDs := strings.Join(newIDs, ",")
					joinedNewIPs := strings.Join(newIPs, ",")

					// Map all domains in DNS manager
					domains := parseDomains(d.Domain)
					for _, dom := range domains {
						s.dnsManager.AddRecord(dom, joinedNewIPs)
					}
					
					// Stop all old containers
					oldIDs := strings.Split(d.ContainerID, ",")
					for _, oid := range oldIDs {
						trimmed := strings.TrimSpace(oid)
						if trimmed != "" {
							s.dockerMgr.StopContainer(trimmed)
						}
					}

					d.ContainerID = joinedNewIDs
					d.ImageName = imageName
					d.TargetAddr = joinedNewIPs
					s.dbMgr.SaveDeployment(&d)

					log.Printf("Successfully redeployed %s via webhook", d.Domain)
				}(dep)
			}
		}

		w.WriteHeader(http.StatusOK)
	}
}

func getPublicIP() string {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get("https://api.ipify.org")
	if err != nil {
		return "127.0.0.1"
	}
	defer resp.Body.Close()
	ipBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "127.0.0.1"
	}
	return strings.TrimSpace(string(ipBytes))
}

type SystemIPResponse struct {
	IP string `json:"ip"`
}

func (s *Server) handleSystemIP() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := getPublicIP()
		resp := SystemIPResponse{IP: ip}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

type DNSCheckResponse struct {
	Domain      string   `json:"domain"`
	PointsToMe  bool     `json:"pointsToMe"`
	ResolvedIPs []string `json:"resolvedIPs"`
	ServerIP    string   `json:"serverIP"`
	Error       string   `json:"error,omitempty"`
}

func (s *Server) handleDNSCheck() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		domain := r.PathValue("domain")
		if domain == "" {
			http.Error(w, "Domain parameter required", http.StatusBadRequest)
			return
		}

		serverIP := getPublicIP()
		ips, err := net.LookupIP(domain)
		var resolvedIPs []string
		pointsToMe := false

		if err == nil {
			for _, ip := range ips {
				ipStr := ip.String()
				resolvedIPs = append(resolvedIPs, ipStr)
				if ipStr == serverIP || (serverIP == "127.0.0.1" && (ipStr == "127.0.0.1" || ipStr == "::1")) {
					pointsToMe = true
				}
			}
		}

		var errMsg string
		if err != nil {
			errMsg = err.Error()
		}

		resp := DNSCheckResponse{
			Domain:      domain,
			PointsToMe:  pointsToMe,
			ResolvedIPs: resolvedIPs,
			ServerIP:    serverIP,
			Error:       errMsg,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

func parseDomains(domStr string) []string {
	parts := strings.Split(domStr, ",")
	var clean []string
	for _, p := range parts {
		trimmed := strings.TrimSpace(p)
		if trimmed != "" {
			clean = append(clean, trimmed)
		}
	}
	return clean
}
