# synduck dev environment
# MVP target: API Gateway (HTTP) + Lambda + DynamoDB

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# NOTE: Resources will be added incrementally.
