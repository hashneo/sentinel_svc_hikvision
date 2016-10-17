env.ARCH = 'armv7'
env.BUILD = '0.1.' + env.BUILD_NUMBER + '.' + env.ARCH
env.LATEST = 'LATEST' + '.' + env.ARCH
env.DOCKER_REGISTRY = 'steventaylor.me:5000'
env.SERVICE_NAME = 'sentinel_hikvision'
env.CONTAINER1 = env.SERVICE_NAME
env.DOCKER_HOST = 'tcp://10.0.1.40:2375'

node {

  withCredentials([[$class: 'UsernamePasswordMultiBinding', credentialsId: 'registry',
                    usernameVariable: 'dockeruser', passwordVariable: 'dockerpass']]) {
        stage 'build'
        checkout scm

        sh 'docker login -u ${dockeruser} -p ${dockerpass} -e user@domain.com ${DOCKER_REGISTRY}'
        sh 'docker build -t ${DOCKER_REGISTRY}/${CONTAINER1}:${LATEST} -t ${DOCKER_REGISTRY}/${CONTAINER1}:${BUILD} -f Dockerfile.${ARCH} .'

        stage 'push'
        sh 'docker push ${DOCKER_REGISTRY}/${CONTAINER1}:${BUILD}'
        sh 'docker push ${DOCKER_REGISTRY}/${CONTAINER1}:${LATEST}'

        stage 'cleanup'
        sh 'docker rmi ${DOCKER_REGISTRY}/${CONTAINER1}:${BUILD}'

        stage 'deploy'
        //sh 'docker service update --image  ${DOCKER_REGISTRY}/${CONTAINER1}:${BUILD} ${SERVICE_NAME}'
        sh 'docker service create --name=${SERVICE_NAME} -e CONSUL=10.0.1.10 --replicas=1 --network=sentinel ${DOCKER_REGISTRY}/${CONTAINER1}:${BUILD}'
    }
}
