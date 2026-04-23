# Dify Plugin Packager UI

一个面向浏览器的 Dify 插件离线打包工具。它把 `kurokobo/dify-plugin-offline-packager` 的打包流程封装成 Web UI，支持上传或下载原始 `.difypkg`，并生成可离线安装的 `*-offline.difypkg`。

## 目录

- [功能](#功能)
- [运行要求](#运行要求)
- [1. 生成镜像](#1-生成镜像)
  - [1.1 生成本机镜像](#11-生成本机镜像)
  - [1.2 生成并推送到镜像仓库](#12-生成并推送到镜像仓库)
  - [1.3 可选：构建加速参数](#13-可选构建加速参数)
- [2. 部署方式](#2-部署方式)
  - [2.1 源码运行](#21-源码运行)
  - [2.2 Docker 运行](#22-docker-运行)
  - [2.3 Docker Compose 运行](#23-docker-compose-运行)
  - [2.4 Kubernetes 运行](#24-kubernetes-运行)
- [3. Jenkins 自动发布](#3-jenkins-自动发布)
- [4. 公网 HTTPS 反代](#4-公网-https-反代)
- [5. 使用流程](#5-使用流程)
- [6. 签名说明](#6-签名说明)
- [7. 环境变量](#7-环境变量)
- [8. 持久化、备份与升级](#8-持久化备份与升级)
- [9. 常见问题](#9-常见问题)
- [10. 第三方项目与许可证](#10-第三方项目与许可证)

## 功能

- 支持本地上传 `.difypkg`
- 支持从 GitHub Release 拉取 `.difypkg`
- 支持从 Dify Marketplace 拉取 `.difypkg`
- 支持实时查看任务日志
- 支持下载打包后的离线包
- 默认不签名，必要时可手动启用签名
- 镜像内置 Dify 官方 CLI：`dify-plugin-linux-amd64` 和 `dify-plugin-linux-arm64`

## 运行要求

- 真实打包建议运行在 Linux Docker 环境
- 推荐 `amd64` 服务器
- 打包过程需要访问 Python 包索引，例如 PyPI 或内网镜像源
- 如果使用 Docker / Docker Compose，需要提前安装 Docker
- 如果使用 Kubernetes，需要可用的集群、Ingress 和持久化存储

## 1. 生成镜像

如果你已经有可用镜像，可以跳过本节，直接看“2. 部署方式”。

### 1.1 生成本机镜像

适合构建和运行在同一台服务器上的场景。

```bash
docker build -t dify-plugin-packager-ui:latest .
```

### 1.2 生成并推送到镜像仓库

适合构建机和运行服务器分离，或 Kubernetes 部署场景。

```bash
docker build -t registry.example.com/dify-plugin-packager-ui:latest .
docker push registry.example.com/dify-plugin-packager-ui:latest
```

### 1.3 可选：构建加速参数

这些参数只影响镜像构建阶段的 `apt-get` 和 `pip install -r requirements.txt`，不影响运行时配置。运行时配置写在 `.env`、`docker run -e` 或 Kubernetes `env` 中。

```bash
docker build \
  --build-arg PYTHON_IMAGE=python:3.12-slim-bookworm \
  --build-arg DEBIAN_MIRROR=http://mirrors.aliyun.com/debian \
  --build-arg DEBIAN_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security \
  --build-arg PIP_BUILD_INDEX_URL=https://mirrors.aliyun.com/pypi/simple \
  -t registry.example.com/dify-plugin-packager-ui:latest .
```

如果只生成本机镜像，把最后一行改成：

```bash
  -t dify-plugin-packager-ui:latest .
```

## 2. 部署方式

### 2.1 源码运行

源码运行适合本地开发、页面调试和接口调试。

Linux / macOS：

```bash
git clone <your-repo-url> dify-plugin-packager-ui
cd dify-plugin-packager-ui
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8080
```

访问：

```text
http://127.0.0.1:8080
```

Windows PowerShell：

```powershell
git clone <your-repo-url> dify-plugin-packager-ui
cd dify-plugin-packager-ui
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8080
```

Windows 源码运行只能用于页面和普通接口调试。真实打包会调用 Linux Dify CLI，建议使用 Linux Docker 环境验证。

源码运行时可选环境变量：

```bash
export PIP_MIRROR_URL=https://mirrors.aliyun.com/pypi/simple
export GITHUB_API_URL=https://github.com
export MARKETPLACE_API_URL=https://marketplace.dify.ai
export DIFY_PLUGIN_DAEMON_VERSION=0.5.8
uvicorn app:app --host 0.0.0.0 --port 8080
```

### 2.2 Docker 运行

#### 2.2.1 无镜像仓库：使用本机镜像

先在当前服务器构建镜像：

```bash
docker build -t dify-plugin-packager-ui:latest .
```

启动：

```bash
docker run -d \
  --name dify-plugin-packager-ui \
  --restart unless-stopped \
  -p 18080:8080 \
  -e PIP_MIRROR_URL=https://mirrors.aliyun.com/pypi/simple \
  -e GITHUB_API_URL=https://github.com \
  -e MARKETPLACE_API_URL=https://marketplace.dify.ai \
  -e DIFY_PLUGIN_DAEMON_VERSION=0.5.8 \
  -v dify_plugin_packager_jobs:/app/data/jobs \
  -v dify_plugin_packager_signing:/app/data/signing \
  dify-plugin-packager-ui:latest
```

检查：

```bash
curl http://127.0.0.1:18080/api/config
```

#### 2.2.2 有镜像仓库：直接拉取镜像

私有仓库先登录：

```bash
docker login registry.example.com
```

启动：

```bash
docker run -d \
  --name dify-plugin-packager-ui \
  --restart unless-stopped \
  -p 18080:8080 \
  -e PIP_MIRROR_URL=https://mirrors.aliyun.com/pypi/simple \
  -e GITHUB_API_URL=https://github.com \
  -e MARKETPLACE_API_URL=https://marketplace.dify.ai \
  -e DIFY_PLUGIN_DAEMON_VERSION=0.5.8 \
  -v dify_plugin_packager_jobs:/app/data/jobs \
  -v dify_plugin_packager_signing:/app/data/signing \
  registry.example.com/dify-plugin-packager-ui:latest
```

### 2.3 Docker Compose 运行

推荐正式单机部署使用 Docker Compose。

#### 2.3.1 无镜像仓库：源码机本机构建 + Compose 启动

适合源码已经拉到 Linux 服务器，并且镜像也在这台服务器构建的场景。

```bash
git clone <your-repo-url> dify-plugin-packager-ui
cd dify-plugin-packager-ui
docker build -t dify-plugin-packager-ui:latest .
cp deploy/.env.example deploy/.env
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d
curl http://127.0.0.1:18080/api/config
```

这种方式下，`deploy/.env` 保持默认镜像配置即可：

```env
IMAGE_NAME=dify-plugin-packager-ui
IMAGE_TAG=latest
```

#### 2.3.2 有镜像仓库：服务器只保留 compose.yaml 和 .env

适合镜像已经由本地、CI 或 Jenkins 构建并推送到镜像仓库的场景。服务器不需要源码、`Dockerfile`、`vendor/` 或 CLI 二进制。

创建部署目录：

```bash
mkdir -p /opt/dify-plugin-packager-ui
cd /opt/dify-plugin-packager-ui
```

创建 `compose.yaml`，内容可直接使用仓库里的 `deploy/compose.yaml`。

创建 `.env`：

```env
APP_PORT=127.0.0.1:18080
IMAGE_NAME=registry.example.com/dify-plugin-packager-ui
IMAGE_TAG=latest
PIP_MIRROR_URL=https://mirrors.aliyun.com/pypi/simple
GITHUB_API_URL=https://github.com
MARKETPLACE_API_URL=https://marketplace.dify.ai
DIFY_PLUGIN_DAEMON_VERSION=0.5.8
DIFY_PLUGIN_CLI_PATH=
PLUGIN_SIGNING_PRIVATE_KEY_PATH=
PLUGIN_SIGNING_PUBLIC_KEY_PATH=
HTTP_PROXY=
HTTPS_PROXY=
NO_PROXY=127.0.0.1,localhost
```

启动：

```bash
docker login registry.example.com
docker compose --env-file .env up -d
docker compose ps
curl http://127.0.0.1:18080/api/config
```

如果不做反代，想直接通过服务器 IP 访问，把 `.env` 改成：

```env
APP_PORT=18080
```

#### 2.3.3 Compose 配置文件

仓库内置的 Compose 文件：

```text
deploy/compose.yaml
```

运行时配置模板：

```text
deploy/.env.example
```

### 2.4 Kubernetes 运行

Kubernetes 部署通常要求镜像已经推送到镜像仓库。

#### 2.4.1 有镜像仓库：推荐方式

先生成并推送镜像：

```bash
docker build -t registry.example.com/dify-plugin-packager-ui:latest .
docker push registry.example.com/dify-plugin-packager-ui:latest
```

创建命名空间：

```bash
kubectl create namespace dify-plugin-packager
```

创建 `k8s-runtime.yaml`：

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: dify-plugin-packager-jobs
  namespace: dify-plugin-packager
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: dify-plugin-packager-signing
  namespace: dify-plugin-packager
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dify-plugin-packager-ui
  namespace: dify-plugin-packager
spec:
  replicas: 1
  selector:
    matchLabels:
      app: dify-plugin-packager-ui
  template:
    metadata:
      labels:
        app: dify-plugin-packager-ui
    spec:
      containers:
        - name: app
          image: registry.example.com/dify-plugin-packager-ui:latest
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 8080
          env:
            - name: PIP_MIRROR_URL
              value: "https://mirrors.aliyun.com/pypi/simple"
            - name: GITHUB_API_URL
              value: "https://github.com"
            - name: MARKETPLACE_API_URL
              value: "https://marketplace.dify.ai"
            - name: DIFY_PLUGIN_DAEMON_VERSION
              value: "0.5.8"
            - name: DIFY_PLUGIN_CLI_PATH
              value: ""
          volumeMounts:
            - name: jobs
              mountPath: /app/data/jobs
            - name: signing
              mountPath: /app/data/signing
          readinessProbe:
            httpGet:
              path: /api/config
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /api/config
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 20
      volumes:
        - name: jobs
          persistentVolumeClaim:
            claimName: dify-plugin-packager-jobs
        - name: signing
          persistentVolumeClaim:
            claimName: dify-plugin-packager-signing
---
apiVersion: v1
kind: Service
metadata:
  name: dify-plugin-packager-ui
  namespace: dify-plugin-packager
spec:
  selector:
    app: dify-plugin-packager-ui
  ports:
    - name: http
      port: 80
      targetPort: 8080
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: dify-plugin-packager-ui
  namespace: dify-plugin-packager
spec:
  rules:
    - host: packager.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: dify-plugin-packager-ui
                port:
                  number: 80
```

部署：

```bash
kubectl apply -f k8s-runtime.yaml
kubectl -n dify-plugin-packager get pods
kubectl -n dify-plugin-packager logs deploy/dify-plugin-packager-ui -f
```

检查：

```bash
kubectl -n dify-plugin-packager port-forward svc/dify-plugin-packager-ui 18080:80
curl http://127.0.0.1:18080/api/config
```

#### 2.4.2 无镜像仓库：仅适合单节点测试

如果 Kubernetes 节点和构建机器是同一台，并且集群能直接使用本机 Docker/containerd 镜像，可以使用本地镜像：

```bash
docker build -t dify-plugin-packager-ui:latest .
```

然后把 Deployment 里的镜像改成：

```yaml
image: dify-plugin-packager-ui:latest
imagePullPolicy: IfNotPresent
```

多节点集群不推荐这种方式，因为其他节点可能拉不到本地镜像。

## 3. Jenkins 自动发布

仓库保留了 `Jenkinsfile`，适合以下模式：

- Jenkins 从 Git 仓库拉代码
- Jenkins 在同一台服务器上构建 Docker 镜像
- Jenkins 用 `deploy/compose.yaml` 更新本机容器

这种模式不要求镜像仓库，因为镜像直接构建在运行服务器本机。

### 3.1 Jenkins 服务器要求

Jenkins 所在机器必须能执行：

```bash
docker version
docker compose version
```

如果 Jenkins 运行在容器里，需要把宿主机 Docker socket 挂进去，并确保 Jenkins 用户有 Docker 权限。

### 3.2 创建 Jenkins Pipeline

在 Jenkins 中：

1. 新建任务
2. 类型选择 `Pipeline`
3. `Definition` 选择 `Pipeline script from SCM`
4. `SCM` 选择 `Git`
5. 填写当前项目 Git 仓库地址
6. 私有仓库按需配置凭据
7. `Branch Specifier` 填写目标分支，例如 `*/main`
8. `Script Path` 填写 `Jenkinsfile`
9. 保存

### 3.3 Jenkinsfile 当前流程

当前 `Jenkinsfile` 会执行：

1. 拉取代码
2. 生成镜像标签：`build-<BUILD_NUMBER>-<SHORT_SHA>`
3. 构建镜像：`dify-plugin-packager-ui:<build-tag>` 和 `dify-plugin-packager-ui:latest`
4. 如果不存在 `deploy/.env`，从 `deploy/.env.example` 复制一份
5. 把本次构建的 `IMAGE_TAG` 写入 `deploy/.env`
6. 执行 `docker compose -f deploy/compose.yaml --env-file deploy/.env up -d`
7. 等待容器健康检查变为 `healthy`

### 3.4 Jenkins 构建参数

`Jenkinsfile` 里的这些变量只用于镜像构建阶段：

```text
PYTHON_IMAGE
DEBIAN_MIRROR
DEBIAN_SECURITY_MIRROR
PIP_BUILD_INDEX_URL
```

运行时配置仍然来自：

```text
deploy/.env
```

### 3.5 Jenkins 与运行服务器分离

如果 Jenkins 和运行服务器不是同一台机器，需要改造成：

1. Jenkins 构建镜像
2. Jenkins `docker push` 到镜像仓库
3. 运行服务器只保留 `compose.yaml` 和 `.env`
4. 运行服务器执行 `docker compose --env-file .env pull`
5. 运行服务器执行 `docker compose --env-file .env up -d`

运行服务器 `.env` 示例：

```env
IMAGE_NAME=registry.example.com/dify-plugin-packager-ui
IMAGE_TAG=latest
```

## 4. 公网 HTTPS 反代

推荐不要直接暴露 `18080`，而是通过 Nginx、Caddy、Traefik 等反代。

### 4.1 Caddy 示例

创建 `Caddyfile`：

```caddyfile
packager.example.com {
    encode gzip

    basic_auth {
        admin <password_hash>
    }

    reverse_proxy 127.0.0.1:18080
}
```

生成密码哈希：

```bash
docker run --rm caddy:2.8-alpine caddy hash-password --plaintext 'your-password'
```

安全组或防火墙只开放：

```text
80/tcp
443/tcp
```

不要对公网开放：

```text
18080/tcp
8080/tcp
```

## 5. 使用流程

1. 打开页面
2. 选择来源：本地上传、GitHub Release 或 Marketplace
3. 填写来源参数或上传 `.difypkg`
4. 选择目标架构
5. 默认不签名，必要时手动开启签名
6. 提交任务
7. 在任务中心查看日志
8. 任务成功后下载 `*-offline.difypkg`

## 6. 签名说明

系统默认不签名。

如果需要签名，可以使用以下方式之一：

- 在页面里生成托管密钥
- 在单次任务中上传私钥
- 通过环境变量挂载服务端默认私钥

示例：

```env
PLUGIN_SIGNING_PRIVATE_KEY_PATH=/app/keys/private.pem
PLUGIN_SIGNING_PUBLIC_KEY_PATH=/app/keys/public.pem
```

然后把密钥放在服务器部署目录的 `keys/` 下：

```text
/opt/dify-plugin-packager-ui/keys/private.pem
/opt/dify-plugin-packager-ui/keys/public.pem
```

## 7. 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_PORT` | `18080` | 宿主机监听端口或绑定地址 |
| `IMAGE_NAME` | `dify-plugin-packager-ui` | 镜像名称，可填写完整仓库地址 |
| `IMAGE_TAG` | `latest` | 镜像标签 |
| `PIP_MIRROR_URL` | `https://mirrors.aliyun.com/pypi/simple` | Python 包索引，供 `uv lock` 和 wheel 下载使用 |
| `GITHUB_API_URL` | `https://github.com` | GitHub 基础地址 |
| `MARKETPLACE_API_URL` | `https://marketplace.dify.ai` | Dify Marketplace 地址 |
| `DIFY_PLUGIN_DAEMON_VERSION` | `0.5.8` | 与内置 Dify CLI 对齐的 daemon 版本 |
| `DIFY_PLUGIN_CLI_PATH` | 空 | 通常留空，使用镜像内置 CLI |
| `PLUGIN_SIGNING_PRIVATE_KEY_PATH` | 空 | 可选，默认签名私钥路径 |
| `PLUGIN_SIGNING_PUBLIC_KEY_PATH` | 空 | 可选，默认验签公钥路径 |
| `HTTP_PROXY` | 空 | 可选代理 |
| `HTTPS_PROXY` | 空 | 可选代理 |
| `NO_PROXY` | `127.0.0.1,localhost` | 代理排除列表 |

## 8. 持久化、备份与升级

Docker Compose 使用两个命名卷：

```text
dify_plugin_packager_jobs
dify_plugin_packager_signing
```

用途：

- `dify_plugin_packager_jobs` 保存任务输入、输出和中间文件
- `dify_plugin_packager_signing` 保存托管签名密钥

备份任务数据：

```bash
docker run --rm \
  -v dify_plugin_packager_jobs:/data \
  -v "$PWD":/backup \
  alpine \
  tar czf /backup/dify-plugin-packager-jobs-backup.tgz -C /data .
```

备份托管签名数据：

```bash
docker run --rm \
  -v dify_plugin_packager_signing:/data \
  -v "$PWD":/backup \
  alpine \
  tar czf /backup/dify-plugin-packager-signing-backup.tgz -C /data .
```

有镜像仓库时升级：

```bash
docker compose --env-file .env pull
docker compose --env-file .env up -d
docker compose ps
```

无镜像仓库时升级：

```bash
docker build -t dify-plugin-packager-ui:latest .
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d
```

## 9. 常见问题

### 9.1 卡在 uv lock

`uv lock` 需要访问 Python 包索引。确认 `PIP_MIRROR_URL` 可访问，任务日志里应看到：

```text
[packager] Python package index: ...
```

### 9.2 日志里不应出现 CLI 下载

当前镜像已内置 CLI，正常日志应类似：

```text
[packager] Using local CLI: /app/vendor/dify-plugin-offline-packager/bin/dify-plugin-linux-amd64
```

不应再出现：

```text
[cli] Downloading ...
```

### 9.3 Dify 侧安装仍访问 pypi.org

先确认生成包日志里有：

```text
[inspect] ... uv.lock=absent, bundled wheels=...
```

如果还有联网请求，把打包任务日志和 Dify `plugin_daemon` 日志一起排查。

### 9.4 Dify plugin_daemon 版本

推荐 Dify 侧 `plugin_daemon` 使用 `0.5.8-local` 或更新版本，并按需设置：

```env
PLUGIN_IGNORE_UV_LOCK=true
```

## 10. 第三方项目与许可证

本项目的离线打包核心逻辑基于以下开源项目：

```text
kurokobo/dify-plugin-offline-packager
```

上游地址：

```text
https://github.com/kurokobo/dify-plugin-offline-packager
```

本仓库已将该项目 vendored 到：

```text
vendor/dify-plugin-offline-packager/
```

本项目主要做了这些封装和调整：

- 提供 Web UI、任务管理、实时日志和产物下载
- 通过 `offline_packager.py` 调用 vendored `scripts/packager.py`
- 将 Dify 官方 CLI 二进制内置到镜像中，避免运行时下载 CLI
- 默认不签名，保留手动签名能力
- 增加 Docker Compose、Jenkins、Kubernetes 等部署说明

上游项目使用 MIT License。原始许可证保留在：

```text
vendor/dify-plugin-offline-packager/LICENSE
```

本仓库还提供第三方来源说明：

```text
vendor/dify-plugin-offline-packager/NOTICE.md
```
