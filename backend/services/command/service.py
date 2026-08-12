import os
import time
import subprocess
import json
import base64
from backend.core.config import (
    OS_WEBOS_MAX_STDOUT_BYTES, OS_WEBOS_MAX_STDERR_BYTES
)
from backend.core import logger
from backend.services.command.policy import check_policy, CommandPolicy

def truncate_output(text: str, max_bytes: int):
    if text is None:
        text = ""
    b = text.encode("utf-8", errors="ignore")
    if len(b) <= max_bytes:
        return text, False
    truncated = b[:max_bytes].decode("utf-8", errors="ignore")
    return truncated, True

def run_wsl_ubuntu_root(argv, timeout_sec: int):
    result = subprocess.run(
        ["wsl", "-d", "Ubuntu-24.04", "-u", "root", "--cd", "~"] + argv,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout_sec
    )
    return result

def execute_command(op: str, args: dict, user: str = None) -> dict:
    """
    Enforces policies, handles command confirmation, executes commands via WSL,
    and records audit logs.
    """
    # 1. Evaluate policy
    policy_status, policy_msg = check_policy(op, args)
    
    if policy_status == CommandPolicy.DENY:
        logger.error(
            "command.policy", "execute", "permission_denied",
            user=user, op=op, details=policy_msg
        )
        logger.audit(
            event="command_blocked",
            user=user,
            operation=op,
            policy=policy_status,
            status="denied",
            duration_ms=0,
            exit_code=-3
        )
        return {
            "status": "denied",
            "message": f"Security Policy Blocked execution: {policy_msg}",
            "exit_code": -3,
            "stdout": "",
            "stderr": f"Security Policy Blocked execution: {policy_msg}"
        }
        
    if policy_status == CommandPolicy.CONFIRM:
        if not args.get("confirmed", False):
            logger.info(
                "command.policy_confirmation_required",
                user=user, op=op, details=policy_msg
            )
            logger.audit(
                event="command_blocked",
                user=user,
                operation=op,
                policy=policy_status,
                status="confirmation_required",
                duration_ms=0,
                exit_code=0
            )
            return {
                "status": "confirmation_required",
                "message": policy_msg,
                "op": op,
                "args": args
            }
            
    # 2. Map structured operations to exact argv
    start_time = time.time()
    argv = None
    timeout_sec = 20
    
    try:
        if op == "ps_aux":
            argv = ["bash", "-lc", "COLUMNS=80 LINES=24 ps aux"]
            timeout_sec = 15
        elif op == "whoami":
            argv = ["whoami"]
            timeout_sec = 10
        elif op == "pwd":
            argv = ["pwd"]
            timeout_sec = 10
        elif op == "ls":
            path = args.get("path", "/root")
            argv = ["ls", "-ap", "--group-directories-first", path]
            timeout_sec = 20
        elif op == "cat":
            path = args.get("path")
            if not path:
                raise ValueError("Missing path")
            argv = ["cat", path]
            timeout_sec = 20
        elif op == "write_file_base64":
            path = args.get("path")
            b64 = args.get("b64", "")
            if not path:
                raise ValueError("Missing path")
            if not b64:
                raise ValueError("Missing b64")
            safe_path = path.replace('"', '').replace("'", "")
            argv = ["bash", "-lc", f'base64 -d <<< "{b64}" > "{safe_path}"']
            timeout_sec = 20
        elif op == "stat":
            path = args.get("path")
            if not path:
                raise ValueError("Missing path")
            fmt = " %A %a %U %G %s"
            argv = ["stat", "-c", fmt.strip(), path]
            timeout_sec = 20
        elif op == "chmod":
            mode = args.get("mode")
            path = args.get("path")
            if not (isinstance(mode, str) and mode.isdigit() and len(mode) == 3):
                raise ValueError("Invalid mode")
            if not path:
                raise ValueError("Missing path")
            argv = ["chmod", mode, path]
            timeout_sec = 20
        elif op == "kill":
            pid = args.get("pid")
            if not str(pid).isdigit():
                raise ValueError("Invalid pid")
            argv = ["kill", "-9", str(pid)]
            timeout_sec = 15
        elif op == "touch":
            path = args.get("path")
            if not path:
                raise ValueError("Missing path")
            argv = ["touch", path]
            timeout_sec = 15
        elif op == "mkdir_p":
            path = args.get("path")
            if not path:
                raise ValueError("Missing path")
            argv = ["mkdir", "-p", path]
            timeout_sec = 15
        elif op == "rm_file":
            path = args.get("path")
            is_dir = bool(args.get("is_dir", False))
            if not path:
                raise ValueError("Missing path")
            argv = ["rm", "-f" if not is_dir else "-rf", path]
            timeout_sec = 25
        elif op == "apt_cache_search":
            query = args.get("query", "")
            if not query or len(query) > 80 or any(c in query for c in [";", "&", "|", "`", "$", "\n", "\r"]):
                raise ValueError("Invalid query")
            argv = ["bash", "-lc", f'apt-cache search "{query}" | head -n 30']
            timeout_sec = 50
        elif op == "apt_get_install":
            pkg = args.get("pkg", "")
            if not pkg or len(pkg) > 120 or any(c in pkg for c in [";", "&", "|", "`", "$", "\n", "\r"]):
                raise ValueError("Invalid pkg")
            argv = ["bash", "-lc", f'DEBIAN_FRONTEND=noninteractive apt-get install -y "{pkg}"']
            timeout_sec = 240
        elif op == "net_tool":
            tool = args.get("tool")
            host = args.get("host", "")
            if not host or len(host) > 200 or any(c in host for c in [";", "&", "|", "`", "$", "\n", "\r"]):
                raise ValueError("Invalid host")
            if tool == "ping":
                argv = ["bash", "-lc", f'ping -c 4 "{host}"']
                timeout_sec = 30
            elif tool == "nslookup":
                argv = ["bash", "-lc", f'nslookup "{host}"']
                timeout_sec = 30
            elif tool == "nmap":
                argv = ["bash", "-lc", f'nmap -F "{host}"']
                timeout_sec = 150
            else:
                raise ValueError("Invalid tool")
        elif op == "stats_sh":
            # Check script existence or fallback path on host.
            # stats.sh was previously run directly in wsl.
            argv = ["bash", "-lc", "bash /mnt/d/ubuntu-web-os/scripts/stats.sh"]
            timeout_sec = 30
        elif op == "run_raw":
            command = args.get("command")
            if not command:
                raise ValueError("Missing command")
            command = f"export DEBIAN_FRONTEND=noninteractive; {command}"
            argv = ["bash", "-c", command]
            timeout_sec = 30
        elif op == "mv":
            src = args.get("src")
            dest = args.get("dest")
            if not src or not dest:
                raise ValueError("Missing src or dest")
            argv = ["mv", src, dest]
            timeout_sec = 15
        elif op == "compress":
            path = args.get("path")
            if not path:
                raise ValueError("Missing path")
            parent_dir = os.path.dirname(path)
            base_name = os.path.basename(path)
            archive_name = path + ".tar.gz"
            argv = ["tar", "-czf", archive_name, "-C", parent_dir, base_name]
            timeout_sec = 30
        elif op == "apt_cache_show":
            pkg = args.get("pkg")
            if not pkg or len(pkg) > 120 or any(c in pkg for c in [";", "&", "|", "`", "$", "\n", "\r"]):
                raise ValueError("Invalid pkg")
            argv = ["bash", "-lc", f'apt-cache show "{pkg}"']
            timeout_sec = 15
        elif op == "apt_get_remove":
            pkg = args.get("pkg")
            if not pkg or len(pkg) > 120 or any(c in pkg for c in [";", "&", "|", "`", "$", "\n", "\r"]):
                raise ValueError("Invalid pkg")
            argv = ["bash", "-lc", f'DEBIAN_FRONTEND=noninteractive apt-get remove -y "{pkg}"']
            timeout_sec = 180
        elif op == "dpkg_query_status":
            pkg = args.get("pkg")
            if not pkg or len(pkg) > 120 or any(c in pkg for c in [";", "&", "|", "`", "$", "\n", "\r"]):
                raise ValueError("Invalid pkg")
            argv = ["dpkg-query", "-W", pkg]
            timeout_sec = 10
        elif op == "apt_get_install_simulate":
            pkg = args.get("pkg")
            if not pkg or len(pkg) > 120 or any(c in pkg for c in [";", "&", "|", "`", "$", "\n", "\r"]):
                raise ValueError("Invalid pkg")
            argv = ["bash", "-lc", f'apt-get install -s "{pkg}"']
            timeout_sec = 20
        elif op == "apt_get_update":
            argv = ["bash", "-lc", "DEBIAN_FRONTEND=noninteractive apt-get update"]
            timeout_sec = 180
            
        elif op == "system_cleanup":
            # Multiple steps cleanup
            clean_tmp = bool(args.get("clean_tmp", True))
            clean_apt = bool(args.get("clean_apt", True))
            clean_autoremove = bool(args.get("clean_autoremove", True))
            clean_logs = bool(args.get("clean_logs", True))
            
            stdout_parts = []
            stderr_parts = []
            exit_code = 0
            
            if clean_apt:
                res = run_wsl_ubuntu_root(["apt-get", "clean"], timeout_sec=60)
                if res.stdout: stdout_parts.append(res.stdout)
                if res.stderr: stderr_parts.append(res.stderr)
                if res.returncode != 0: exit_code = res.returncode
                    
            if clean_autoremove:
                res = run_wsl_ubuntu_root(["bash", "-lc", "DEBIAN_FRONTEND=noninteractive apt-get autoremove -y"], timeout_sec=120)
                if res.stdout: stdout_parts.append(res.stdout)
                if res.stderr: stderr_parts.append(res.stderr)
                if res.returncode != 0: exit_code = res.returncode
                    
            if clean_tmp:
                res = run_wsl_ubuntu_root(["bash", "-c", "find /tmp -mindepth 1 -maxdepth 2 -delete 2>/dev/null || true"], timeout_sec=30)
                if res.stdout: stdout_parts.append(res.stdout)
                
            if clean_logs:
                res = run_wsl_ubuntu_root(["journalctl", "--vacuum-size=50M"], timeout_sec=60)
                if res.stdout: stdout_parts.append(res.stdout)
                if res.stderr: stderr_parts.append(res.stderr)
                if res.returncode != 0: exit_code = res.returncode
                
            combined_stdout = "\n".join(stdout_parts)
            combined_stderr = "\n".join(stderr_parts)
            
            stdout, stdout_trunc = truncate_output(combined_stdout, OS_WEBOS_MAX_STDOUT_BYTES)
            stderr, stderr_trunc = truncate_output(combined_stderr, OS_WEBOS_MAX_STDERR_BYTES)
            
            duration = int((time.time() - start_time) * 1000)
            logger.info(
                "command.execute", user=user, op=op,
                duration_ms=duration, status="success" if exit_code == 0 else "failure"
            )
            return {
                "status": "success",
                "stdout": stdout,
                "stderr": stderr,
                "exit_code": exit_code,
                "truncated_stdout": stdout_trunc,
                "truncated_stderr": stderr_trunc
            }
            
        elif op == "wifi_connect":
            ssid = args.get("ssid")
            password = args.get("password", "")
            if not ssid:
                raise ValueError("Missing ssid")
            
            import platform
            exe_ext = ".exe" if platform.system() == "Windows" else ""
            exe_path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "agents", "go", "wifi_scanner", "wifi" + exe_ext)
            if not os.path.exists(exe_path):
                # Fallback to local dev path
                exe_path = os.path.join(os.path.dirname(__file__), "..", "..", "agents", "go", "wifi_scanner", "wifi" + exe_ext)
            if not os.path.exists(exe_path):
                exe_path = os.path.join(os.path.dirname(__file__), "wifi" + exe_ext) # direct fallback
            
            cmd_args = [exe_path, "--connect", ssid]
            if password:
                cmd_args.extend(["--password", password])
                
            try:
                res = subprocess.run(cmd_args, capture_output=True, text=True, timeout=30)
                duration = int((time.time() - start_time) * 1000)
                logger.info("command.execute", user=user, op=op, duration_ms=duration, status="success")
                return {
                    "status": "success",
                    "stdout": res.stdout,
                    "stderr": res.stderr,
                    "exit_code": res.returncode,
                    "truncated_stdout": False,
                    "truncated_stderr": False
                }
            except Exception as e:
                logger.error("command.execute", op, str(e))
                return {
                    "status": "success",
                    "stdout": "",
                    "stderr": str(e),
                    "exit_code": 1,
                    "truncated_stdout": False,
                    "truncated_stderr": False
                }
                
        elif op == "wifi_details":
            import platform
            details = {"success": False}
            try:
                if platform.system() == "Windows":
                    res = subprocess.run(["netsh", "wlan", "show", "interfaces"], capture_output=True, text=True, timeout=15)
                    if res.returncode == 0:
                        info_dict = {}
                        for line in res.stdout.split("\n"):
                            line = line.strip()
                            if ":" in line:
                                parts = line.split(":", 1)
                                key = parts[0].strip()
                                val = parts[1].strip()
                                if key and val:
                                    info_dict[key] = val
                        if info_dict.get("State") == "connected":
                            details = {
                                "success": True,
                                "ssid": info_dict.get("SSID", "Unknown"),
                                "bssid": info_dict.get("BSSID", "Unknown"),
                                "radio": info_dict.get("Radio type", "Unknown"),
                                "band": info_dict.get("Band", "Unknown"),
                                "channel": info_dict.get("Channel", "Unknown"),
                                "receive_rate": info_dict.get("Receive rate (Mbps)", "Unknown"),
                                "transmit_rate": info_dict.get("Transmit rate (Mbps)", "Unknown"),
                                "signal": info_dict.get("Signal", "Unknown")
                            }
                else:
                    res = subprocess.run(["nmcli", "-t", "-f", "ACTIVE,SSID,BSSID,FREQ,BITRATE,SIGNAL", "dev", "wifi"], capture_output=True, text=True, timeout=15)
                    if res.returncode == 0:
                        for line in res.stdout.split("\n"):
                            parts = line.strip().split(":")
                            if len(parts) >= 6 and parts[0] == "yes":
                                details = {
                                    "success": True,
                                    "ssid": parts[1],
                                    "bssid": parts[2],
                                    "radio": "Unknown",
                                    "band": parts[3],
                                    "channel": "Unknown",
                                    "receive_rate": parts[4],
                                    "transmit_rate": parts[4],
                                    "signal": parts[5] + "%"
                                }
                                break
            except Exception as e:
                details["error"] = str(e)
                
            return {
                "status": "success",
                "stdout": json.dumps(details),
                "stderr": "",
                "exit_code": 0,
                "truncated_stdout": False,
                "truncated_stderr": False
            }
            
        elif op == "wifi_scan":
            import platform
            networks = []
            exe_ext = ".exe" if platform.system() == "Windows" else ""
            exe_path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "agents", "go", "wifi_scanner", "wifi" + exe_ext)
            if not os.path.exists(exe_path):
                exe_path = os.path.join(os.path.dirname(__file__), "..", "..", "agents", "go", "wifi_scanner", "wifi" + exe_ext)
            if not os.path.exists(exe_path):
                exe_path = os.path.join(os.path.dirname(__file__), "wifi" + exe_ext)
                
            try:
                res = subprocess.run([exe_path, "--scan"], capture_output=True, text=True, timeout=15)
                if res.returncode == 0:
                    networks = json.loads(res.stdout)
            except Exception:
                pass
                
            if not networks:
                # Fallback to simulated dynamic Wi-Fi environment
                import random
                seed = int(time.time() / 5)
                r = random.Random(seed)
                base_networks = [
                    {"ssid": "Starbucks WiFi", "sec": "Open"},
                    {"ssid": "Xfinity Public", "sec": "Open"},
                    {"ssid": "Home_Network_5G", "sec": "WPA3"},
                    {"ssid": "Guest-Network", "sec": "WPA2"},
                    {"ssid": "TP-Link_Extender", "sec": "WPA2"},
                    {"ssid": "Pixel_Hotspot", "sec": "WPA3"},
                    {"ssid": "FBI_Surveillance_Van_4", "sec": "WPA2"},
                    {"ssid": "NETGEAR-5G", "sec": "WPA2"},
                    {"ssid": "HackMeIfYouCan", "sec": "WEP"}
                ]
                selected = r.sample(base_networks, r.randint(5, 8))
                for net in selected:
                    net["id"] = "sim_" + "".join(c for c in net["ssid"] if c.isalnum())
                    net["strength"] = r.randint(1, 4)
                    net["connected"] = False
                networks = selected
                
            return {
                "status": "success",
                "stdout": json.dumps(networks),
                "stderr": "",
                "exit_code": 0,
                "truncated_stdout": False,
                "truncated_stderr": False
            }
            
        elif op in ("wifi_toggle", "bt_toggle", "ap_toggle", "dnd_toggle", "vol_set", "bright_set"):
            return {
                "status": "success",
                "stdout": json.dumps({"success": True}),
                "stderr": "",
                "exit_code": 0,
                "truncated_stdout": False,
                "truncated_stderr": False
            }
            
        else:
            raise ValueError(f"Unsupported Operation: {op}")
            
    except Exception as e:
        logger.error("command.execute", op, str(e))
        return {
            "status": "error",
            "stdout": "",
            "stderr": f"Error: {str(e)}",
            "exit_code": -2,
            "truncated_stdout": False,
            "truncated_stderr": False
        }

    # Run the compiled WSL command
    try:
        res = run_wsl_ubuntu_root(argv, timeout_sec=timeout_sec)
        stdout, stdout_trunc = truncate_output(res.stdout, OS_WEBOS_MAX_STDOUT_BYTES)
        stderr, stderr_trunc = truncate_output(res.stderr, OS_WEBOS_MAX_STDERR_BYTES)
        
        duration = int((time.time() - start_time) * 1000)
        logger.info(
            "command.execute", user=user, op=op,
            duration_ms=duration, status="success" if res.returncode == 0 else "failure"
        )
        logger.audit(
            event="command_execution",
            user=user,
            operation=op,
            policy=policy_status,
            status="success" if res.returncode == 0 else "failure",
            duration_ms=duration,
            exit_code=res.returncode
        )
        return {
            "status": "success",
            "stdout": stdout,
            "stderr": stderr,
            "exit_code": res.returncode,
            "truncated_stdout": stdout_trunc,
            "truncated_stderr": stderr_trunc
        }
    except subprocess.TimeoutExpired as e:
        logger.error("command.execute", op, "timeout")
        return {
            "status": "timeout",
            "stdout": "",
            "stderr": "Error: command timed out",
            "exit_code": -1,
            "truncated_stdout": False,
            "truncated_stderr": False
        }
    except Exception as e:
        logger.error("command.execute", op, str(e))
        logger.audit(
            event="command_execution",
            user=user,
            operation=op,
            policy=policy_status,
            status="error",
            duration_ms=int((time.time() - start_time) * 1000),
            exit_code=-2
        )
        return {
            "status": "error",
            "stdout": "",
            "stderr": f"Error: {str(e)}",
            "exit_code": -2,
            "truncated_stdout": False,
            "truncated_stderr": False
        }
