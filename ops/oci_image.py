"""Validate and publish an OCI archive without importing it into a daemon store."""
import hashlib
import http.client
import json
from pathlib import Path, PurePosixPath
import re
import tarfile
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

HOST = "registry-1.docker.io"
INDEX = "application/vnd.oci.image.index.v1+json"
MANIFEST = "application/vnd.oci.image.manifest.v1+json"
CONFIG = "application/vnd.oci.image.config.v1+json"
LAYERS = {"application/vnd.oci.image.layer.v1.tar", "application/vnd.oci.image.layer.v1.tar+gzip", "application/vnd.oci.image.layer.v1.tar+zstd"}


def require(value, code):
    if not value:
        raise RuntimeError(code)


class Archive:
    def __init__(self, path):
        self.path = Path(path)
        require(self.path.is_absolute() and self.path.resolve() == self.path and self.path.is_file() and not self.path.is_symlink(), "oci_plain_absolute_archive_required")
        self.identity = self._identity()
        require(0 < self.identity[2] <= 8 * 1024**3, "oci_archive_size_bound")
        self.tar = tarfile.open(self.path, mode="r:")
        try:
            self.members = {}
            for item in self.tar:
                require(len(self.members) < 4096, "oci_member_count_bound")
                name = item.name.rstrip("/") if item.isdir() else item.name
                require(name == str(PurePosixPath(name)) and not name.startswith("/") and ".." not in PurePosixPath(name).parts and "\\" not in name and name not in self.members, "oci_unsafe_or_duplicate_member")
                require(not item.linkname and not item.sparse and not any(key.startswith("GNU.sparse") for key in item.pax_headers), "oci_link_or_sparse_member")
                if item.isdir():
                    require(name in {"blobs", "blobs/sha256"}, "oci_unexpected_directory")
                else:
                    require(item.isfile() and (name in {"index.json", "oci-layout"} or re.fullmatch(r"blobs/sha256/[a-f0-9]{64}", name)), "oci_unexpected_member")
                self.members[name] = item
            require(self.json("oci-layout", 4096) == {"imageLayoutVersion": "1.0.0"}, "oci_layout_version")
            index = self.json("index.json")
            require(index.get("schemaVersion") == 2 and len(index.get("manifests", [])) == 1, "oci_single_root_required")
            self.root = index["manifests"][0]
            platform = self.root.get("platform")
            require(platform is None or (platform.get("os") == "linux" and platform.get("architecture") == "amd64"), "oci_root_platform")
            self.manifests = []
            self.leaves = {}
            self.visited = set()
            configs = []

            def visit(descriptor, depth=0):
                require(depth < 4 and descriptor.get("mediaType") in {INDEX, MANIFEST} and not descriptor.get("urls"), "oci_manifest_type_or_depth")
                name = self.blob(descriptor)
                require(name not in self.visited, "oci_repeated_manifest")
                self.visited.add(name)
                document = self.json(name)
                require(document.get("schemaVersion") == 2 and document.get("mediaType") == descriptor["mediaType"], "oci_manifest_schema")
                if descriptor["mediaType"] == INDEX:
                    children = document.get("manifests", [])
                    require(len(children) == 1 and children[0].get("platform", {}).get("os") == "linux" and children[0].get("platform", {}).get("architecture") == "amd64", "oci_single_linux_amd64_required")
                    visit(children[0], depth + 1)
                else:
                    config = document.get("config", {})
                    require(config.get("mediaType") == CONFIG, "oci_config_type")
                    config_name = self.blob(config)
                    self.visited.add(config_name)
                    self.leaves[config_name] = config
                    configs.append(self.json(config_name))
                    for layer in document.get("layers", []):
                        require(layer.get("mediaType") in LAYERS, "oci_layer_type")
                        layer_name = self.blob(layer)
                        self.visited.add(layer_name)
                        self.leaves[layer_name] = layer
                self.manifests.append((descriptor, name))

            visit(self.root)
            require(len(configs) == 1 and configs[0].get("os") == "linux" and configs[0].get("architecture") == "amd64", "oci_config_platform")
            require({name for name in self.members if name.startswith("blobs/sha256/")} == self.visited, "oci_unreferenced_blob")
            self.labels = configs[0].get("config", {}).get("Labels", {})
            require(isinstance(self.labels, dict) and all(isinstance(key, str) and isinstance(value, str) for key, value in self.labels.items()), "oci_labels_object")
            self.digest = self.root["digest"]
            self.ensure_unchanged()
        except BaseException:
            self.tar.close()
            raise

    def _identity(self):
        info = self.path.stat()
        return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)

    def ensure_unchanged(self):
        require(self._identity() == self.identity, "oci_archive_changed")

    def stream(self, name):
        self.ensure_unchanged()
        stream = self.tar.extractfile(self.members[name])
        require(stream is not None, "oci_missing_file_stream")
        return stream

    def json(self, name, limit=4 * 1024**2):
        require(name in self.members and self.members[name].isfile() and self.members[name].size <= limit, "oci_document_bound_or_missing")
        with self.stream(name) as stream:
            return json.loads(stream.read(limit + 1))

    def blob(self, descriptor):
        digest = descriptor.get("digest", "")
        require(re.fullmatch(r"sha256:[a-f0-9]{64}", digest) and not descriptor.get("urls"), "oci_external_or_invalid_digest")
        require(type(descriptor.get("size")) is int and descriptor["size"] >= 0, "oci_descriptor_size")
        name = "blobs/sha256/" + digest.split(":")[1]
        require(name in self.members and self.members[name].isfile() and self.members[name].size == descriptor.get("size"), "oci_blob_size_or_missing")
        computed = hashlib.sha256()
        with self.stream(name) as stream:
            while chunk := stream.read(1024**2):
                computed.update(chunk)
        require(computed.hexdigest() == digest.split(":")[1], "oci_blob_digest_mismatch")
        return name

    def close(self):
        self.tar.close()


