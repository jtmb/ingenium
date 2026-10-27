#!/usr/bin/env python3
"""Publish an already built Ingenium image; never deploy or put credentials in files."""
import argparse
import base64
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import urllib.error
import urllib.request

REPOSITORY = "jtmb92/ingenium"
SOURCE = "https://github.com/jtmb/ingenium"
PYTHON = "/mnt/c/Users/james/AppData/Local/Programs/Python/Python312/python.exe"
GIB = 1024**3
ACCEPT = ", ".join(["application/vnd.oci.image.index.v1+json", "application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json", "application/vnd.docker.distribution.manifest.v2+json"])


def need(value, reason):
    if not value:
        raise RuntimeError(reason)


def command(args, **kwargs):
    r = subprocess.run(args, capture_output=True, timeout=kwargs.pop("timeout", 30), **kwargs)
    need(r.returncode == 0, "command_failed:" + Path(args[0]).name)
    return r.stdout


def write(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def registry_token(helper):
    # This stdout is consumed in memory only and never printed or persisted.
    windows = "\\\\wsl.localhost\\Ubuntu" + str(helper).replace("/", "\\")
    raw = command([PYTHON, "-I", "-B", windows, "get"], input=b"https://index.docker.io/v1/\n")
    need(len(raw) <= 8192, "credential_response_bound")
    value = json.loads(raw)
    need(value.get("Username") == "jtmb92", "credential_account_changed")
    basic = base64.b64encode((value["Username"] + ":" + value["Secret"]).encode()).decode()
    req = urllib.request.Request("https://auth.docker.io/token?service=registry.docker.io&scope=repository:" + REPOSITORY + ":pull,push", headers={"Authorization": "Basic " + basic})
    with urllib.request.urlopen(req, timeout=30) as response:
        token = json.loads(response.read(65537))["token"]
    access = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "==="))["access"]
    need(any(v["name"] == REPOSITORY and {"pull", "push"} <= set(v["actions"]) for v in access), "repository_push_grant_missing")
    return token


