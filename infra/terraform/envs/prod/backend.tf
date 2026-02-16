terraform {
  backend "s3" {
    bucket         = "synduck-tfstate-management-001"
    key            = "synduck/prod/terraform.tfstate"
    region         = "ap-northeast-1"
    dynamodb_table = "synduck-tf-lock"
    encrypt        = true
  }
}
