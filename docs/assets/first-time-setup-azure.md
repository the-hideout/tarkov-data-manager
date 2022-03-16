# First time setup

The very first time you go to build this application in production for Azure you will need to do the following

1. Ensure you have a file named: `terraform.auto.tfvars.json` in the `terraform/` directory locally
1. Ensure this file has proper contents to auth to Azure (note: do not commit this file):

    ```json
    {
        "CLIENT_ID": "abc123-abc123-abc123-abc123",
        "CLIENT_SECRET": "supersecret",
        "SUBSCRIPTION_ID": "abc456-abc456-abc456-abc456",
        "TENANT_ID": "abc789-abc789-abc789-abc789"
    }
    ```

1. Run the following commands to build your vm in Azure:

    ```bash
    cd terraform/
    terraform init
    terraform apply -auto-approve
    terraform output -raw tls_private_key > key.pem
    ```

    > Note: These commands will build and apply the infrastructure in Azure. The last command saves the private ssh key for you to connect to the vm to complete setup

1. Complete setup by ssh'ing to your VM and adding the proper credentials to run the app
    1. SSH into the vm

        ```bash
        ssh -i key.pem tdm@<public_ip_address>
        ```

        > tdm should be the username of the vm. Check the Terraform files to see what the username is.

    1. `touch src/tarkov-data-manager/creds.env` - Creates the creds file to store secrets for running the app
    1. Add your secrets to the file you just created

1. Run `source ~/.profile` to update env vars

1. Optionally, create a DNS record that points to the VM's public IP address

1. Start your container stack `script/deploy`

## TLS

If you are using a domain name and have it configured as the DOMAIN env var, then Caddy will attempt to auto-provision a TLS certificate with Let's Encrypt.

You will need to ensure you completed the step above to enable a DNS record pointing to your VM

## First time deploy, failure

You may notice that if you deploy for the first time using GitHub actions, it will fail. This is because of a chicken and the egg problem. You need to deploy the VM via Terraform, then SSH into it and create the `src/tarkov-data-manager/creds.env` so the Docker containers can start. Then, both the `terraform` and `ssh remote deploy` parts of the pipeline will succeed

## GitHub Actions Secrets

There are a few secrets you need to set in GitHub Actions so that our CI/CD pipeline can run

- Azure Credentials
  - Key: `AZURE_CREDENTIALS`
  - Value: (string of json below)

    ```json
    {"clientId": "<GUID>",
    "clientSecret": "<GUID>",
    "subscriptionId": "<GUID>",
    "tenantId": "<GUID>"}
    ```

    > Note: The formatting of the `AZURE_CREDENTIALS` json is important. See the [docs](https://github.com/marketplace/actions/azure-login)

- Terraform API Token
  - Key: `TF_API_TOKEN`
  - Value: `<terraform api key>`

  > See the [docs](https://www.terraform.io/docs/cloud/users-teams-organizations/api-tokens.html) for more info

- Azure CLIENT_ID
  - Key: `CLIENT_ID`
  - Value: `<clientId>`

  > See the [docs](https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/guides/azure_cli) for more info

- Azure CLIENT_SECRET
  - Key: `CLIENT_SECRET`
  - Value: `<clientSecret>`

  > See the [docs](https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/guides/azure_cli) for more info

- Azure TENANT_ID
  - Key: `TENANT_ID`
  - Value: `<tenantId>`

  > See the [docs](https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/guides/azure_cli) for more info

- Azure SUBSCRIPTION_ID
  - Key: `SUBSCRIPTION_ID`
  - Value: `<subscriptionId>`

  > See the [docs](https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/guides/azure_cli) for more info

- SSH_HOST
  - Key: `SSH_HOST`
  - Value: `<public ip address or hostname>`

- SSH_USERNAME
  - Key: `SSH_USERNAME`
  - Value: `<username of the vm user>`

- SSH_KEY
  - Key: `SSH_KEY`
  - Value: `<ssh private key>`

  > Can be obtained with `terraform output -raw tls_private_key > key.pem`

- SSH_PORT
  - Key: `SSH_PORT`
  - Value: `<public port ssh is running on>`
