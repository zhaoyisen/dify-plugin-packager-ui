pipeline {
  agent any

  options {
    timestamps()
    skipDefaultCheckout(true)
  }

  environment {
    APP_NAME = 'dify-plugin-packager-ui'
    PYTHON_IMAGE = 'python:3.12-slim-bookworm'
    DEBIAN_MIRROR = 'http://mirrors.aliyun.com/debian'
    DEBIAN_SECURITY_MIRROR = 'http://mirrors.aliyun.com/debian-security'
    PIP_BUILD_INDEX_URL = 'https://mirrors.aliyun.com/pypi/simple'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Resolve Version') {
      steps {
        script {
          env.SHORT_SHA = sh(script: 'git rev-parse --short=12 HEAD', returnStdout: true).trim()
          env.IMAGE_TAG = "build-${env.BUILD_NUMBER}-${env.SHORT_SHA}"
        }
      }
    }

    stage('Build Image') {
      steps {
        sh '''
          set -eux
          docker build \
            --build-arg PYTHON_IMAGE=${PYTHON_IMAGE} \
            --build-arg DEBIAN_MIRROR=${DEBIAN_MIRROR} \
            --build-arg DEBIAN_SECURITY_MIRROR=${DEBIAN_SECURITY_MIRROR} \
            --build-arg PIP_BUILD_INDEX_URL=${PIP_BUILD_INDEX_URL} \
            -t ${APP_NAME}:${IMAGE_TAG} \
            -t ${APP_NAME}:latest \
            .
        '''
      }
    }

    stage('Deploy') {
      steps {
        sh '''
          set -eux
          if [ ! -f deploy/.env ]; then
            cp deploy/.env.example deploy/.env
          fi

          if grep -q '^IMAGE_TAG=' deploy/.env; then
            sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${IMAGE_TAG}/" deploy/.env
          else
            printf '\\nIMAGE_TAG=%s\\n' "${IMAGE_TAG}" >> deploy/.env
          fi

          docker compose \
            -f deploy/compose.yaml \
            --env-file deploy/.env \
            up -d
        '''
      }
    }

    stage('Verify') {
      steps {
        sh '''
          set -eux
          for i in $(seq 1 30); do
            status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' ${APP_NAME} 2>/dev/null || true)"
            if [ "$status" = "healthy" ]; then
              exit 0
            fi
            sleep 2
          done

          docker ps
          docker logs ${APP_NAME} --tail 200 || true
          exit 1
        '''
      }
    }
  }
}
