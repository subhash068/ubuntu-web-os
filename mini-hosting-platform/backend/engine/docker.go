package engine

import (
	"bytes"
	"errors"
	"fmt"
	"log"
	"os/exec"
	"strings"
)

// DockerManager handles interaction with the local Docker daemon
type DockerManager struct{}

func NewDockerManager() *DockerManager {
	return &DockerManager{}
}

// RunContainer spins up a new detached container and returns its ID and Network IP
func (d *DockerManager) RunContainer(image string, env map[string]string) (id string, ip string, err error) {
	// 1. Run the container and bind port 80 to a random available host port
	args := []string{"docker", "run", "-d", "-p", "80"}
	for k, v := range env {
		args = append(args, "-e", fmt.Sprintf("%s=%s", k, v))
	}
	args = append(args, image)
	
	runCmd := exec.Command("wsl", args...)
	var runOut bytes.Buffer
	var runErr bytes.Buffer
	runCmd.Stdout = &runOut
	runCmd.Stderr = &runErr

	if err := runCmd.Run(); err != nil {
		return "", "", fmt.Errorf("failed to run docker container: %v - %s", err, runErr.String())
	}

	containerID := strings.TrimSpace(runOut.String())
	if containerID == "" {
		return "", "", errors.New("empty container ID returned")
	}

	log.Printf("Started container %s with image %s", containerID, image)

	// 2. Get the dynamically assigned host port for container port 80
	inspectCmd := exec.Command("wsl", "docker", "port", containerID, "80")
	var inspectOut bytes.Buffer
	inspectCmd.Stdout = &inspectOut

	if err := inspectCmd.Run(); err != nil {
		// Clean up the container if we couldn't get its port
		d.StopContainer(containerID)
		return "", "", fmt.Errorf("failed to get container port: %v", err)
	}

	// Output format is typically '0.0.0.0:32768' or '::1:32768' (depending on Docker version)
	// Some newer Docker versions output multiple lines (e.g. one for IPv4 and one for IPv6).
	// We'll just grab the first line and split by colon to find the port number.
	portLines := strings.Split(strings.TrimSpace(inspectOut.String()), "\n")
	if len(portLines) == 0 || portLines[0] == "" {
		d.StopContainer(containerID)
		return "", "", errors.New("no port mapping found")
	}

	parts := strings.Split(portLines[0], ":")
	if len(parts) < 2 {
		d.StopContainer(containerID)
		return "", "", fmt.Errorf("unexpected port output format: %s", portLines[0])
	}

	hostPort := strings.TrimSpace(parts[len(parts)-1])
	targetAddr := "127.0.0.1:" + hostPort

	log.Printf("Container %s is running and exposed at %s", containerID, targetAddr)
	return containerID, targetAddr, nil
}

// StopContainer forcefully removes a container
func (d *DockerManager) StopContainer(id string) error {
	cmd := exec.Command("wsl", "docker", "rm", "-f", id)
	return cmd.Run()
}

// BuildImage builds a custom Docker image from a directory containing a Dockerfile
func (d *DockerManager) BuildImage(sourceDir string, imageName string) error {
	// Manually convert Windows path to WSL path (e.g., C:\Temp -> /mnt/c/Temp)
	wslSourceDir := strings.ReplaceAll(sourceDir, "\\", "/")
	if len(wslSourceDir) >= 3 && wslSourceDir[1] == ':' && wslSourceDir[2] == '/' {
		driveLetter := strings.ToLower(string(wslSourceDir[0]))
		wslSourceDir = "/mnt/" + driveLetter + "/" + wslSourceDir[3:]
	}

	buildCmd := exec.Command("wsl", "docker", "build", "-t", imageName, wslSourceDir)
	var buildErr bytes.Buffer
	buildCmd.Stderr = &buildErr

	if err := buildCmd.Run(); err != nil {
		return fmt.Errorf("failed to build docker image: %v - %s", err, buildErr.String())
	}

	log.Printf("Successfully built custom image %s", imageName)
	return nil
}

// GetContainerLogs retrieves the last 100 lines of logs for a given container
func (d *DockerManager) GetContainerLogs(id string) (string, error) {
	cmd := exec.Command("wsl", "docker", "logs", "--tail", "100", id)
	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("failed to get logs: %v - %s", err, stderr.String())
	}

	// docker logs sometimes prints to stderr even on success, so we combine them
	return out.String() + stderr.String(), nil
}
