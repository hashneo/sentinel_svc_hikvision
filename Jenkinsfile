env.ARCH = 'armv7'
env.BUILD = '0.1.' + env.BUILD_NUMBER + '.' + env.ARCH
env.LATEST = 'LATEST' + '.' + env.ARCH
env.DOCKER_REGISTRY = 'steventaylor.me:5000'
env.CONTAINER1 = 'sentinel_svc_hikvision'
env.DOCKER_HOST = 'tcp://10.0.1.40:2375'

node {

  withCredentials([[$class: 'UsernamePasswordMultiBinding', credentialsId: 'registry',
                    usernameVariable: 'dockeruser', passwordVariable: 'dockerpass']]) {
        stage 'build'
        checkout scm

        sh 'docker login -u ${dockeruser} -p ${dockerpass} -e user@domain.com ${DOCKER_REGISTRY}'
        sh 'docker build -t ${DOCKER_REGISTRY}/${CONTAINER1}:${BUILD} -f Dockerfile.${ARCH} .'
        sh 'docker tag ${DOCKER_REGISTRY}/${CONTAINER1}:${LATEST} ${DOCKER_REGISTRY}/${CONTAINER1}:${BUILD}'

        stage 'push'
        sh 'docker push ${DOCKER_REGISTRY}/${CONTAINER1}:${BUILD}'
        sh 'docker push ${DOCKER_REGISTRY}/${CONTAINER1}:${LATEST}'

        stage 'cleanup'
        sh 'docker rmi ${DOCKER_REGISTRY}/${CONTAINER1}:${BUILD}'
    }
}
