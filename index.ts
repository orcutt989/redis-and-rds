import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";
import * as aws from "@pulumi/aws";

// Read the ownerTag from environment variables
const ownerTag = process.env.OWNER_TAG;
// Read the webAppImage from environment variables
const webAppImage = process.env.WEB_APP_IMAGE;

if (!ownerTag) {
  throw new Error("OWNER_TAG environment variable is not set.");
}

if (!webAppImage) {
  throw new Error("WEB_APP_IMAGE environment variable is not set.");
}

// Create a VPC with public and private subnets
const vpc = new awsx.ec2.Vpc(`${ownerTag}-vpc`, {
  tags: {
    "Owner": ownerTag
  },
});

// Define the role mappings for the EKS cluster
// Opened up to all authenticated accounts for simplicity
// As to not worry about role-based authentication
// although that is best-practice.
const roleMappings: eks.RoleMapping[] = [{
  roleArn: "*",
  username: "*",
  groups: ["system:masters"],
}];

// Create an Amazon EKS cluster with default AMI selection behavior
const cluster = new eks.Cluster(`${ownerTag}-eks-cluster`, {
  vpcId: vpc.vpcId,
  subnetIds: vpc.publicSubnetIds,
  instanceType: "t3.medium",
  desiredCapacity: 2,
  minSize: 1,
  maxSize: 2,
  tags: {
    "Owner": ownerTag
  },
  roleMappings: roleMappings,
});

const redisPort = 6397

const redisService = new k8s.core.v1.Service("redis-service", {
  metadata: {
    namespace: "default"
  },
  spec: {
    type: "ClusterIP", // Only accessible inside the cluster. Redis doesnt need outside access.
    ports: [{
      port: redisPort,
      targetPort: "redis", // Named port matches named port in deployment
    }],
    selector: {
      app: "redis"
    },
  },
}, {
  provider: cluster.provider,
  customTimeouts: {
    create: "30s"
  }
});

const redisUrl = redisService.metadata.apply(metadata => `redis://${metadata.name}.${metadata.namespace}.svc.cluster.local:${redisPort}`)

// Create a Redis deployment and service
const redisDeployment = new k8s.apps.v1.Deployment("redis-deployment", {
  metadata: {
    namespace: "default"
  },
  spec: {
    replicas: 1,
    selector: {
      matchLabels: {
        app: "redis"
      },
    },
    template: {
      metadata: {
        labels: {
          app: "redis"
        },
      },
      spec: {
        containers: [{
          name: "redis",
          image: "redis",
          ports: [{
            name: "redis", // Named port matches named port in service
            containerPort: 6379
          }],
          env: [{
            name: "REDIS_URL",
            value: redisUrl,
          }, {
            name: "REDIS_HOST",
            value: "0.0.0.0"
          }],
          command: ["redis-server"],
          args: ["--bind", "0.0.0.0"],
        }],
      },
    },
  },
}, {
  provider: cluster.provider,
  customTimeouts: {
    create: "30s"
  }
});

// Create a web application deployment and service
const webAppDeployment = new k8s.apps.v1.Deployment("webapp-deployment", {
  metadata: {
    namespace: "default"
  },
  spec: {
    replicas: 1,
    selector: {
      matchLabels: {
        app: "webapp"
      },
    },
    template: {
      metadata: {
        labels: {
          app: "webapp"
        },
      },
      spec: {
        containers: [{
          name: "webapp",
          image: `${webAppImage}`,
          ports: [{
            containerPort: 4567
          }],
          env: [{
            name: "REDIS_URL",
            value: redisUrl
          }],
        }],
      },
    },
  },
}, {
  provider: cluster.provider,
  customTimeouts: {
    create: "30s"
  }
});

const webAppService = new k8s.core.v1.Service("webapp-service", {
  metadata: {
    namespace: "default"
  },
  spec: {
    type: "LoadBalancer", // Accessible via AWS ELB URL on the internet
    ports: [{
      port: 80,
      targetPort: 4567
    }],
    selector: {
      app: "webapp"
    },
  },
}, {
  provider: cluster.provider,
  customTimeouts: {
    create: "30s"
  }
});

// Create the RDS database instance using the createRDS function
export function createRDS() {

  // Cant have uppercase letters in RDS and subnet names.
  const rdsName = `${ownerTag!.toLowerCase()}-rds-instance`.toLowerCase().replace(/[^a-z0-9-]+/g, "");

  // Create a subnet group for the RDS instance
  const dbSubnetGroup = new aws.rds.SubnetGroup(`${ownerTag}-rds-subnet-group`, {
    name: rdsName,
    subnetIds: vpc.privateSubnetIds,
    tags: {
      "Owner": ownerTag!
    },
  });

  // Get the CIDR blocks of the public subnets
  const publicSubnetCidrBlocks = pulumi.output(vpc.publicSubnetIds).apply(subnetIds =>
    subnetIds.map(subnetId =>
      aws.ec2.getSubnet({ id: subnetId }).then(subnet => subnet.cidrBlock ?? "")
    )
  );

  // Create a security group for the RDS instance that allows inbound traffic from the public subnet
  // And denies from everywhere else
  const dbSecurityGroup = new aws.ec2.SecurityGroup(`${ownerTag}-db-security-group`, {
    vpcId: vpc.vpcId,
    ingress: [{ //Absence of any other rules means all inbound traffic is denied
      protocol: "tcp",
      fromPort: 3306,
      toPort: 3306,
      // Allow inbound traffic only from the public subnet CIDR block
      cidrBlocks: publicSubnetCidrBlocks,
    }],
    tags: {
      "Owner": ownerTag!
    },
  });

  const cfg = new pulumi.Config();

  // TODO generate and store password as a secret for RDS
  // const rdsPassword = new random.RandomPassword("rdsPassword", {
  //   length: 16, // Adjust the length as needed
  //   special: true, // Include special characters in the password
  // });

  // // Store the generated password in the Pulumi configuration
  // cfg.requireSecret("rdspassword", rdsPassword.result);
  
  // Create the RDS database instance
  const rdsInstance = new aws.rds.Instance(`${ownerTag}-rds-instance`, {
    allocatedStorage: 20,
    engine: "mysql",
    engineVersion: "8.0",
    instanceClass: "db.t3.micro",
    dbName: `${ownerTag}RDS`, // dbName can only be alpah numeric characters
    identifier: rdsName,
    username: "admin",
    password: cfg.requireSecret("rdspassword"), // TODO generate and store this without human intervention
    skipFinalSnapshot: true,
    vpcSecurityGroupIds: [dbSecurityGroup.id],
    dbSubnetGroupName: dbSubnetGroup.name, // Use the subnet group created above
    tags: {
      "Owner": ownerTag!
    },
  });

  return rdsInstance;
}

// Create the RDS database instance using the createRDS function
const rdsInstance = createRDS();

// Export the Kubernetes cluster and the web application URL
export const kubeconfigOutput = pulumi.secret(cluster.kubeconfig);
export const webAppUrl = pulumi.interpolate `http://${webAppService.status.loadBalancer.ingress[0].hostname}`;