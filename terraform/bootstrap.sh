#!/bin/bash

# add dependencies
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install make -y

# install docker
curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh
# install docker-compose
sudo curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# clone the tarkov-data-manager repo (tarkov-crons for testing)
git clone git@github.com:the-hideout/tarkov-crons.git

# firewall connections for web traffic
sudo ufw allow 80
sudo ufw allow 443

# finish off with one more update
sudo apt-get update && sudo apt-get upgrade -y
