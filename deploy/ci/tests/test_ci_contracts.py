import os
import pathlib
import stat
import subprocess
import tempfile
import textwrap
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[3]
WORKFLOW = (ROOT / ".github/workflows/ci-cd.yml").read_text(encoding="utf-8")
DEPLOY = (ROOT / "deploy/ci/deploy-service.sh").read_text(encoding="utf-8")
WRAPPER = (ROOT / "deploy/ci/toowix-deploy").read_text(encoding="utf-8")
COMMON = (ROOT / "deploy/ci/common.sh").read_text(encoding="utf-8")
INSTALLER = (ROOT / "deploy/ci/install-server.sh").read_text(encoding="utf-8")
VALIDATE = (ROOT / "deploy/ci/validate-config.sh").read_text(encoding="utf-8")


def write_executable(path, content):
    path.write_text(textwrap.dedent(content), encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def run_deploy(current_image, fail_first_health=False):
    service = "super-admin"
    tag = "sha-" + "c" * 40
    target = f"ghcr.io/prathmesh-dhk/toowix-{service}:{tag}"
    with tempfile.TemporaryDirectory() as raw:
        root = pathlib.Path(raw)
        ci = root / "ci"
        ci.mkdir()
        common = root / "common.sh"
        operations = root / "operations.log"
        common.write_text(
            textwrap.dedent(
                """\
                STATE="$HARNESS_ROOT/state"
                CI_DIR="$HARNESS_ROOT/ci"
                mkdir -p "$STATE"
                check_service() { [[ "$1" == super-admin ]]; }
                lock() { :; }
                assert_project() { :; }
                container_name() { echo "toowix-prod-$1"; }
                image_var() { echo SUPER_ADMIN_IMAGE; }
                image_repo() { echo "ghcr.io/prathmesh-dhk/toowix-$1"; }
                docker() {
                  printf 'docker %s\\n' "$*" >> "$HARNESS_ROOT/operations.log"
                  if [[ "$1" == inspect && "$2" == -f ]]; then
                    if [[ "$3" == *Config.Image* ]]; then printf '%s\\n' "$CURRENT_IMAGE";
                    else printf 'sha256:%064d\\n' 0; fi
                  elif [[ "$1" == image && "$2" == inspect ]]; then
                    printf 'sha256:%064d\\n' 1
                  fi
                }
                compose() {
                  printf 'compose image=%s args=%s\\n' "${SUPER_ADMIN_IMAGE:-unset}" "$*" >> "$HARNESS_ROOT/operations.log"
                }
                """
            ),
            encoding="utf-8",
        )
        write_executable(ci / "validate-config.sh", "#!/usr/bin/env bash\nexit 0\n")
        write_executable(
            ci / "health-check.sh",
            """
            #!/usr/bin/env bash
            echo health >> "$HARNESS_ROOT/operations.log"
            if [[ "${FAIL_FIRST_HEALTH:-0}" == 1 && ! -e "$HARNESS_ROOT/failed-once" ]]; then
              touch "$HARNESS_ROOT/failed-once"
              exit 1
            fi
            """,
        )
        script = root / "deploy-service.sh"
        script.write_text(
            DEPLOY.replace(
                "source /root/toowix-mail-platform/deploy/ci/common.sh",
                'source "$HARNESS_COMMON"',
            ),
            encoding="utf-8",
        )
        env = os.environ.copy()
        env.update(
            HARNESS_ROOT=str(root),
            HARNESS_COMMON=str(common),
            CURRENT_IMAGE=current_image,
            FAIL_FIRST_HEALTH="1" if fail_first_health else "0",
        )
        result = subprocess.run(
            ["bash", str(script), service, tag],
            check=False,
            capture_output=True,
            text=True,
            env=env,
        )
        return result, operations.read_text(encoding="utf-8"), target


def prepare_installer_harness(root):
    deploy = root / "deploy"
    ci = deploy / "ci"
    bin_dir = root / "bin"
    ci.mkdir(parents=True)
    bin_dir.mkdir()
    for name in (
        "common.sh",
        "deploy-service.sh",
        "health-check.sh",
        "rollback-service.sh",
        "validate-config.sh",
        "toowix-deploy",
    ):
        path = ci / name
        path.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
        path.chmod(0o644)
    (deploy / "docker-compose.prod.yml").write_text("services: {}\n", encoding="utf-8")
    (deploy / ".env").write_text("SECRET=preserved\n", encoding="utf-8")
    (deploy / "docker-compose.prod.yml").chmod(0o644)
    (deploy / ".env").chmod(0o600)
    write_executable(
        bin_dir / "id",
        """
        #!/usr/bin/env bash
        if [[ "$1" == -u ]]; then /usr/bin/id -u
        elif [[ "$1" == -nG ]]; then echo "$2"
        else exit 0
        fi
        """,
    )
    write_executable(bin_dir / "chown", "#!/usr/bin/env bash\nexit 0\n")
    write_executable(bin_dir / "visudo", "#!/usr/bin/env bash\nexit 0\n")
    write_executable(bin_dir / "sudo", "#!/usr/bin/env bash\nexit 0\n")
    write_executable(
        bin_dir / "install",
        """
        #!/usr/bin/env bash
        mode=755; directory=0; args=()
        while (( $# )); do
          case "$1" in
            -o|-g) shift 2 ;;
            -m) mode=$2; shift 2 ;;
            -d) directory=1; shift ;;
            *) args+=("$1"); shift ;;
          esac
        done
        if (( directory )); then
          /usr/bin/mkdir -p "${args[-1]}"
          /usr/bin/chmod "$mode" "${args[-1]}"
        else
          /usr/bin/mkdir -p "$(/usr/bin/dirname "${args[-1]}")"
          /usr/bin/install -m "$mode" "${args[-2]}" "${args[-1]}"
        fi
        """,
    )
    script = root / "install-server.sh"
    transformed = INSTALLER
    transformed = transformed.replace(
        "export PATH=/usr/sbin:/usr/bin:/sbin:/bin",
        'export PATH="$TEST_BIN:/usr/sbin:/usr/bin:/sbin:/bin"',
    )
    transformed = transformed.replace("DEPLOY_DIR=/root/toowix-mail-platform/deploy", 'DEPLOY_DIR="$TEST_DEPLOY_DIR"')
    transformed = transformed.replace("WRAPPER=/usr/local/sbin/toowix-deploy", 'WRAPPER="$TEST_WRAPPER"')
    transformed = transformed.replace("RUNNER_USER=github-runner", 'RUNNER_USER="$TEST_RUNNER_USER"')
    transformed = transformed.replace("SUDOERS_FILE=/etc/sudoers.d/toowix-runner", 'SUDOERS_FILE="$TEST_SUDOERS"')
    transformed = transformed.replace("== 0 ]]", '== "$TEST_UID" ]]')
    script.write_text(transformed, encoding="utf-8")
    env = os.environ.copy()
    env.update(
        TEST_BIN=str(bin_dir),
        TEST_DEPLOY_DIR=str(deploy),
        TEST_WRAPPER=str(root / "installed/toowix-deploy"),
        TEST_RUNNER_USER="github-runner",
        TEST_SUDOERS=str(root / "sudoers/toowix-runner"),
        TEST_UID=str(os.getuid()),
    )
    return script, deploy, env


class DeploymentContractTests(unittest.TestCase):
    def test_changed_service_builds_and_deploys_only_selected_sha_image(self):
        for service, output in (
            ("backend", "backend"),
            ("super-admin", "super_admin"),
            ("tenant-admin", "tenant_admin"),
        ):
            self.assertIn(f"needs.changes.outputs.{output} == 'true'", WORKFLOW)
            self.assertIn(f"toowix-deploy deploy {service} sha-${{{{ github.sha }}}}", WORKFLOW)
            self.assertIn(f"ghcr.io/prathmesh-dhk/toowix-{service}:sha-${{{{ github.sha }}}}", WORKFLOW)

    def test_no_deployable_change_skips_production(self):
        gate = (
            "needs.changes.outputs.backend == 'true' || "
            "needs.changes.outputs.super_admin == 'true' || "
            "needs.changes.outputs.tenant_admin == 'true'"
        )
        self.assertIn(gate, WORKFLOW)

    def test_invalid_server_state_fails_before_registry_login(self):
        validate = WORKFLOW.index("toowix-deploy validate")
        login = WORKFLOW.index("toowix-deploy login")
        self.assertLess(validate, login)
        self.assertIn('sudo -u "$RUNNER_USER" sudo -n "$WRAPPER" validate', INSTALLER)

    def test_validation_checks_captured_service_list_without_pipefail_race(self):
        self.assertIn("services=$(compose config --services)", VALIDATE)
        self.assertIn('grep -Fxq "$svc" <<<"$services"', VALIDATE)
        self.assertNotIn('compose config --services | grep', VALIDATE)

    def test_failed_rollout_restores_previous_image(self):
        if os.name == "nt":
            self.skipTest("deployment behavior harness requires Bash")
        result, operations, target = run_deploy("old-local-image", fail_first_health=True)
        self.assertNotEqual(0, result.returncode)
        self.assertIn(f"compose image={target}", operations)
        self.assertIn("compose image=sha256:" + "0" * 64, operations)
        self.assertEqual(2, operations.count("health"))
        self.assertNotIn("mongodb", operations)
        self.assertNotIn("webmail", operations)
        self.assertNotIn("stalwart", operations)

    def test_repeated_deployment_is_idempotent_and_health_checked(self):
        if os.name == "nt":
            self.skipTest("deployment behavior harness requires Bash")
        tag = "sha-" + "c" * 40
        target = f"ghcr.io/prathmesh-dhk/toowix-super-admin:{tag}"
        result, operations, _ = run_deploy(target)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(1, operations.count("health"))
        self.assertNotIn("docker pull", operations)
        self.assertNotIn("docker tag", operations)
        self.assertNotIn("compose ", operations)

    def test_wrapper_accepts_only_allowlisted_services_and_full_sha_tags(self):
        self.assertIn("backend|super-admin|tenant-admin", WRAPPER)
        self.assertIn("^sha-[a-f0-9]{40}$", WRAPPER)
        self.assertIn("logout) (( $# == 0 ))", WRAPPER)
        self.assertIn("export DOCKER_CONFIG=$DEPLOY_DIR/.docker-deploy", COMMON)
        self.assertIn("if: always() && steps.ghcr_login.outcome == 'success'", WORKFLOW)

    def test_wrapper_logout_targets_only_ghcr_and_rejects_arguments(self):
        if os.name == "nt":
            self.skipTest("wrapper behavior harness requires Bash")
        with tempfile.TemporaryDirectory() as raw:
            root = pathlib.Path(raw)
            ci = root / "ci"
            ci.mkdir()
            for name in ("deploy-service.sh", "rollback-service.sh", "validate-config.sh", "health-check.sh"):
                (ci / name).write_text("#!/usr/bin/env bash\n", encoding="utf-8")
            docker = root / "docker"
            write_executable(
                docker,
                """
                #!/usr/bin/env bash
                printf '%s|%s\\n' "$DOCKER_CONFIG" "$*" >> "$WRAPPER_LOG"
                """,
            )
            wrapper = root / "toowix-deploy"
            docker_config = root / "docker-config"
            transformed = WRAPPER.replace("CI=/root/toowix-mail-platform/deploy/ci", f'CI="{ci}"')
            transformed = transformed.replace(
                "export DOCKER_CONFIG=/root/toowix-mail-platform/deploy/.docker-deploy",
                f'export DOCKER_CONFIG="{docker_config}"',
            )
            transformed = transformed.replace("== 0 ]]", f"== {os.getuid()} ]]")
            transformed = transformed.replace("/usr/bin/docker", str(docker))
            wrapper.write_text(transformed, encoding="utf-8")
            log = root / "wrapper.log"
            env = os.environ.copy()
            env["WRAPPER_LOG"] = str(log)
            ok = subprocess.run(["bash", str(wrapper), "logout"], check=False, env=env)
            rejected = subprocess.run(["bash", str(wrapper), "logout", "extra"], check=False, env=env)
            self.assertEqual(0, ok.returncode)
            self.assertEqual(2, rejected.returncode)
            self.assertEqual(f"{docker_config}|logout ghcr.io\n", log.read_text(encoding="utf-8"))

    def test_installer_preserves_secret_values_and_restricts_permissions(self):
        if os.name == "nt":
            self.skipTest("installer harness requires Linux permissions")
        with tempfile.TemporaryDirectory() as raw:
            script, deploy, env = prepare_installer_harness(pathlib.Path(raw))
            first = subprocess.run(["bash", str(script)], check=False, capture_output=True, text=True, env=env)
            second = subprocess.run(["bash", str(script)], check=False, capture_output=True, text=True, env=env)
            self.assertEqual(0, first.returncode, first.stderr)
            self.assertEqual(0, second.returncode, second.stderr)
            self.assertEqual("SECRET=preserved\n", (deploy / ".env.production").read_text(encoding="utf-8"))
            self.assertEqual(0o600, stat.S_IMODE((deploy / ".env").stat().st_mode))
            self.assertEqual(0o600, stat.S_IMODE((deploy / ".env.production").stat().st_mode))
            self.assertEqual(0o640, stat.S_IMODE((deploy / "docker-compose.prod.yml").stat().st_mode))
            self.assertEqual(0o700, stat.S_IMODE(pathlib.Path(env["TEST_WRAPPER"]).stat().st_mode))
            self.assertEqual(0o440, stat.S_IMODE(pathlib.Path(env["TEST_SUDOERS"]).stat().st_mode))
            self.assertEqual(0o700, stat.S_IMODE((deploy / ".docker-deploy").stat().st_mode))

    def test_installer_rejects_environment_symlink(self):
        if os.name == "nt":
            self.skipTest("installer harness requires Linux symlinks")
        with tempfile.TemporaryDirectory() as raw:
            root = pathlib.Path(raw)
            script, deploy, env = prepare_installer_harness(root)
            (deploy / ".env").unlink()
            (deploy / ".env").symlink_to(root / "unrelated-secret")
            result = subprocess.run(["bash", str(script)], check=False, capture_output=True, text=True, env=env)
            self.assertNotEqual(0, result.returncode)
            self.assertIn("unsafe symlink", result.stderr)


if __name__ == "__main__":
    unittest.main()
