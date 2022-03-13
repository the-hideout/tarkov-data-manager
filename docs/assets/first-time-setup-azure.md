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

1. Optionally, create a DNS record that points to the VM's public IP address
