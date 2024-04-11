# redis-and-rds

Simple Kubernetes, web app, and Iaac with Pulumi demonstration.

## What does it do

This repo:

1. Stands up a Redis instance and a web app listening on 4567 in EKS.

2. Stands up an RDS instance, subnets, and allows access from the public-facing subnet.

## How to do it

GitHub Actions are set up on this repo and will deploy and maintain the infrastructure on each commit to the main branch.

### Manually

1. Install Pulumi

https://www.pulumi.com/docs/install/

```bash
pulumi up
```

1. Profit
