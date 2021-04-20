#!/bin/bash

PROVISIONED_FILE="/root/config/vcx-config.json"
AGENCY_URL="https://eas01.pps.evernym.com"
INSTITUTION_NAME=${INSTITUTION_NAME}
INSTITUTION_LOGO=${INSTITUTION_LOGO}
ENTERPRISE_SEED=${ENTERPRISE_SEED}
WALLET_NAME="LIBVCX_SDK_WALLET"
WALLET_KEY="12345"

cd /root/config
if [ -z "$ENTERPRISE_SEED" ];then
    echo "No environment seed value exists, using randomly generated Enterprise Seed...."
    ENTERPRISE_SEED="$(pwgen 32 -1)">eseed.txt   
fi     
## Provision agency into wallet
echo "Provisioning agent against: $AGENCY_URL into wallet: $WALLET_NAME"
echo "  as Insitituion: $INSTITUTION_NAME with logo: $INSTITUTION_LOGO"
python3 /usr/share/libvcx/provision_agent_keys.py --enterprise-seed "$ENTERPRISE_SEED" --wallet-name $WALLET_NAME $AGENCY_URL $WALLET_KEY > vcx-config.json
if [ $? -ne 0 ] ; then
    echo "ERROR occurred trying to provision agent! Aborting!"
    exit 1
fi
if grep '"provisioned"' vcx-config.json | grep 'false' ; then
    echo "ERROR occurred trying to provision agent! Aborting!"
    cat vcx-config.json
    exit 1
fi

# This commands substitutes <CHANGE_ME> values in libVCX configuration file with the values provided in the arguments
echo "Updating vcx-config.json..."
sed -i -e 's!"institution_name": "<CHANGE_ME>"!"institution_name": "'"$INSTITUTION_NAME"'"!' \
       -e 's!"institution_logo_url": "<CHANGE_ME>"!"institution_logo_url": "'"$INSTITUTION_LOGO"'"!' \
       -e 's!"genesis_path": "<CHANGE_ME>"!"genesis_path": "/root/config/genesis.txn"!' \
       -e 's!"payment_method": "null"!"payment_method": "sov"!' \
       -e 's!"genesis_path"!"author_agreement": "{\\"taaDigest\\": \\"8cee5d7a573e4893b08ff53a0761a22a1607df3b3fcd7e75b98696c92879641f\\",\\"acceptanceMechanismType\\":\\"on_file\\",\\"timeOfAcceptance\\": '"$(date +%s)"'}",\n  "genesis_path"!' vcx-config.json
# chown indy.indy vcx-config.json

INSTITUTION_DID=$(grep institution_did vcx-config.json | awk 'BEGIN {FS="\""} {print $4}')
INSTITUTION_VERKEY=$(grep institution_verkey vcx-config.json | awk 'BEGIN {FS="\""} {print $4}')
echo "Registering DID: ${INSTITUTION_DID} and VerKey: ${INSTITUTION_VERKEY} with sovrin selfserver portal"
echo "----Response Begin----"
curl -sd "{\"network\":\"stagingnet\",\"did\":\"$INSTITUTION_DID\",\"verkey\":\"$INSTITUTION_VERKEY\",\"paymentaddr\":\"\"}" https://selfserve.sovrin.org/nym
echo
echo "----Response End----"
echo "Provisioning Complete"