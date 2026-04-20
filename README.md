# Dify Plugin Packager UI

`Dify Plugin Packager UI` 是一个面向浏览器的打包工具界面，用来把
`dify-plugin-repackaging-plus` 的命令行能力封装成可视化操作页。

它的目标很直接：

- 上传或指定一个 Dify 插件包来源
- 选择目标架构
- 在 Linux 环境中执行重打包
- 生成并下载 `*-offline.difypkg`

如果你需要的是项目部署方式，而不是项目功能说明，请看 [DEPLOYMENT.md](D:/work/AI/dify-plugin-packager-ui/DEPLOYMENT.md)。

## 功能概览

- 支持 `本地上传`、`GitHub Release`、`Marketplace` 三种输入来源
- 支持 `amd64` 和 `arm64` 目标架构
- 页面内显示实时日志输出
- 打包完成后可直接下载离线包
- 保留最近任务列表，方便回看状态和日志

## 运行要求

- 实际打包执行必须在 `Linux` 环境中运行
- 项目底层依赖仓库内置的 Linux ELF 二进制工具
- 当前建议单实例运行

架构支持情况：

- `amd64 -> amd64`
- `amd64 -> arm64`
- `arm64 -> arm64`
- 不支持 `arm64 -> amd64`

对应的运行约束可以在 [app.py](D:/work/AI/dify-plugin-packager-ui/app.py:231) 和 [app.py](D:/work/AI/dify-plugin-packager-ui/app.py:398) 看到。

## 项目结构

```text
.
├─ app.py
├─ static/
├─ vendor/dify-plugin-repackaging-plus/
├─ data/jobs/
├─ Dockerfile
├─ Jenkinsfile
├─ deploy/
└─ k8s/
```

主要目录说明：

- [app.py](D:/work/AI/dify-plugin-packager-ui/app.py) 是 FastAPI 应用入口
- [static](D:/work/AI/dify-plugin-packager-ui/static) 放前端静态页面
- [vendor](D:/work/AI/dify-plugin-packager-ui/vendor) 放底层重打包脚本和二进制
- [data/jobs](D:/work/AI/dify-plugin-packager-ui/data/jobs) 存放任务输入、输出和中间产物
- [deploy](D:/work/AI/dify-plugin-packager-ui/deploy) 放镜像发布用配置

## 本地开发

如果你在 Windows 上开发，推荐方式是：

- Windows 负责写代码、改页面、提交 Git
- Linux 负责实际运行和打包验证

这是因为项目真正执行重打包时依赖 Linux 工具链，Windows 不适合作为最终运行环境。

### Python 方式运行

适合在 Linux 机器上快速调试：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8080
```

启动后访问：

```text
http://localhost:8080
```

### Docker 方式运行

适合在 Linux 上做一次完整运行验证：

```bash
docker build -t dify-plugin-packager-ui:latest .
docker run --rm -p 8080:8080 dify-plugin-packager-ui:latest
```

如果构建阶段访问 Debian 官方源较慢，可以给 `docker build` 传构建参数：

```bash
docker build \
  --build-arg PYTHON_IMAGE=python:3.12-slim-bookworm \
  --build-arg DEBIAN_MIRROR=http://mirrors.aliyun.com/debian \
  --build-arg DEBIAN_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security \
  --build-arg PIP_BUILD_INDEX_URL=https://mirrors.aliyun.com/pypi/simple \
  -t dify-plugin-packager-ui:latest .
```

## 页面怎么用

首页入口在 [app.py](D:/work/AI/dify-plugin-packager-ui/app.py:301)，主要接口定义在
[app.py](D:/work/AI/dify-plugin-packager-ui/app.py:306) 之后。

打开页面后，使用流程如下：

1. 选择输入来源
2. 选择目标架构
3. 填写来源参数或上传 `.difypkg`
4. 提交任务
5. 在页面里查看实时日志
6. 任务成功后下载离线包

### 来源 1：本地上传

适用于你手里已经有原始 `.difypkg` 文件的场景。

需要提供：

- 一个本地 `.difypkg` 文件

后端处理逻辑见 [app.py](D:/work/AI/dify-plugin-packager-ui/app.py:413)。

### 来源 2：GitHub Release

适用于插件包已经作为 GitHub Release 资产发布的场景。

需要提供：

- 仓库名，例如 `owner/repo`
- Release 标签，例如 `v1.0.0`
- 资产文件名，例如 `plugin-name.difypkg`

后端处理逻辑见 [app.py](D:/work/AI/dify-plugin-packager-ui/app.py:420) 附近。

### 来源 3：Marketplace

适用于插件包来自 Dify Marketplace 的场景。

需要提供：

- 作者名
- 插件名
- 版本号

Marketplace 下载逻辑见 [app.py](D:/work/AI/dify-plugin-packager-ui/app.py:184)。

## 输出结果

成功任务会生成离线包，并通过下载接口返回文件：

- 接口：`GET /api/jobs/{job_id}/download`
- 代码位置：[app.py](D:/work/AI/dify-plugin-packager-ui/app.py:335)

任务状态和最近任务列表可通过这些接口查看：

- `GET /api/config`
- `GET /api/jobs`
- `GET /api/jobs/{job_id}`
- `GET /api/jobs/{job_id}/events`
- `POST /api/jobs`

## 环境变量

运行时主要环境变量：

- `PIP_MIRROR_URL`
- `GITHUB_API_URL`
- `MARKETPLACE_API_URL`
- `HTTP_PROXY`
- `HTTPS_PROXY`
- `NO_PROXY`

这些变量在镜像运行配置 [deploy/compose.yaml](D:/work/AI/dify-plugin-packager-ui/deploy/compose.yaml) 和应用代码
[app.py](D:/work/AI/dify-plugin-packager-ui/app.py:176) 中都有体现。

## Kubernetes

如果你要部署到 Kubernetes，仓库已经提供基础清单：

- [k8s/deployment.yaml](D:/work/AI/dify-plugin-packager-ui/k8s/deployment.yaml)
- [k8s/service.yaml](D:/work/AI/dify-plugin-packager-ui/k8s/service.yaml)
- [k8s/ingress.yaml](D:/work/AI/dify-plugin-packager-ui/k8s/ingress.yaml)

使用前按实际镜像地址和域名修改即可。
