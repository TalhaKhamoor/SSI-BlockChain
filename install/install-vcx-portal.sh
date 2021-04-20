#!/bin/bash
set -e
cd /root/install/

# Remove config before installing and provisioning
if [ -f "/root/config/vcx-config.json" ]; then
    rm /root/config/vcx-config.json
fi
# enterprise seed code for persisting DIDs **MUST MAKE THIS SECURE FOR PRODUCTION**
# if [ -f "/root/install/eseed.txt" ]; then
#    echo "Seed exists."
#    eseed=$(</root/config/eseed.txt)
# else
#     echo "File $FILE does not exist."
#     touch /root/install/eseed.txt &&
#     eseed="$(pwgen 32 -1)" 
#     echo "The E Seed is :::" 
#     echo "$eseed" 
#     echo $eseed> /root/config/eseed.txt
# fi

#  Provision Keys and Build Wallet, copy values to config/vcx-config.json (if wallet already exists remove it first)
if [  -d "/root/.indy_client/wallet" ]; then
    echo 'Wallet already exists; deleting....'
    rm -r /root/.indy_client/wallet
fi

# Run Provisioning Script
bash provision_agent.sh &&

# npm install if package.json exists
if [ -f "/root/server/package.json" ];then
    npm install --prefix /root/server/ &&
    echo 'installed node wrapper package'
fi

# install and config nginx
yes | apt-get install nginx &&
# clean /var/www
rm -Rf /var/www/html/* &&
# symlink /var/www => ../web
cp -r /root/web/* /var/www/html &&
cp /root/web/default /etc/nginx/sites-available/default

# PREP AND REGISTER
node /root/server/vcx-cli-tools.js testVCX &&

# Build Credentials from schema (needs to be set in a loop)
cd /root/server &&
for script in $(find /root/data/ -type f -name "*schema.json" | sort -n); do
    y=${script%-schema.json}
    z=${y##*/}
    echo $z
    echo -e "\nRunning Credential Build: '$z'"
    node vcx-cli-tools.js createCredentialDef "$z"
    sync
    rc=$?
    if [ $rc -ne 0 ] ; then
        exit $rc
    fi
done

### THIS IS CONSIDERED ENTRYPOINT MEANING SUPERVISORD STARTS UP
echo -e "\nStarting supervisor"
/usr/bin/supervisord -c /etc/supervisord.conf &
sleep 1
echo -e "\nStartup Actions Completed"
echo "Checking that supervisor managed processes started"
cnt=0
while supervisorctl status 2>&1 | grep -q STARTING ; do
    if [ $cnt -ge 20 ] ; then
        break
    fi
    sleep 0.5
    echo "Waiting for processes to finish starting"
    let cnt+=1
done
sleep 10
echo "Supervisor managed processes are started. Checking they started OK"
if supervisorctl status 2>&1 | grep -qE 'FATAL|STOP|BACKOFF' ; then
    echo "Some processes failed to start: "
    supervisorctl status
    if [ "${IGNORE_PROCESS_ERRORS/\"//}" != "true" ] ; then
        exit 1
    else
        echo "Ignoring errors...."
    fi
fi
supervisorctl status
echo "Done"
# Wait back on the supervisord process
wait


