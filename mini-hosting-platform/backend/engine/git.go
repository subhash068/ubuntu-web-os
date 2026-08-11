package engine

import (
	"bytes"
	"fmt"
	"log"
	"os/exec"
)

type GitManager struct{}

func NewGitManager() *GitManager {
	return &GitManager{}
}

// Clone downloads a public repository to a specific destination
func (g *GitManager) Clone(repoUrl string, dest string) error {
	cmd := exec.Command("git", "clone", repoUrl, dest)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git clone failed: %v - %s", err, stderr.String())
	}
	log.Printf("Successfully cloned %s to %s", repoUrl, dest)
	return nil
}
