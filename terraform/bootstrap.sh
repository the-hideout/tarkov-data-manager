#!/bin/bash

# add dependencies
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install make -y

# install docker
curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh
# install docker-compose
sudo curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# clone the tarkov-data-manager repo
git clone https://github.com/the-hideout/tarkov-data-manager.git /home/tdm/tarkov-data-manager
sudo chown -R tdm:tdm /home/tdm/tarkov-data-manager

# firewall connections for ssh
sudo ufw allow 22

# firewall connections for web traffic
sudo ufw allow 80
sudo ufw allow 443
sudo ufw allow http
sudo ufw allow https

# enable the firewall
sudo ufw --force enable

# install certbot
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot

# finish off with one more update
sudo apt-get update && sudo apt-get upgrade -y
