variable "PROJECT_NAME" {
  description = "The name of the project"
  default     = "tdm" # tdm = Tarkov Data Manager
  type        = string
}

variable "CLOUD_LOCATION" {
  description = "Location/Region for the cloud provider to deploy your cluster in"
  default     = "eastus" # ex: West US 2
  type        = string
}


# Azure Creds
variable "CLIENT_SECRET" {
  type = string
}

variable "CLIENT_ID" {
  type = string
}

variable "TENANT_ID" {
  type = string
}

variable "SUBSCRIPTION_ID" {
  type = string
}
