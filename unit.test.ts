import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { createRDS } from "./index";

jest.mock("@pulumi/aws", () => ({
  ...jest.requireActual("@pulumi/aws"),
  rds: {
    Instance: jest.fn().mockImplementation((name, args, opts) => {
      return {
        id: `${name}-mock-id`,
        arn: `${name}-mock-arn`,
      };
    }),
    SubnetGroup: jest.fn().mockImplementation((name, args, opts) => {
      return {
        name,
        subnetIds: ["subnet-12345678", "subnet-87654321"],
      };
    }),
    SecurityGroup: jest.fn().mockImplementation((name, args, opts) => {
      return {
        id: `${name}-mock-id`,
      };
    }),
  },
  ec2: {
    SecurityGroup: jest.fn().mockImplementation((name, args, opts) => {
      return {
        id: `${name}-mock-id`,
      };
    }),
  },
}));

describe("createRDS function", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should create an RDS instance with correct configuration", async () => {
    // Mock the required configuration variable
    jest.spyOn(pulumi.Config.prototype, "requireSecret").mockReturnValueOnce("mock-rds-password");

    createRDS();

    expect(pulumi.Config.prototype.requireSecret).toHaveBeenCalledWith("project:rdspassword");
    expect(aws.rds.Instance).toHaveBeenCalled();
    expect(aws.rds.SubnetGroup).toHaveBeenCalled();
    expect(aws.ec2.SecurityGroup).toHaveBeenCalledWith(expect.any(String), {
      vpcId: expect.any(String),
      ingress: [
        {
          protocol: "tcp",
          fromPort: 3306,
          toPort: 3306,
          cidrBlocks: ["0.0.0.0/0"],
        },
      ],
    });

    // Additional check for port 3306 not open to the world
    const securityGroupArgs = (aws.ec2.SecurityGroup as jest.Mock).mock.calls[0][1];
    const ingressRules = securityGroupArgs.ingress as aws.types.input.ec2.SecurityGroupIngress[];
    const rule = ingressRules[0]; // Assuming only one ingress rule is defined

    expect(rule.cidrBlocks).not.toContain("0.0.0.0/0");
  });
});
