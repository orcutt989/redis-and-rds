import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { createRDS } from "./index";

jest.mock("@pulumi/pulumi", () => ({
  ...jest.requireActual("@pulumi/pulumi"),
  output: jest.fn().mockImplementation((val: any) => val), // Mock output function
}));

describe("createRDS function", () => {
  beforeEach(() => {
    jest.clearAllMocks(); // Clear all mocks before each test
  });

  it("should create an RDS instance with correct security group ingress rules", async () => {
    // Mock the output of pulumi.output to return a value that can be used with .apply()
    (pulumi.output as jest.Mock).mockReturnValueOnce({
      apply: jest.fn().mockResolvedValue(["mock-cidr-block"]), // Mocked CIDR block
    });

    createRDS(); // Call createRDS function

    // Check that SecurityGroup constructor was called with the correct arguments
    expect(aws.ec2.SecurityGroup).toHaveBeenCalledWith(
      expect.any(String), // Name of the security group
      {
        vpcId: expect.any(String), // Mocked VPC ID
        ingress: [
          {
            protocol: "tcp",
            fromPort: 3306,
            toPort: 3306,
            cidrBlocks: ["mock-cidr-block"], // Mocked CIDR block
          },
        ],
        tags: {
          "Owner": expect.any(String), // Mocked owner tag
        },
      }
    );
  });
});
