package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

// -------- TYPES --------

type Network struct {
	ID        string `json:"id"`
	SSID      string `json:"ssid"`
	Sec       string `json:"sec"`
	Strength  int    `json:"strength"`
	Connected bool   `json:"connected"`
}

// -------- TEMPLATES --------

const windowsProfileTemplate = `<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
	<name>%s</name>
	<SSIDConfig>
		<SSID>
			<name>%s</name>
		</SSID>
	</SSIDConfig>
	<connectionType>ESS</connectionType>
	<connectionMode>auto</connectionMode>
	<MSM>
		<security>
			<authEncryption>
				<authentication>WPA2PSK</authentication>
				<encryption>AES</encryption>
				<useOneX>false</useOneX>
			</authEncryption>
			<sharedKey>
				<keyType>passPhrase</keyType>
				<protected>false</protected>
				<keyMaterial>%s</keyMaterial>
			</sharedKey>
		</security>
	</MSM>
</WLANProfile>`

const windowsOpenProfileTemplate = `<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
	<name>%s</name>
	<SSIDConfig>
		<SSID>
			<name>%s</name>
		</SSID>
	</SSIDConfig>
	<connectionType>ESS</connectionType>
	<connectionMode>auto</connectionMode>
	<MSM>
		<security>
			<authEncryption>
				<authentication>open</authentication>
				<encryption>none</encryption>
				<useOneX>false</useOneX>
			</authEncryption>
		</security>
	</MSM>
</WLANProfile>`

// -------- SCANNER LOGIC --------

func scanNetworks() {
	var networks []Network

	if runtime.GOOS == "windows" {
		cmd := exec.Command("netsh", "wlan", "show", "networks", "mode=bssid")
		out, err := cmd.Output()
		if err == nil {
			networks = parseWindows(string(out))
		}
	} else if runtime.GOOS == "linux" {
		cmd := exec.Command("nmcli", "-t", "-f", "SSID,SECURITY,SIGNAL", "dev", "wifi")
		out, err := cmd.Output()
		if err == nil {
			networks = parseLinux(string(out))
		}
	}

	jsonData, err := json.Marshal(networks)
	if err == nil {
		fmt.Println(string(jsonData))
	} else {
		fmt.Println("[]")
	}
}

func parseWindows(output string) []Network {
	var networks []Network
	lines := strings.Split(output, "\n")
	var current *Network

	for _, line := range lines {
		line = strings.TrimSpace(line)
		
		if strings.HasPrefix(line, "SSID ") {
			if current != nil && current.SSID != "" {
				networks = append(networks, *current)
			}
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				current = &Network{
					ID:        fmt.Sprintf("net_%d", len(networks)),
					SSID:      strings.TrimSpace(parts[1]),
					Sec:       "Open",
					Strength:  0,
					Connected: false,
				}
			}
		} else if strings.HasPrefix(line, "Authentication") && current != nil {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				current.Sec = strings.TrimSpace(parts[1])
			}
		} else if strings.HasPrefix(line, "Signal") && current != nil {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				sigStr := strings.ReplaceAll(strings.TrimSpace(parts[1]), "%", "")
				if sig, err := strconv.Atoi(sigStr); err == nil {
					bars := (sig + 20) / 25
					if bars < 1 { bars = 1 }
					if bars > 4 { bars = 4 }
					if bars > current.Strength {
						current.Strength = bars
					}
				}
			}
		}
	}
	
	if current != nil && current.SSID != "" {
		networks = append(networks, *current)
	}
	return networks
}

func parseLinux(output string) []Network {
	var networks []Network
	lines := strings.Split(output, "\n")
	
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, ":")
		if len(parts) >= 3 {
			ssid := strings.TrimSpace(parts[0])
			if ssid == "" {
				continue
			}
			sec := strings.TrimSpace(parts[1])
			if sec == "" {
				sec = "Open"
			}
			sigStr := strings.TrimSpace(parts[2])
			bars := 2
			if sig, err := strconv.Atoi(sigStr); err == nil {
				bars = (sig + 20) / 25
				if bars < 1 { bars = 1 }
				if bars > 4 { bars = 4 }
			}
			networks = append(networks, Network{
				ID:        fmt.Sprintf("net_%d", i),
				SSID:      ssid,
				Sec:       sec,
				Strength:  bars,
				Connected: false,
			})
		}
	}
	return networks
}

// -------- CONNECTOR LOGIC --------

func escapeJSON(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "\"", "\\\"")
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", "")
	return s
}

func connectWindows(ssid, password string) error {
	var profileXML string
	if password == "" {
		profileXML = fmt.Sprintf(windowsOpenProfileTemplate, ssid, ssid)
	} else {
		profileXML = fmt.Sprintf(windowsProfileTemplate, ssid, ssid, password)
	}

	tempDir := os.TempDir()
	tempFile := filepath.Join(tempDir, "wifi_profile_"+ssid+".xml")

	err := os.WriteFile(tempFile, []byte(profileXML), 0644)
	if err != nil {
		return fmt.Errorf("failed to create temp profile: %v", err)
	}
	defer os.Remove(tempFile)

	addCmd := exec.Command("netsh", "wlan", "add", "profile", "filename="+tempFile)
	out, err := addCmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to add profile: %s", string(out))
	}

	connCmd := exec.Command("netsh", "wlan", "connect", "name="+ssid)
	out, err = connCmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to connect: %s", string(out))
	}

	return nil
}

func connectLinux(ssid, password string) error {
	var cmd *exec.Cmd
	if password == "" {
		cmd = exec.Command("nmcli", "dev", "wifi", "connect", ssid)
	} else {
		cmd = exec.Command("nmcli", "dev", "wifi", "connect", ssid, "password", password)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("nmcli error: %s", string(out))
	}
	return nil
}

// -------- MAIN --------

func main() {
	scanFlag := flag.Bool("scan", false, "Scan for Wi-Fi networks")
	connectFlag := flag.String("connect", "", "SSID to connect to")
	passwordFlag := flag.String("password", "", "Wi-Fi password for connecting (optional)")
	
	flag.Parse()

	if *scanFlag {
		scanNetworks()
		return
	}

	if *connectFlag != "" {
		var err error
		if runtime.GOOS == "windows" {
			err = connectWindows(*connectFlag, *passwordFlag)
		} else {
			err = connectLinux(*connectFlag, *passwordFlag)
		}

		if err != nil {
			errMsg := fmt.Sprintf(`{"error": "%s"}`, escapeJSON(err.Error()))
			fmt.Println(errMsg)
			os.Exit(1)
		}

		fmt.Println(`{"success": true}`)
		return
	}

	fmt.Println("Usage: wifi.exe --scan OR wifi.exe --connect SSID [--password PASSWORD]")
	os.Exit(1)
}
