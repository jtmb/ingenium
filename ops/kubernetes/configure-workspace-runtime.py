#!/usr/bin/env python3
"""Review or stage the dedicated Work handler; never restart a service or use sudo."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import stat
import subprocess

DIRECTORY = Path('/etc/containerd-k8s')
CONFIG = DIRECTORY / 'config.toml'
BASE = DIRECTORY / 'veyra-workspace-base.json'
BACKUP = DIRECTORY / 'config.toml.veyra-workspace-original'
BINARY = Path('/opt/containerd-k8s/bin/containerd')
CTR = Path('/opt/containerd-k8s/bin/ctr')


def digest(value):
    return hashlib.sha256(value).hexdigest()


def owned(path, directory=False):
    entry = path.lstat()
    if (path.resolve() != path or entry.st_uid != 0 or entry.st_mode & 0o022
            or not (stat.S_ISDIR(entry.st_mode) if directory else stat.S_ISREG(entry.st_mode))
            or (not directory and entry.st_nlink != 1)):
        raise RuntimeError('Unsafe runtime file ownership: ' + str(path))
    return entry


def stable_read(path):
    before = owned(path)
    with path.open('rb') as stream:
        data = stream.read(1048577)
        opened = os.fstat(stream.fileno())
    after = owned(path)
    fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_uid', 'st_gid', 'st_mode')
    if len(data) > 1048576 or any(getattr(before, k) != getattr(row, k) for row in (opened, after) for k in fields):
        raise RuntimeError('Runtime input changed while reading')
    return data, before


def command(arguments, pass_fds=()):
    result = subprocess.run(arguments, capture_output=True, timeout=15, pass_fds=pass_fds)
    if result.returncode:
        raise RuntimeError('Runtime configuration command failed; private output withheld')
    return result.stdout


def effective(data):
    fd = os.memfd_create('veyra-workspace-configuration', 0)
    try:
        with os.fdopen(os.dup(fd), 'wb') as stream:
            stream.write(data)
        os.lseek(fd, 0, os.SEEK_SET)
        return command([str(BINARY), '--config', '/proc/self/fd/' + str(fd), 'config', 'dump'], (fd,))
    finally:
        os.close(fd)


def create_owned(path, data, mode=0o600, gid=0):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        os.fchown(fd, 0, gid)
        os.fchmod(fd, mode)
        with os.fdopen(os.dup(fd), 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Root-only staging after the node change is approved; no daemon restart')
    parser.add_argument('--expected-node', required=True)
    parser.add_argument('--expected-configuration', required=True)
    parser.add_argument('--expected-effective', required=True)
    parser.add_argument('--expected-candidate-effective', required=True)
    parser.add_argument('--expected-base', required=True)
    fragments = parser.add_mutually_exclusive_group()
    fragments.add_argument('--fragment-file', type=Path)
    fragments.add_argument('--fragment-text')
    args = parser.parse_args()
    if socket.gethostname() != args.expected_node:
        raise RuntimeError('Selected node differs')
    if args.apply and os.geteuid() != 0:
        raise RuntimeError('Approved administrator execution required; no sudo or alternate identity is attempted')
    for path in (Path('/etc'), DIRECTORY, Path('/opt'), Path('/opt/containerd-k8s'), BINARY.parent):
        owned(path, directory=True)
    for path in (BINARY, CTR):
        owned(path)
    raw, original = stable_read(CONFIG)
    if digest(raw) != args.expected_configuration or digest(effective(raw)) != args.expected_effective:
        raise RuntimeError('Reviewed configuration changed')
    fragment_file = args.fragment_file or Path(__file__).resolve().parents[2] / 'config/kubernetes/containerd-workspace-runtime.toml'
    fragment = args.fragment_text if args.fragment_text is not None else fragment_file.read_text()
    candidate = raw + b'\n' + fragment.encode()
    spec = json.loads(command([str(CTR), 'oci', 'spec']))
    spec['linux'].setdefault('resources', {}).setdefault('pids', {})['limit'] = 128
    base = (json.dumps(spec, indent=2, sort_keys=True) + '\n').encode()
    if digest(base) != args.expected_base or digest(effective(candidate)) != args.expected_candidate_effective:
        raise RuntimeError('Reviewed handler or base specification changed')
    if stable_read(CONFIG)[0] != raw:
        raise RuntimeError('Configuration changed during review')
    report = {'node': args.expected_node, 'configurationSha256': digest(raw),
              'candidateSha256': digest(candidate), 'baseSha256': digest(base),
              'configurationStaged': False, 'serviceRestarted': False,
              'runtimeClassCreated': False, 'kernelEnforcementQualified': False}
    if args.apply:
        staged = DIRECTORY / '.veyra-workspace-config.new'
        if any(path.exists() or path.is_symlink() for path in (BASE, BACKUP, staged)):
            raise RuntimeError('Existing Work configuration or recovery files require reconciliation')
        # Exclusive names preserve originals and interrupted staging. No failure
        # path deletes recovery evidence or replaces an unexpected configuration.
        create_owned(BACKUP, raw)
        create_owned(BASE, base)
        create_owned(staged, candidate, stat.S_IMODE(original.st_mode), original.st_gid)
        current, current_stat = stable_read(CONFIG)
        if current != raw or (current_stat.st_dev, current_stat.st_ino) != (original.st_dev, original.st_ino):
            raise RuntimeError('Configuration changed before staging; recovery files retained')
        os.replace(staged, CONFIG)
        fd = os.open(DIRECTORY, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        if stable_read(CONFIG)[0] != candidate or digest(command([str(BINARY), '--config', str(CONFIG), 'config', 'dump'])) != args.expected_candidate_effective:
            raise RuntimeError('Staged configuration verification failed; original backup retained')
        report.update(configurationStaged=True, originalBackup=str(BACKUP), restartRequired='containerd-k8s.service')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
