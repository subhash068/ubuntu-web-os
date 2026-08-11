import subprocess
import logging

logger = logging.getLogger("git_manager")

class GitManager:
    def clone(self, repo_url: str, dest_dir: str) -> None:
        """Clones a Git repository to the specified destination directory"""
        logger.info(f"Cloning Git repo {repo_url} to {dest_dir}")
        try:
            # Run git clone with a timeout of 60 seconds
            subprocess.run(
                ["git", "clone", "--depth", "1", repo_url, dest_dir],
                capture_output=True,
                text=True,
                check=True,
                timeout=60
            )
            logger.info("Successfully cloned repository.")
        except subprocess.CalledProcessError as e:
            logger.error(f"Git clone failed: {e.stderr}")
            raise Exception(f"Failed to clone git repository: {e.stderr}")
        except subprocess.TimeoutExpired:
            logger.error("Git clone timed out after 60 seconds")
            raise Exception("Git clone operation timed out")
