#!/bin/bash

# script configuration - change these values to match your environment
DOMAIN=manager.thehideout.io # the domain to serve traffic with
REPO_DIR=/home/tdm/tarkov-data-manager # the repo to clone and use for the app deployment
VM_USER=tdm # the name of the vm user

# add dependencies
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install make -y

# install docker
curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh
# install docker-compose
sudo curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# clone the tarkov-data-manager repo
git clone https://github.com/the-hideout/tarkov-data-manager.git $REPO_DIR
sudo chown -R $VM_USER:$VM_USER $REPO_DIR

# firewall connections for ssh
sudo ufw allow 22

# firewall connections for web traffic
sudo ufw allow 80
sudo ufw allow 443
sudo ufw allow http
sudo ufw allow https

# enable the firewall
sudo ufw --force enable

# run updates again
sudo apt-get update && sudo apt-get upgrade -y

# switch to the main vm user
sudo -i -u $VM_USER bash << EOF
echo "export DOMAIN=$DOMAIN" >> ~/.profile
(crontab -l ; echo "@reboot $REPO_DIR/script/deploy") | crontab -
EOF

echo "bootstrap complete"