def document(token, name, kind="manifests", missing=False):
    req = urllib.request.Request("https://registry-1.docker.io/v2/" + REPOSITORY + "/" + kind + "/" + name, headers={"Authorization": "Bearer " + token, "Accept": ACCEPT})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read(4 * 1024**2 + 1)
            need(len(raw) <= 4 * 1024**2, "registry_document_bound")
            digest = "sha256:" + hashlib.sha256(raw).hexdigest()
            need(not response.headers.get("Docker-Content-Digest") or response.headers["Docker-Content-Digest"] == digest, "registry_digest_mismatch")
            return {"digest": digest, "value": json.loads(raw)}
    except urllib.error.HTTPError as error:
        if missing and error.code == 404:
            return None
        raise RuntimeError("registry_http_" + str(error.code)) from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--probe", action="store_true")
    args = parser.parse_args()
    need(re.fullmatch(r"[a-f0-9]{40}", args.revision), "full_revision_required")
    root = args.output_root
    need(root.is_absolute() and root == root.resolve() and root.is_dir() and not root.is_symlink(), "owned_existing_root_required")
    need(root.stat().st_uid == os.getuid() and not root.stat().st_mode & 0o077, "owner_private_root_required")
    free = int(command([PYTHON, "-I", "-B", "-c", "import shutil; print(shutil.disk_usage('C:/').free)"]).decode().strip())
    need(free >= 15 * GIB and shutil.disk_usage(root).free >= 15 * GIB, "storage_reserve_failed")
    repo = Path(__file__).resolve().parent.parent
    git = ["git", "-c", "safe.directory=" + str(repo), "-C", str(repo)]
    need(command(git + ["remote", "get-url", "origin"]).decode().strip().removesuffix(".git") == SOURCE, "owned_source_required")
    need(command(git + ["rev-parse", args.revision + "^{commit}"]).decode().strip() == args.revision, "source_commit_missing")
    image = json.loads(command(["docker", "image", "inspect", args.image]))[0]
    labels = image["Config"].get("Labels", {})
    source_hash = labels.get("org.ingenium.source.sha256", "")
    need(labels.get("org.opencontainers.image.revision") == args.revision and labels.get("org.opencontainers.image.source") == SOURCE and re.fullmatch(r"[a-f0-9]{64}", source_hash), "image_provenance_mismatch")
    helper = Path(__file__).resolve().with_name("windows-docker-credential.py")
    lock = os.open(root / "publisher.lock", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    record = {"revision": args.revision, "source": SOURCE, "sourceSha256": source_hash, "localImageId": image["Id"], "repository": REPOSITORY, "credentialsSaved": False, "deployed": False, "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "helperSha256": hashlib.sha256(helper.read_bytes()).hexdigest()}
    client = root / "client"
    name = "git-" + args.revision
    target = "docker.io/" + REPOSITORY + ":" + name
    try:
        token = registry_token(helper)
        previous = document(token, name, missing=True)
        record.update(pushGrantVerified=True, priorTagPresent=previous is not None)
        if args.probe:
            record["state"] = "probe-only"
        elif previous:
            need(previous["digest"] == image["Id"], "existing_tag_differs_no_overwrite")
            record.update(state="existing-exact-image", digest=previous["digest"])
        else:
            need(not client.exists(), "client_scratch_already_exists")
            (client / "bin").mkdir(parents=True, mode=0o700)
            (client / "config").mkdir(mode=0o700)
            windows = "\\\\wsl.localhost\\Ubuntu" + str(helper).replace("/", "\\")
            launcher = client / "bin/docker-credential-ingenium-windows"
            launcher.write_text("#!/usr/bin/python3\nimport subprocess,sys\np=subprocess.run(" + repr([PYTHON, "-I", "-B", windows]) + "+sys.argv[1:],input=sys.stdin.buffer.read(4097),stdout=sys.stdout.buffer,stderr=subprocess.DEVNULL)\nraise SystemExit(p.returncode)\n")
            launcher.chmod(0o700)
            write(client / "config/config.json", {"credsStore": "ingenium-windows"})
            env = {**os.environ, "DOCKER_CONFIG": str(client / "config"), "PATH": str(client / "bin") + ":/usr/local/bin:/usr/bin:/bin"}
            command(["docker", "tag", args.image, target], env=env)
            with (root / "push.log").open("xb") as log:
                pushed = subprocess.run(["docker", "push", target], env=env, stdout=log, stderr=subprocess.STDOUT, timeout=1200)
            need(pushed.returncode == 0, "push_failed_no_deployment")
            token = registry_token(helper)
            remote = document(token, name)
            need(remote["digest"] == image["Id"], "published_root_digest_differs")
            descriptor = remote["value"]
            if "manifests" in descriptor:
                matches = [x for x in descriptor["manifests"] if x.get("platform", {}).get("os") == "linux" and x.get("platform", {}).get("architecture") == "amd64"]
                need(len(matches) == 1, "single_amd64_manifest_required")
                descriptor = document(token, matches[0]["digest"])["value"]
            config = document(token, descriptor["config"]["digest"], kind="blobs")["value"]
            need(config.get("config", {}).get("Labels", {}) == labels, "published_labels_differ")
            record.update(state="published-not-qualified-not-deployed", digest=remote["digest"], reference="docker.io/" + REPOSITORY + "@" + remote["digest"], tag=target)
        return 0
    except Exception as error:
        record.update(state="failed-no-deployment", errorType=type(error).__name__, errorCode=str(error) if isinstance(error, RuntimeError) else "details-withheld")
        return 1
    finally:
        if client.exists():
            need(client.resolve().parent == root and not client.is_symlink(), "client_cleanup_containment")
            shutil.rmtree(client)
        record["helperUnchanged"] = record["helperSha256"] == hashlib.sha256(helper.read_bytes()).hexdigest()
        write(root / "publication.json", record)
        print(json.dumps({k: record.get(k) for k in ["state", "reference", "digest", "revision", "errorCode"]}))
        os.close(lock)


if __name__ == "__main__":
    raise SystemExit(main())
