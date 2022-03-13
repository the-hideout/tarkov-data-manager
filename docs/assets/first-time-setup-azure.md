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

1. Optionally, setup a SSL/TLS certificate to security serve traffic to your domain

    1. Ensure that you have a DNS record pointing to the public IP of your VM
    2. On your VM, generate a TLS certificate with lets-encrypt

        ```bash
        sudo certbot certonly --standalone --register-unsafely-without-email
        ```

        > This example uses `manager.thehideout.io` as the domain

    3. Run the following script (edit if you changed the domain) to copy your certs into your nginx container directory that gets mounted when it runs:

        ```bash
        script/cert-update
        ```

    4. Finally, restart your container stack `sudo make run`
    5. Connect to `manager.thehideout.io` and login with the password you placed in the `creds.env` file above