def upload_location(location, repository, digest):
    value = urlsplit(urljoin("https://" + HOST, location))
    require(value.scheme == "https" and value.hostname == HOST and value.port in {None, 443} and not value.username and not value.password and not value.fragment, "registry_upload_origin")
    require(re.fullmatch(r"/v2/" + re.escape(repository) + r"/blobs/uploads/[A-Za-z0-9_-]+", value.path), "registry_upload_path")
    query = parse_qsl(value.query, keep_blank_values=True)
    require(not any(key == "digest" for key, _ in query), "registry_upload_digest_already_set")
    return urlunsplit(("", "", value.path, urlencode([*query, ("digest", digest)]), ""))


class Registry:
    """HTTPS requests never follow redirects or forward bearer tokens elsewhere."""
    def __init__(self, token, repository):
        self.token = token
        self.repository = repository
        self.base = "/v2/" + repository

    def request(self, method, path, *, body=None, size=0, content_type="application/octet-stream"):
        require(path.startswith(self.base + "/") and not urlsplit(path).netloc and not urlsplit(path).scheme, "registry_request_path")
        connection = http.client.HTTPSConnection(HOST, timeout=120)
        try:
            connection.putrequest(method, path)
            connection.putheader("Authorization", "Bearer " + self.token)
            connection.putheader("Content-Type", content_type)
            connection.putheader("Content-Length", str(size))
            connection.endheaders()
            if body is not None:
                remaining = size
                while remaining:
                    chunk = body.read(min(1024**2, remaining))
                    require(chunk, "registry_upload_short_read")
                    connection.send(chunk)
                    remaining -= len(chunk)
            response = connection.getresponse()
            status, headers = response.status, dict(response.getheaders())
            response.read(4096)
            return status, {key.lower(): value for key, value in headers.items()}
        finally:
            connection.close()

    def blob(self, archive, name, descriptor):
        digest = descriptor["digest"]
        status, headers = self.request("HEAD", self.base + "/blobs/" + digest)
        if status == 200:
            require(int(headers.get("content-length", -1)) == descriptor["size"] and headers.get("docker-content-digest", digest) == digest, "registry_existing_blob_differs")
            return
        require(status == 404, "registry_blob_head_failed")
        status, headers = self.request("POST", self.base + "/blobs/uploads/")
        require(status == 202 and "location" in headers, "registry_upload_start_failed")
        target = upload_location(headers["location"], self.repository, digest)
        with archive.stream(name) as stream:
            status, headers = self.request("PUT", target, body=stream, size=descriptor["size"])
        require(status == 201 and headers.get("docker-content-digest") == digest, "registry_blob_commit_failed")

    def manifest(self, archive, descriptor, name, reference):
        with archive.stream(name) as stream:
            status, headers = self.request("PUT", self.base + "/manifests/" + reference, body=stream, size=descriptor["size"], content_type=descriptor["mediaType"])
        require(status == 201 and headers.get("docker-content-digest") == descriptor["digest"], "registry_manifest_commit_failed")

    def upload(self, archive, tag, inspect_tag):
        for name, descriptor in archive.leaves.items():
            self.blob(archive, name, descriptor)
        for descriptor, name in archive.manifests[:-1]:
            self.manifest(archive, descriptor, name, descriptor["digest"])
        # The lock guards this publisher. Recheck the registry after layer upload
        # as well, so a tag created by another publisher is never overwritten.
        previous = inspect_tag()
        if previous:
            require(previous["digest"] == archive.digest, "existing_tag_differs_no_overwrite")
            return
        descriptor, name = archive.manifests[-1]
        archive.ensure_unchanged()
        self.manifest(archive, descriptor, name, tag)
