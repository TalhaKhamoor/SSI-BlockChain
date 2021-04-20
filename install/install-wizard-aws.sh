#!/usr/bin/env python

## This bash script will install the following:
## Libindy 1.12.0
## Libsovtoken
## Libvcx
## Provision wallet and save config/vcx-config.json
## pip for python 3
## NodeJS 8.x
## Make sure to run this script inside the directory created by unzipping the package provided with the Accelerator
## This script does not install python or node wrappers 
## This script does not properly edit the vcx-config.json file, which must be customized with genesis.txn location, Enterprise Name, and Logo URL
# WALLETSEEED=$1
# ENTERPRISESEED=$2

echo "CONFIGURATION PARAMETERS"
# enterprise seed
echo "Enter 32 character Enterprise Seed to provision wallet - leaving this blank will generate a random key"
read -p ':' eseed
echo $eseed
# image url
echo "Enter Image URL (leaving this blank will default to a VCX logo) "
read -p ':' imageurl
echo $imageurl
# Institution Name
echo "Enter Institution Name (hit return for default value"
read -p ':' instname
echo $instname
# genesis path - this is the absolute path to the genesis file for initiating the Ledger Pool
echo "Enter the absolute path to the genesis.txn file (the default assumes you are using Vagrant, and will use /home/ubuntu/config/genesis.txn"
read -p ':' genesispath
echo $genesispath
# agency server - this is the agency server being used
echo "Enter the Agency Server (the default value is https://eas01.pps.evernym.com)"
read -p ':' agencyserver
echo $agencyserver

if [ -z "$imageurl" ]
then
      echo "\$imageurl is empty, using default VCX logo"
      imageurl="https://s3.us-east-2.amazonaws.com/static.evernym.com/images/icons/cropped-Evernym_favicon-trans-192x192.png"

else
      echo "\$imageurl is NOT empty"
fi

if [ -z "$instname" ]
then
      echo "\$instname is empty, using default value of MY_VCX"
      instname="MY_VCX_KIOSK"

else
      echo "\$instname is NOT empty"
fi

if [ -z "$eseed" ]
then
      echo "\$eseed is empty"

else
      echo "\$eseed is NOT empty"
fi

if [ -z "$genesispath" ]
then
      echo "\$genesispath is empty, using default value of /home/ubuntu/config/genesis.txn"
      genesispath="/home/ubuntu/config/genesis.txn"

else
      echo "\$genesispath is NOT empty"
fi

if [ -z "$agencyserver" ]
then
      echo "\$agencyserver is empty, using default value of https://eas01.pps.evernym.com"
      agencyserver="https://eas01.pps.evernym.com"

else
      echo "\$agencyserver is NOT empty"
fi


# Add Keys and Update apt-get Libraries:
sudo apt-key adv --keyserver keyserver.ubuntu.com --recv-keys 68DB5E88 && 
sudo add-apt-repository "deb https://repo.sovrin.org/sdk/deb xenial stable" &&
sudo apt-get update &&
sudo apt-get install pwgen &&

if [ -z "$eseed" ]
then
      echo "\$eseed is empty"
      eseed="$(pwgen 32 -1)" &&
      echo "The E Seed is :::"
      echo "$eseed"
      echo $eseed> eseed.txt
else
      echo "\$eseed is NOT empty"
      echo $eseed> eseed.txt
fi

# Install libindy
# sudo dpkg -i libindy_1.12.0_amd64.deb &&
sudo apt-get install -y libindy=1.12.0 &&
sudo apt-get install -y libsovtoken=1.0.3 &&

# Install Libsovtoken and libvcx with dpkg Debian Packages
sudo dpkg -i ../install/libnullpay_1.12.0_amd64.deb &&
# sudo dpkg -i ../install/libsovtoken_1.0.3_amd64.deb &&
sudo dpkg -i ../install/libvcx_0.4.64203032-b6f70b9_amd64.deb &&
sudo apt-get install -f &&

#  Provision Keys and Build Wallet, copy values to config/vcx-config.json (if wallet already exists remove it first)
if [  -d "/home/ubuntu/.indy_client/wallet" ]; then
    echo 'Wallet already exists; deleting....'
    sudo rm -r ~/.indy_client/wallet
fi 

# Create config dir and provision libvcx with enterprise seed and agency server
if [ ! -d "../config" ]; then
    mkdir ../config
    # CONFIG = ""
    # python3 /usr/share/libvcx/provision_agent_keys.py $agencyserver 55555 --enterprise-seed $1> CONFIG
    # jq '.key1 = "new-value1"' <<<"$CONFIG"
    python3 /usr/share/libvcx/provision_agent_keys.py $agencyserver 55555 --enterprise-seed $eseed> ../config/vcx-config.json
fi

# touch config/vcx-config.json
if [ -d "../config" ]; then
    python3 /usr/share/libvcx/provision_agent_keys.py $agencyserver 55555 --enterprise-seed $eseed> ../config/vcx-config.json
fi

# log contents of config file
sudo cat ../config/vcx-config.json &&

# Install Python3 pip Packager and 
sudo apt-get install -y python3-pip &&
pip3 install qrcode[pil] &&

Install Python VCX Wrapper Modules

tar xvf python3-vcx-wrapper_0.4.64205249.tar.gz &&
if [ ! -d "../server/modules" ]; then
    mv python3-vcx-wrapper-0.4.64205249 ../server/modules &&
    rm -r python3-vcx-wrapper-0.4.64205249 &&
    echo 'added python vcx modules'
fi

# Install NodeJS version 8.x
curl -sL https://deb.nodesource.com/setup_8.x | sudo -E bash - &&
sudo apt-get install -y nodejs &&
node --version

# npm install if package.json exists
if [ -f "../server/package.json" ];then
    npm install --prefix ../server/ &&
    echo 'installed node wrapper package'
fi

# test VCX config and installation
python3 editConfig.py "$imageurl" "$instname" "$genesispath" &&
# run vcx-server as a service
sudo chmod +x VCXWebApp.service &&
sudo cp VCXWebApp-aws.service /etc/systemd/system/VCXWebApp.service &&
sudo systemctl start VCXWebApp.service &&
# install and config nginx
yes | sudo apt-get install nginx &&
# clean /var/www
sudo rm -Rf /var/www/html/* &&
# symlink /var/www => /home/ubuntu/web
sudo ln -s /home/ubuntu/web/* /var/www/html &&
sudo cp ../web/default /etc/nginx/sites-available/default
# restart services
sudo systemctl restart nginx.service
sudo systemctl restart VCXWebApp.service &&
sudo systemctl status VCXWebApp.service &&
# test VCX
curl -sd "{\"network\":\"stagingnet\",\"did\":\"$INSTITUTION_DID\",\"verkey\":\"$INSTITUTION_VERKEY\",\"paymentaddr\":\"\"}" https://selfserve.sovrin.org/nym
python3 editConfig.py "$imageurl" "$instname" "$genesispath" &&
node ../server/vcx-cli-tools.js testVCX