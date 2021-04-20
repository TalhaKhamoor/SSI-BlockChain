# import python libs
import asyncio
import sys
from time import sleep
import os
import json
import random
from argparse import ArgumentParser

# global vcx config file
configPath = "../config/vcx-config.json"
def parse_args():
    parser = ArgumentParser()
    parser.add_argument("IMAGE_URL")    
    parser.add_argument("INSTITUTION_NAME")
    parser.add_argument("GENESIS_PATH")
    return parser.parse_args()
args = parse_args()

async def editConfig() :
    # args parse
    INSTITUTION_NAME = args.INSTITUTION_NAME
    IMAGE_URL = args.IMAGE_URL
    GENESIS_PATH = args.GENESIS_PATH
    # initialize vcx
    if __name__ == '__main__':
        # await vcx_init(configPath)
    # Read json input
        CONFIG_FILE = "../config/vcx-config.json"
    with open(CONFIG_FILE,'r') as fh:
        input_array = json.loads(fh.read())
    # Edit values in config file
    input_array['institution_logo_url'] = IMAGE_URL
    input_array['institution_name'] = INSTITUTION_NAME
    input_array['genesis_path']  = GENESIS_PATH
    input_array['payment_method'] = 'sov'
    input_array["author_agreement"] = "{\"taaDigest\": \"8cee5d7a573e4893b08ff53a0761a22a1607df3b3fcd7e75b98696c92879641f\",\"acceptanceMechanismType\":\"on_file\",\"timeOfAcceptance\": 1580939969}"
    # input_array["use_latest_protocols"] = "true"
    # add increments to float value for schema creation, then write them to schema definition file
    with open(CONFIG_FILE,'w') as fh:
        fh.write(json.dumps(input_array))
    print("****************************")
    print("Enter the following values in the correct locations at https://selfserve.sovrin.org to register your DID on the Staging Net. Make sure the Staging Net is selected.")
    print("****************************")
    print("INSTITUTION DID:")
    print(input_array['institution_did'])
    print("INSTITUTION VERKEY:")
    print(input_array['institution_verkey'])
    print("****************************")
    exit()
if __name__ == '__main__':
    loop = asyncio.get_event_loop()
    loop.run_until_complete(editConfig())