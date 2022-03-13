terraform {
  backend "remote" {
    organization = "the-hideout"

    workspaces {
      name = "tarkov-data-manager"
    }
  }

  required_providers {
    azurerm = {
      source = "hashicorp/azurerm"
      version = "2.99.0"
    }
  }

  required_version = "=1.1.7" # Change this to a different version if you want
}
