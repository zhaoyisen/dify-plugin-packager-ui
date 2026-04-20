# Deployment Guide

本文只讲这个仓库当前采用的发布方式：

- 代码放在 GitHub
- Jenkins 从 GitHub 拉代码
- Jenkins 在服务器本机构建镜像
- Jenkins 用镜像更新同机运行中的容器

这套方式适合你当前的场景：

- Windows：本地开发
- Jenkins 服务器：构建镜像
- 应用服务器：运行镜像
- Jenkins 服务器和应用服务器是同一台

## 仓库里和部署相关的文件

- [Jenkinsfile](D:/work/AI/dify-plugin-packager-ui/Jenkinsfile)
- [deploy/compose.yaml](D:/work/AI/dify-plugin-packager-ui/deploy/compose.yaml)
- [deploy/.env.example](D:/work/AI/dify-plugin-packager-ui/deploy/.env.example)
- [Dockerfile](D:/work/AI/dify-plugin-packager-ui/Dockerfile)

这些文件的分工：

- `Jenkinsfile`：定义流水线
- `Dockerfile`：定义应用镜像
- `deploy/compose.yaml`：定义服务器如何运行镜像
- `deploy/.env.example`：定义运行时环境变量模板

## 发布流程

每次发布的实际动作是：

1. Jenkins 拉取最新代码
2. 计算当前 commit 的短 SHA
3. 构建镜像 `dify-plugin-packager-ui:build-<BUILD_NUMBER>-<SHORT_SHA>`
4. 同时更新 `dify-plugin-packager-ui:latest`
5. 复制 `deploy/.env.example` 到 `deploy/.env`
6. 把本次镜像 tag 写入 `deploy/.env`
7. 执行 `docker compose -f deploy/compose.yaml --env-file deploy/.env up -d`
8. 访问 `http://127.0.0.1:18080/api/config` 做健康检查

## 运行端口

发布配置默认使用：

```text
18080 -> 8080
```

原因是 Jenkins 默认占用 `8080`，应用必须避开这个端口。

发布成功后访问：

```text
http://<服务器IP>:18080
```

## 持久化数据

运行时使用 Docker 命名卷：

```text
dify_plugin_packager_jobs
```

这个卷保存的是打包任务产物和中间文件。重新发布不会清掉这些数据。

## Jenkins 任务怎么配置

在 Jenkins 中新建一个 `Pipeline` 任务，按下面填写：

1. `New Item`
2. 任务类型选 `Pipeline`
3. `Definition` 选 `Pipeline script from SCM`
4. `SCM` 选 `Git`
5. 填你的 GitHub 仓库地址
6. 私有仓库就配置凭据
7. `Branch Specifier` 填你的分支，例如 `*/main`
8. `Script Path` 填 `Jenkinsfile`
9. 保存

然后点击 `Build Now` 即可发布。

## 第一次发布前要确认什么

Jenkins 容器里必须已经能执行下面两个命令：

```bash
docker version
docker compose version
```

如果这一步不通，说明 Jenkins 还没有正确接入宿主机 Docker，流水线也不会成功。

## 第一次手工验证

如果你想在服务器上先手工验证一遍当前发布配置，可以执行：

```bash
docker build \
  --build-arg PYTHON_IMAGE=python:3.12-slim-bookworm \
  --build-arg DEBIAN_MIRROR=http://mirrors.aliyun.com/debian \
  --build-arg DEBIAN_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security \
  --build-arg PIP_BUILD_INDEX_URL=https://mirrors.aliyun.com/pypi/simple \
  -t dify-plugin-packager-ui:latest .

cp deploy/.env.example deploy/.env
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d
curl http://127.0.0.1:18080/api/config
```

如果最后能返回 JSON，说明镜像和运行配置都正常。

## 你以后怎么发布

日常发布流程就是：

1. 在 Windows 本地修改代码
2. 提交并 push 到 GitHub
3. 打开 Jenkins
4. 进入这个项目的 Pipeline 任务
5. 点击 `Build Now`
6. 等待流水线完成
7. 浏览器访问 `http://<服务器IP>:18080`

## 说明

这份文档只负责部署说明。项目本身的功能、接口和使用方式，请看
[README.md](D:/work/AI/dify-plugin-packager-ui/README.md)。
