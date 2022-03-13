# Configure the Microsoft Azure Provider
provider "azurerm" {
  features {}
  # Ignore Auth Warnings
  skip_provider_registration = true

  client_id       = var.CLIENT_ID
  client_secret   = var.CLIENT_SECRET
  tenant_id       = var.TENANT_ID
  subscription_id = var.SUBSCRIPTION_ID
}

# Create a resource group if it doesn't exist
resource "azurerm_resource_group" "tdm_rg" {
  name     = "${var.PROJECT_NAME}_rg"
  location = var.CLOUD_LOCATION

  tags = {
    managed_by = "terraform"
  }
}

# Create virtual network
resource "azurerm_virtual_network" "tdm_vnet" {
  name                = "${var.PROJECT_NAME}_vnet"
  address_space       = ["10.0.0.0/16"]
  location            = var.CLOUD_LOCATION
  resource_group_name = azurerm_resource_group.tdm_rg.name

  tags = {
    managed_by = "terraform"
  }
}

# Create subnet
resource "azurerm_subnet" "tdm_subnet" {
  name                 = "${var.PROJECT_NAME}_subnet"
  resource_group_name  = azurerm_resource_group.tdm_rg.name
  virtual_network_name = azurerm_virtual_network.tdm_vnet.name
  address_prefixes     = ["10.0.1.0/24"]
}

# Create public IPs
resource "azurerm_public_ip" "tdm_public_ip" {
  name                = "${var.PROJECT_NAME}_public_ip"
  location            = var.CLOUD_LOCATION
  resource_group_name = azurerm_resource_group.tdm_rg.name
  allocation_method   = "Dynamic"

  tags = {
    managed_by = "terraform"
  }
}

# Create Network Security Group and rule
resource "azurerm_network_security_group" "tdm_sec_group" {
  name                = "${var.PROJECT_NAME}_security_group"
  location            = var.CLOUD_LOCATION
  resource_group_name = azurerm_resource_group.tdm_rg.name

  security_rule {
    name                       = "SSH"
    priority                   = 1001
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  tags = {
    managed_by = "terraform"
  }
}

# Create network interface
resource "azurerm_network_interface" "tdm_nic" {
  name                = "${var.PROJECT_NAME}_nic"
  location            = var.CLOUD_LOCATION
  resource_group_name = azurerm_resource_group.tdm_rg.name

  ip_configuration {
    name                          = "${var.PROJECT_NAME}_nic_configuration"
    subnet_id                     = azurerm_subnet.tdm_subnet.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.tdm_public_ip.id
  }

  tags = {
    managed_by = "terraform"
  }
}

# Connect the security group to the network interface
resource "azurerm_network_interface_security_group_association" "tdm_sec_group_association" {
  network_interface_id      = azurerm_network_interface.tdm_nic.id
  network_security_group_id = azurerm_network_security_group.tdm_sec_group.id
}

# Create (and display) an SSH key
resource "tls_private_key" "example_ssh" {
  algorithm = "RSA"
  rsa_bits  = 4096
}
output "tls_private_key" {
  value     = tls_private_key.example_ssh.private_key_pem
  sensitive = true
}

# Data template Bash bootstrapping file
data "template_file" "linux-vm-cloud-init" {
  template = file("bootstrap.sh")
}

# Create virtual machine
resource "azurerm_linux_virtual_machine" "tdm_vm" {
  name                  = "${var.PROJECT_NAME}_vm"
  location              = var.CLOUD_LOCATION
  resource_group_name   = azurerm_resource_group.tdm_rg.name
  network_interface_ids = [azurerm_network_interface.tdm_nic.id]
  size                  = "Standard_B1s"

  delete_os_disk_on_termination = true

  os_disk {
    name                 = "${var.PROJECT_NAME}_os_disk"
    caching              = "ReadWrite"
    storage_account_type = "StandardSSD_LRS"
  }

  # https://stackoverflow.com/questions/71253468/creating-an-azure-linux-vm-with-ubuntu-20-04-with-terraform
  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-focal"
    sku       = "20_04-lts-gen2"
    version   = "20.04.202203080"
  }

  computer_name                   = "${var.PROJECT_NAME}-vm"
  admin_username                  = var.PROJECT_NAME
  disable_password_authentication = true
  custom_data    = base64encode(data.template_file.linux-vm-cloud-init.rendered)

  admin_ssh_key {
    username   = var.PROJECT_NAME
    public_key = tls_private_key.example_ssh.public_key_openssh
  }

  tags = {
    managed_by = "terraform"
  }
}
