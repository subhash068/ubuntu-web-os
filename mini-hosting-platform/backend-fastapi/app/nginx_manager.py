import os
import subprocess
import logging
from jinja2 import Template

logger = logging.getLogger("nginx_manager")

class NginxManager:
    def __init__(self):
        # Allow configuring directories and reload commands via env vars
        self.nginx_dir = os.getenv("NGINX_SITES_DIR", "/etc/nginx/sites-enabled")
        self.template_path = os.getenv("NGINX_TEMPLATE_PATH", "../nginx.conf")
        self.reload_cmd = os.getenv("NGINX_RELOAD_CMD", "sudo nginx -s reload")
        
        # Check if we are running on Windows host (where we might need WSL to reload nginx)
        import sys
        self.is_windows = sys.platform.startswith("win")
        self.use_wsl = os.getenv("NGINX_USE_WSL", "true").lower() == "true" and self.is_windows

    def _get_template(self) -> Template:
        if not os.path.exists(self.template_path):
            # Fallback relative to this file
            fallback_path = os.path.join(os.path.dirname(__file__), "../../nginx.conf")
            if os.path.exists(fallback_path):
                self.template_path = fallback_path
            else:
                # Direct string fallback if template file is missing
                return Template("""
server {
    listen 80;
    server_name {{ domain }};
    location / {
        proxy_pass http://{{ target_addr }};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
""")
        with open(self.template_path, "r") as f:
            return Template(f.read())

    def add_site(self, domain: str, target_addr: str) -> None:
        """Generates an Nginx config file for a domain routing to a container target address"""
        logger.info(f"Adding Nginx site mapping: {domain} -> {target_addr}")
        try:
            template = self._get_template()
            config_content = template.render(domain=domain, target_addr=target_addr)
            
            # Sanitized config file name
            filename = f"mhp-{domain.replace('*', 'wildcard')}.conf"
            filepath = os.path.join(self.nginx_dir, filename)
            
            # Make sure directory exists if we are running locally (or mock it)
            if not os.path.exists(self.nginx_dir):
                os.makedirs(self.nginx_dir, exist_ok=True)
                
            with open(filepath, "w") as f:
                f.write(config_content)
            logger.info(f"Nginx config written to {filepath}")
            
            self.reload_nginx()
        except Exception as e:
            logger.error(f"Failed to add Nginx site: {e}")
            raise Exception(f"Failed to configure Nginx site: {e}")

    def remove_site(self, domain: str) -> None:
        """Removes the Nginx configuration file for a domain"""
        logger.info(f"Removing Nginx site mapping for domain: {domain}")
        try:
            filename = f"mhp-{domain.replace('*', 'wildcard')}.conf"
            filepath = os.path.join(self.nginx_dir, filename)
            
            if os.path.exists(filepath):
                os.remove(filepath)
                logger.info(f"Removed config file {filepath}")
                self.reload_nginx()
            else:
                logger.warning(f"Nginx config for {domain} did not exist.")
        except Exception as e:
            logger.error(f"Failed to remove Nginx site: {e}")
            raise Exception(f"Failed to remove Nginx site: {e}")

    def configure_ssl(self, domain: str) -> None:
        """Invokes Certbot to provision Let's Encrypt SSL certificates for a domain"""
        logger.info(f"Configuring Let's Encrypt SSL for domain: {domain}")
        try:
            cmd = []
            if self.use_wsl:
                cmd.extend(["wsl"])
            
            # Request cert and configure Nginx automatically
            cmd.extend([
                "sudo", "certbot", "--nginx", 
                "-d", domain, 
                "--non-interactive", 
                "--agree-tos", 
                "--email", os.getenv("SSL_EMAIL", "admin@localhost")
            ])
            
            logger.info(f"Running Certbot: {' '.join(cmd)}")
            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode != 0:
                logger.warning(f"Certbot returned code {res.returncode}. Stderr: {res.stderr}")
            else:
                logger.info(f"SSL certificate configured successfully for {domain}")
        except Exception as e:
            logger.warning(f"Could not provision SSL via Certbot: {e} (Expected if local/offline)")

    def reload_nginx(self) -> None:
        """Triggers Nginx configuration reload"""
        logger.info("Reloading Nginx config...")
        try:
            cmd = []
            if self.use_wsl:
                cmd.extend(["wsl"])
            
            # Split the reload command string into tokens
            cmd.extend(self.reload_cmd.split())
            
            logger.info(f"Running reload command: {' '.join(cmd)}")
            # Run without throwing error if it fails (allows mock/local runs where nginx isn't present)
            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode != 0:
                logger.warning(f"Nginx reload returned code {res.returncode}. Stderr: {res.stderr}")
            else:
                logger.info("Nginx reloaded successfully.")
        except Exception as e:
            logger.warning(f"Could not reload Nginx (this is expected if running on a machine without Nginx installed): {e}")
