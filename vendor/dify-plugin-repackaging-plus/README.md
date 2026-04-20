These files are vendored from the public repository `xjl456852/dify-plugin-repackaging-plus`.

Changes applied locally for the UI wrapper:

- fixed the `MARKETPLACE_API_URL` typo in `plugin_repackaging.sh`
- allowed `PIP_MIRROR_URL`, `GITHUB_API_URL`, and `MARKETPLACE_API_URL` to be overridden by environment variables
- relaxed `unzip` installation logic to support `apt`, `yum`, and `dnf`
- kept the original command signatures so the UI still drives the scripts in the same way
