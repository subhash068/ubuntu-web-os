package engine

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"time"

	_ "modernc.org/sqlite"
)

type DBManager struct {
	db *sql.DB
}

type Deployment struct {
	ID            int       `json:"id"`
	Domain        string    `json:"domain"`
	ContainerID   string    `json:"container_id"`
	ImageName     string    `json:"image_name"`
	TargetAddr    string    `json:"target_addr"`
	GithubRepoUrl string    `json:"github_repo_url"`
	CreatedAt     time.Time `json:"created_at"`
}

func NewDBManager(dataSourceName string) (*DBManager, error) {
	db, err := sql.Open("sqlite", dataSourceName)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %v", err)
	}

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %v", err)
	}

	// Check if the deployments table exists and if it has 'id' column
	var hasID bool
	rows, err := db.Query("PRAGMA table_info(deployments)")
	if err == nil {
		for rows.Next() {
			var cid int
			var name, ctype string
			var notnull, pk int
			var dfltValNull sql.NullString
			if err := rows.Scan(&cid, &name, &ctype, &notnull, &dfltValNull, &pk); err == nil {
				if name == "id" {
					hasID = true
				}
			}
		}
		rows.Close()
	}

	// If table exists but doesn't have 'id' column, migrate it
	if !hasID {
		var tableName string
		errRow := db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='deployments'").Scan(&tableName)
		if errRow == nil && tableName == "deployments" {
			log.Println("Migrating deployments table schema to include ID...")
			// 1. Rename table
			if _, err := db.Exec("ALTER TABLE deployments RENAME TO deployments_old"); err != nil {
				return nil, fmt.Errorf("failed to rename old deployments table: %v", err)
			}
			// 2. Create new table
			query := `
			CREATE TABLE deployments (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				domain TEXT UNIQUE NOT NULL,
				container_id TEXT NOT NULL,
				image_name TEXT NOT NULL,
				target_addr TEXT DEFAULT '',
				github_repo_url TEXT DEFAULT '',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			);`
			if _, err := db.Exec(query); err != nil {
				return nil, fmt.Errorf("failed to create new deployments table: %v", err)
			}
			// 3. Copy data from old table
			copyQuery := `
			INSERT INTO deployments (domain, container_id, image_name, target_addr, github_repo_url)
			SELECT domain, container_id, 'unknown', COALESCE(ip_address, target_addr, ''), COALESCE(github_repo_url, '')
			FROM deployments_old;`
			if _, err := db.Exec(copyQuery); err != nil {
				log.Printf("Warning: failed to copy old deployments data: %v", err)
			}
			// 4. Drop old table
			_, _ = db.Exec("DROP TABLE deployments_old;")
		}
	}

	// Create table if it doesn't exist
	query := `
	CREATE TABLE IF NOT EXISTS deployments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		domain TEXT UNIQUE NOT NULL,
		container_id TEXT NOT NULL,
		image_name TEXT NOT NULL,
		target_addr TEXT DEFAULT '',
		github_repo_url TEXT DEFAULT '',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`
	if _, err := db.Exec(query); err != nil {
		return nil, fmt.Errorf("failed to create deployments table: %v", err)
	}

	// Try to add github_repo_url and target_addr if they don't exist (for existing databases)
	_, _ = db.Exec(`ALTER TABLE deployments ADD COLUMN github_repo_url TEXT DEFAULT '';`)
	_, _ = db.Exec(`ALTER TABLE deployments ADD COLUMN target_addr TEXT DEFAULT '';`)

	log.Printf("Connected to SQLite database at %s", dataSourceName)
	return &DBManager{db: db}, nil
}

func (m *DBManager) SaveDeployment(dep *Deployment) error {
	query := `
	INSERT INTO deployments (domain, container_id, image_name, target_addr, github_repo_url) 
	VALUES (?, ?, ?, ?, ?)
	ON CONFLICT(domain) DO UPDATE SET
		container_id = excluded.container_id,
		image_name = excluded.image_name,
		target_addr = excluded.target_addr,
		github_repo_url = excluded.github_repo_url;
	`
	_, err := m.db.Exec(query, dep.Domain, dep.ContainerID, dep.ImageName, dep.TargetAddr, dep.GithubRepoUrl)
	return err
}

func (m *DBManager) GetAllDeployments() ([]Deployment, error) {
	query := `SELECT id, domain, container_id, image_name, target_addr, github_repo_url, created_at FROM deployments`
	rows, err := m.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var deps []Deployment
	for rows.Next() {
		var d Deployment
		if err := rows.Scan(&d.ID, &d.Domain, &d.ContainerID, &d.ImageName, &d.TargetAddr, &d.GithubRepoUrl, &d.CreatedAt); err != nil {
			return nil, err
		}
		deps = append(deps, d)
	}
	return deps, nil
}

func (m *DBManager) Close() error {
	return m.db.Close()
}

func (m *DBManager) GetDeploymentByDomain(domain string) (*Deployment, error) {
	query := `SELECT id, domain, container_id, image_name, target_addr, github_repo_url, created_at FROM deployments WHERE ',' || domain || ',' LIKE ?`
	row := m.db.QueryRow(query, "%,"+domain+",%")

	var r Deployment
	if err := row.Scan(&r.ID, &r.Domain, &r.ContainerID, &r.ImageName, &r.TargetAddr, &r.GithubRepoUrl, &r.CreatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.New("deployment not found")
		}
		return nil, err
	}
	return &r, nil
}

func (m *DBManager) DeleteDeployment(domain string) error {
	query := `DELETE FROM deployments WHERE ',' || domain || ',' LIKE ?;`
	_, err := m.db.Exec(query, "%,"+domain+",%")
	return err
}
