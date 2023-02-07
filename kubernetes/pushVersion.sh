export GIT_SHA=$(git rev-parse HEAD)

docker build \
            -t dpid-resolver:latest \
            -t 523044037273.dkr.ecr.us-east-2.amazonaws.com/dpid-resolver \
             .
aws ecr get-login-password --region us-east-2 | docker login --username AWS --password-stdin 523044037273.dkr.ecr.us-east-2.amazonaws.com
docker tag dpid-resolver:latest 523044037273.dkr.ecr.us-east-2.amazonaws.com/dpid-resolver:$GIT_SHA
docker tag dpid-resolver:latest 523044037273.dkr.ecr.us-east-2.amazonaws.com/dpid-resolver:latest
docker push 523044037273.dkr.ecr.us-east-2.amazonaws.com/dpid-resolver:$GIT_SHA
docker push 523044037273.dkr.ecr.us-east-2.amazonaws.com/dpid-resolver:latest


kubectl set image deployment/dpid-resolver dpid-resolver=523044037273.dkr.ecr.us-east-2.amazonaws.com/dpid-resolver:$GIT_SHA --record

kubectl rollout status deployment/dpid-resolver