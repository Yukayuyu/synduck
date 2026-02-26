variable "google_client_id" {
  description = "Google OAuth 2.0 Client ID for Cognito Identity Provider"
  type        = string
  default     = ""
}

variable "google_client_secret" {
  description = "Google OAuth 2.0 Client Secret for Cognito Identity Provider"
  type        = string
  sensitive   = true
  default     = ""
}
