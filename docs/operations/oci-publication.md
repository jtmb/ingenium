# OCI archive input for the existing image publisher

`ops/publish-image.py` accepts either the existing `--image` Docker image or an `--oci-archive` produced by an owned standalone builder. This alternative avoids importing a full candidate into an unrelated daemon's global image/cache store. It publishes to the same existing `jtmb92/ingenium` repository through the unchanged Windows credential helper and leaves Helm/Flux deployment authority unchanged.

```sh
python3 -B ops/publish-image.py \
  --oci-archive "$output_root/veyra.oci.tar" \
  --revision "$reviewed_full_git_revision" \
  --output-root "$output_root" --probe
```

The output root must already be private, task owned and on the declared storage. The archive must be a plain, absolute path inside that root. The regular storage reserves, source-remote/commit check, exact revision/source/snapshot labels, credential account/grant and immutable Git tag checks still apply. Remove `--probe` only for the reviewed candidate publication. A successful publication is not deployment or runtime acceptance.

Before requesting credentials, the archive reader verifies the complete OCI descriptor/blob graph, every SHA-256/size, one Linux/amd64 configuration and bounded metadata. It rejects traversal, links, duplicates, external layer URLs, dangling blobs and archive mutation. Uploads stream in bounded chunks directly to the registry. Upload locations must retain HTTPS and the exact repository/registry origin; bearer tokens never follow redirects. The tag is rechecked after layer upload before publishing its root manifest. The publisher reads the remote digest/config labels back after publication, as for its existing Docker path.

Phase 1 preparation evidence includes six focused archive/upload rejection tests and a real isolated BuildKit `COPY`/`RUN`/OCI export accepted by the same archive reader. The owned probe daemon stopped and its complete scratch/cache/archive tree was removed with measured bytes. The pinned tool recipe is in the private task evidence. This is not evidence of a built Veyra image, authenticated registry upload or cluster rollout. Those gates remain open.