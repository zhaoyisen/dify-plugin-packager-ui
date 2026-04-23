# Third-Party Notice

This directory vendors code from:

```text
kurokobo/dify-plugin-offline-packager
```

Upstream repository:

```text
https://github.com/kurokobo/dify-plugin-offline-packager
```

License:

```text
MIT License
Copyright (c) 2026 kurokobo
```

The original license text is preserved in:

```text
vendor/dify-plugin-offline-packager/LICENSE
```

Local integration notes:

- The upstream `scripts/packager.py` is used as the core offline packaging engine.
- This project wraps it with a FastAPI Web UI and task/log/download APIs.
- The CLI lookup path was adjusted so packaging uses local vendored Dify CLI binaries instead of downloading them at runtime.
- The vendored Dify CLI binaries are expected under `vendor/dify-plugin-offline-packager/bin/`.
