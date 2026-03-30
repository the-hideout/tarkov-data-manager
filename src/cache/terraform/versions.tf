terraform {
  backend "remote" {
    organization = "the-hideout"

    workspaces {
      name = "cache"
    }
  }

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "3.10.0"
    }
  }

  required_version = "=1.2.2" # Change this to a different version if you want
}
