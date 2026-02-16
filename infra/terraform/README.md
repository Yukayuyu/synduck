# Terraform (synduck)

This repository uses Terraform with an S3 backend + DynamoDB lock.

## Environments
- `infra/terraform/envs/dev`
- `infra/terraform/envs/prod`

## Backend
Configured in each env's `backend.tf`:
- S3 bucket: `synduck-tfstate-management-001`
- DynamoDB lock table: `synduck-tf-lock`
- Region: `ap-northeast-1`

## CI/CD
GitHub Actions:
- PR: runs `terraform fmt/validate/plan` (dev only)
- Push to main: `terraform apply` (dev)
- Manual dispatch: `terraform apply` (prod) with environment approval

## Notes
- Start small: MVP is API Gateway (HTTP) + Lambda + DynamoDB.
- Add permissions to the GitHub Actions roles incrementally (least privilege).
