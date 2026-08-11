package engine

import (
	"errors"
	"strings"
	"sync"
)

// DNSRecord represents a simple A record
type DNSRecord struct {
	Domain string
	IP     string
}

// DNSManager handles the mapping of domains to IP addresses (with round-robin load balancing)
type DNSManager struct {
	mu      sync.Mutex
	records map[string][]string // maps Domain to target addresses
	indexes map[string]int      // round robin index per domain
	dbMgr   *DBManager
}

// NewDNSManager creates a new instance of DNSManager
func NewDNSManager(dbMgr *DBManager) *DNSManager {
	m := &DNSManager{
		records: make(map[string][]string),
		indexes: make(map[string]int),
		dbMgr:   dbMgr,
	}

	if dbMgr != nil {
		records, err := dbMgr.GetAllDeployments()
		if err == nil {
			for _, r := range records {
				if r.TargetAddr != "" {
					addrs := strings.Split(r.TargetAddr, ",")
					var cleanAddrs []string
					for _, a := range addrs {
						trimmed := strings.TrimSpace(a)
						if trimmed != "" {
							cleanAddrs = append(cleanAddrs, trimmed)
						}
					}
					// Map all domains of this deployment to the targets list
					doms := strings.Split(r.Domain, ",")
					for _, d := range doms {
						trimmedDom := strings.TrimSpace(d)
						if trimmedDom != "" {
							m.records[trimmedDom] = cleanAddrs
						}
					}
				}
			}
		}
	}

	return m
}

// AddRecord adds or updates a domain to IP mapping (supports comma-separated list of IPs)
func (m *DNSManager) AddRecord(domain, ips string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	addrs := strings.Split(ips, ",")
	var cleanAddrs []string
	for _, a := range addrs {
		trimmed := strings.TrimSpace(a)
		if trimmed != "" {
			cleanAddrs = append(cleanAddrs, trimmed)
		}
	}

	m.records[domain] = cleanAddrs
	m.indexes[domain] = 0 // Reset round robin pointer
	return nil
}

// GetRecord looks up the IP for a given domain (performing round robin load balancing)
func (m *DNSManager) GetRecord(domain string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	addrs, exists := m.records[domain]
	if !exists || len(addrs) == 0 {
		return "", errors.New("domain not found")
	}

	idx := m.indexes[domain]
	selected := addrs[idx%len(addrs)]
	
	// Advance pointer
	m.indexes[domain] = (idx + 1) % len(addrs)

	return selected, nil
}

// RemoveRecord deletes a DNS mapping
func (m *DNSManager) RemoveRecord(domain string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	delete(m.records, domain)
	delete(m.indexes, domain)
}
