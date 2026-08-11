import os
import subprocess
import sys
import docker
import logging

logger = logging.getLogger("docker_manager")
logging.basicConfig(level=logging.INFO)

class DockerManager:
    def __init__(self):
        self.client = None
        self.use_cli_fallback = False
        try:
            self.client = docker.from_env()
            self.client.ping()
            logger.info("Successfully connected to Docker via SDK.")
        except Exception as e:
            logger.warning(f"Docker SDK connection failed: {e}. Falling back to CLI mode.")
            self.use_cli_fallback = True

        # Detect environment
        self.is_windows = sys.platform.startswith("win")
        # Check if we should use wsl prefix
        self.use_wsl_prefix = False
        if self.is_windows:
            try:
                # Check if docker is natively available on Windows CMD
                subprocess.run(["docker", "ps"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            except Exception:
                # Natively not available, try wsl prefix
                try:
                    subprocess.run(["wsl", "docker", "ps"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
                    self.use_wsl_prefix = True
                    logger.info("Detected Windows host. Using 'wsl' prefix for Docker CLI commands.")
                except Exception:
                    logger.error("Docker command not found natively or via WSL.")

    def _run_cmd(self, args: list) -> subprocess.CompletedProcess:
        cmd = []
        if self.use_wsl_prefix:
            cmd.extend(["wsl"])
        cmd.extend(args)
        logger.info(f"Executing: {' '.join(cmd)}")
        return subprocess.run(cmd, capture_output=True, text=True, check=True)

    def build_image(self, source_dir: str, image_name: str) -> None:
        """Builds a docker image from a source directory containing a Dockerfile"""
        if not self.use_cli_fallback:
            try:
                logger.info(f"Building image {image_name} from {source_dir} via SDK")
                self.client.images.build(path=source_dir, tag=image_name, rm=True)
                return
            except Exception as e:
                logger.warning(f"SDK build failed: {e}. Trying CLI fallback.")

        # CLI Fallback
        wsl_dir = source_dir
        if self.use_wsl_prefix:
            # Convert Windows path (e.g. D:\path) to WSL path (/mnt/d/path)
            wsl_dir = wsl_dir.replace("\\", "/")
            if len(wsl_dir) >= 3 and wsl_dir[1] == ":" and wsl_dir[2] == "/":
                drive = wsl_dir[0].lower()
                wsl_dir = f"/mnt/{drive}/{wsl_dir[3:]}"

        self._run_cmd(["docker", "build", "-t", image_name, wsl_dir])

    def run_container(self, image: str, env: dict = None) -> tuple[str, str]:
        """Spins up a new container in detached mode and returns (container_id, target_addr)"""
        env = env or {}
        if not self.use_cli_fallback:
            try:
                logger.info(f"Running container for {image} via SDK")
                # Bind container port 80 to a random available port on host
                container = self.client.containers.run(
                    image,
                    detach=True,
                    environment=env,
                    ports={"80/tcp": None} # None maps to a random host port
                )
                # Reload container to get current attributes
                container.reload()
                ports = container.attrs.get("NetworkSettings", {}).get("Ports", {})
                http_port = ports.get("80/tcp", [{}])[0].get("HostPort")
                
                if not http_port:
                    container.remove(force=True)
                    raise Exception("No port mapping found for container port 80")
                
                target_addr = f"127.0.0.1:{http_port}"
                return container.id, target_addr
            except Exception as e:
                logger.warning(f"SDK run failed: {e}. Trying CLI fallback.")

        # CLI Fallback
        # Run container
        cmd = ["docker", "run", "-d", "-p", "80"]
        for k, v in env.items():
            cmd.extend(["-e", f"{k}={v}"])
        cmd.append(image)
        
        res = self._run_cmd(cmd)
        container_id = res.stdout.strip()
        if not container_id:
            raise Exception("No container ID returned from docker run")

        # Inspect port
        try:
            port_res = self._run_cmd(["docker", "port", container_id, "80"])
            port_lines = port_res.stdout.strip().split("\n")
            if not port_lines or not port_lines[0]:
                self.stop_container(container_id)
                raise Exception("No port mapping returned from docker port")
            
            # format e.g. 0.0.0.0:32768
            parts = port_lines[0].split(":")
            host_port = parts[-1].strip()
            target_addr = f"127.0.0.1:{host_port}"
            return container_id, target_addr
        except Exception as e:
            self.stop_container(container_id)
            raise e

    def stop_container(self, container_id: str) -> None:
        """Stops and removes container by ID"""
        if not self.use_cli_fallback:
            try:
                container = self.client.containers.get(container_id)
                container.remove(force=True)
                return
            except Exception as e:
                logger.warning(f"SDK stop failed: {e}. Trying CLI fallback.")

        # CLI Fallback
        try:
            self._run_cmd(["docker", "rm", "-f", container_id])
        except Exception as e:
            logger.error(f"Failed to stop container {container_id}: {e}")

    def get_container_logs(self, container_id: str) -> str:
        """Retrieves last 100 lines of logs for a container"""
        if not self.use_cli_fallback:
            try:
                container = self.client.containers.get(container_id)
                return container.logs(tail=100).decode("utf-8", errors="replace")
            except Exception as e:
                logger.warning(f"SDK logs fetch failed: {e}. Trying CLI fallback.")

        # CLI Fallback
        res = self._run_cmd(["docker", "logs", "--tail", "100", container_id])
        # docker logs combines stdout and stderr
        return res.stdout + res.stderr
