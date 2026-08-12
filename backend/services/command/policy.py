class CommandPolicy:
    ALLOW = "ALLOW"
    CONFIRM = "REQUIRE CONFIRMATION"
    DENY = "DENY"

# List of explicitly denied commands/keywords
DENIED_KEYWORDS = [
    "rm -rf /",
    "shutdown",
    "reboot",
    "poweroff",
    "halt",
    "init 0",
    "init 6",
    ":(){",
    "mkfs"
]

# List of commands requiring confirmation
CONFIRM_KEYWORDS = [
    "apt-get install",
    "apt install",
    "apt-get remove",
    "apt remove",
    "apt-get purge",
    "apt purge",
    "docker rm",
    "docker stop",
    "docker system prune",
    "docker compose down",
    "kill -9",
    "kill "
]

def check_policy(op: str, args: dict) -> tuple[str, str]:
    """
    Evaluates policy for a given structured operation.
    Returns: (policy_status, message)
    """
    # 1. Operation-level check
    if op in ("apt_get_install", "apt_get_remove", "kill"):
        return CommandPolicy.CONFIRM, f"Operation '{op}' requires user confirmation."
        
    # 2. Raw command checks (if running terminal command or raw scripts)
    if op == "run_raw" or op == "command":
        command_str = args.get("command", "").strip()
        if not command_str:
            return CommandPolicy.ALLOW, "Empty command"
            
        # Check DENY first
        for keyword in DENIED_KEYWORDS:
            if keyword in command_str:
                return CommandPolicy.DENY, f"Command contains forbidden expression: '{keyword}'"
                
        # Check CONFIRM second
        for keyword in CONFIRM_KEYWORDS:
            if keyword in command_str:
                return CommandPolicy.CONFIRM, f"Command requires confirmation due to: '{keyword}'"

    # Default to ALLOW
    return CommandPolicy.ALLOW, "Command allowed"
