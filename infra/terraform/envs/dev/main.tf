
data "aws_caller_identity" "current" {}

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

  google_oauth_enabled = var.google_client_id != "" && var.google_client_secret != ""
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

  cors_configuration {
    allow_origins = ["*"]
    allow_headers = ["content-type", "authorization"]
    allow_methods = ["GET", "POST", "DELETE", "OPTIONS"]
    max_age       = 86400
  }

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

resource "aws_apigatewayv2_route" "graphs_get" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /graphs"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "graphs_post" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /graphs"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "graphs_delete" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "DELETE /graphs"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "graphs_options" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "OPTIONS /graphs"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "graphs_similar_get" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /graphs/similar"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "graphs_similar_options" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "OPTIONS /graphs/similar"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "share_get" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /share"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "share_post" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /share"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "share_options" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "OPTIONS /share"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "permissions_get" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /permissions"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "permissions_post" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /permissions"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "permissions_options" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "OPTIONS /permissions"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "guest_session_post" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /guest/session"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "guest_session_options" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "OPTIONS /guest/session"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "nodes_get" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /nodes"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "nodes_post" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /nodes"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}


resource "aws_apigatewayv2_route" "nodes_options" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "OPTIONS /nodes"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}
resource "aws_apigatewayv2_route" "edges_get" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /edges"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "edges_post" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /edges"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "edges_delete" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "DELETE /edges"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}


resource "aws_apigatewayv2_route" "edges_options" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "OPTIONS /edges"
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
  supported_identity_providers         = local.google_oauth_enabled ? ["COGNITO", "Google"] : ["COGNITO"]

  callback_urls = [
    "http://localhost:3000/auth/callback",
    "${local.web_url}/auth/callback.html"
  ]

  logout_urls = [
    "http://localhost:3000/",
    "${local.web_url}/"
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

resource "aws_cognito_identity_provider" "google" {
  count = local.google_oauth_enabled ? 1 : 0

  provider_name = "Google"
  provider_type = "Google"
  user_pool_id  = aws_cognito_user_pool.users.id

  attribute_mapping = {
    email       = "email"
    given_name  = "given_name"
    family_name = "family_name"
  }

  provider_details = {
    client_id        = var.google_client_id
    client_secret    = var.google_client_secret
    authorize_scopes = "email profile openid"
  }
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

# --- Web static hosting (S3 + CloudFront) ---
resource "aws_s3_bucket" "web" {
  bucket        = "${local.project}-${local.env}-web-${data.aws_caller_identity.current.account_id}"
  force_destroy = true

  tags = {
    Project = local.project
    Env     = local.env
  }
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket = aws_s3_bucket.web.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${local.project}-${local.env}-web-oac"
  description                       = "OAC for S3 origin"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "web_rewrite" {
  name    = "${local.project}-${local.env}-rewrite"
  runtime = "cloudfront-js-1.0"
  publish = true
  code    = <<-EOT
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
    return request;
  }

  if (uri.indexOf('.') === -1) {
    request.uri = uri + '.html';
  }

  return request;
}
EOT
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  comment             = "${local.project}-${local.env}-web"
  default_root_object = "index.html"

  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "s3-web"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD", "OPTIONS"]
    target_origin_id = "s3-web"

    viewer_protocol_policy = "redirect-to-https"

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.web_rewrite.arn
    }

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Project = local.project
    Env     = local.env
  }
}

data "aws_iam_policy_document" "web_bucket_policy" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web_bucket_policy.json

  depends_on = [aws_s3_bucket_public_access_block.web]
}

locals {
  web_url = "https://${aws_cloudfront_distribution.web.domain_name}"
}

output "web_bucket_name" {
  value = aws_s3_bucket.web.bucket
}

output "web_cloudfront_domain" {
  value = aws_cloudfront_distribution.web.domain_name
}

output "web_url" {
  value = local.web_url
}

output "web_cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.web.id
}
