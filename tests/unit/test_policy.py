from backend.services.command.policy import check_policy, CommandPolicy

def test_allow_safe_commands():
    # ps_aux operation
    policy, msg = check_policy("ps_aux", {})
    assert policy == CommandPolicy.ALLOW
    
    # ls operation
    policy, msg = check_policy("ls", {"path": "/root"})
    assert policy == CommandPolicy.ALLOW

    # safe raw command
    policy, msg = check_policy("run_raw", {"command": "echo hello"})
    assert policy == CommandPolicy.ALLOW

def test_confirm_state_changing_commands():
    # apt_get_install operation
    policy, msg = check_policy("apt_get_install", {"pkg": "curl"})
    assert policy == CommandPolicy.CONFIRM

    # kill operation
    policy, msg = check_policy("kill", {"pid": "1234"})
    assert policy == CommandPolicy.CONFIRM

    # confirm raw commands
    policy, msg = check_policy("run_raw", {"command": "apt install -y vim"})
    assert policy == CommandPolicy.CONFIRM

    policy, msg = check_policy("run_raw", {"command": "docker rm my-container"})
    assert policy == CommandPolicy.CONFIRM

def test_deny_dangerous_commands():
    # rm -rf / raw command
    policy, msg = check_policy("run_raw", {"command": "rm -rf /"})
    assert policy == CommandPolicy.DENY

    # reboot raw command
    policy, msg = check_policy("run_raw", {"command": "reboot"})
    assert policy == CommandPolicy.DENY

    # fork bomb
    policy, msg = check_policy("run_raw", {"command": ":(){ :|:& };:"})
    assert policy == CommandPolicy.DENY
