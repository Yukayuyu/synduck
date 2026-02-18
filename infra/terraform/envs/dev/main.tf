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


resource "aws_iam_role_policy" "lambda_ddb" {
  name = "${local.project}-${local.env}-lambda-ddb"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:Scan",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem"
        ]
        Resource = aws_dynamodb_table.sessions.arn
      }
    ]
  })
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

resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id           = aws_apigatewayv2_api.http.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${local.project}-${local.env}-jwt"

  jwt_configuration {
    issuer   = local.cognito_issuer
    audience = [aws_cognito_user_pool_client.web.id]
  }
}

resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /health"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "nodes_get" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /nodes"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "nodes_post" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "POST /nodes"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_apigatewayv2_route" "edges_get" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /edges"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "edges_post" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "POST /edges"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
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

# --- Cognito (Hosted UI, password auth) ---
resource "aws_cognito_user_pool" "users" {
  name = "${local.project}-${local.env}-users"

  auto_verified_attributes = ["email"]

  username_attributes = ["email"]

  password_policy {
    minimum_length    = 10
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = true
  }

  tags = {
    Project = local.project
    Env     = local.env
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${local.project}-${local.env}-web"
  user_pool_id = aws_cognito_user_pool.users.id

  generate_secret = false

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]

  callback_urls = [
    "http://localhost:3000/auth/callback"
  ]

  logout_urls = [
    "http://localhost:3000/"
  ]

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]

  prevent_user_existence_errors = "ENABLED"

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool_domain" "hosted" {
  domain       = "synduck-dev-auth-001"
  user_pool_id = aws_cognito_user_pool.users.id
}

locals {
  cognito_domain = "https://${aws_cognito_user_pool_domain.hosted.domain}.auth.ap-northeast-1.amazoncognito.com"
  cognito_issuer = "https://cognito-idp.ap-northeast-1.amazonaws.com/${aws_cognito_user_pool.users.id}"
  cognito_jwks   = "${local.cognito_issuer}/.well-known/jwks.json"
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.users.id
}

output "cognito_user_pool_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "cognito_domain" {
  value = local.cognito_domain
}

output "cognito_issuer" {
  value = local.cognito_issuer
}

output "cognito_jwks_url" {
  value = local.cognito_jwks
}

output "cognito_hosted_ui_login_url" {
  description = "Hosted UI login URL (OAuth2 code flow)"
  value       = "${local.cognito_domain}/login?client_id=${aws_cognito_user_pool_client.web.id}&response_type=code&scope=openid+email+profile&redirect_uri=http://localhost:3000/auth/callback"
}
