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

locals {
  project = "synduck"
  env     = "dev"
}

# --- DynamoDB (sessions) ---
resource "aws_dynamodb_table" "sessions" {
  name         = "${local.project}-${local.env}-sessions"
  billing_mode = "PAY_PER_REQUEST"

  hash_key = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  tags = {
    Project = local.project
    Env     = local.env
  }
}

# --- Lambda (health) ---
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/mvp_lambda"
  output_path = "${path.module}/.build/mvp_lambda.zip"
}

resource "aws_iam_role" "lambda_exec" {
  name = "${local.project}-${local.env}-lambda-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Project = local.project
    Env     = local.env
  }
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "api" {
  function_name = "${local.project}-${local.env}-api"
  role          = aws_iam_role.lambda_exec.arn

  runtime = "nodejs20.x"
  handler = "index.handler"

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      SESSIONS_TABLE = aws_dynamodb_table.sessions.name
      ENV            = local.env
    }
  }

  tags = {
    Project = local.project
    Env     = local.env
  }
}

# --- HTTP API Gateway ---
resource "aws_apigatewayv2_api" "http" {
  name          = "${local.project}-${local.env}-http"
  protocol_type = "HTTP"

  tags = {
    Project = local.project
    Env     = local.env
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /health"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  tags = {
    Project = local.project
    Env     = local.env
  }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

output "http_api_url" {
  value       = aws_apigatewayv2_api.http.api_endpoint
  description = "Base URL for the HTTP API (AWS default domain)"
}
