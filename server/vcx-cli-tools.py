import asyncio
import json
import os
import sys
import random
import argparse
import qrcode
from time import sleep
import datetime
import inspect
import uuid
import base64

sys.path.append('./modules')

from vcx.api.vcx_init import vcx_init
from vcx.api.connection import Connection
from vcx.api.issuer_credential import IssuerCredential
from vcx.api.proof import Proof
from vcx.api.schema import Schema
from vcx.api.credential_def import CredentialDef
from vcx.api.wallet import Wallet
from vcx.state import State, ProofState
from vcx.api.utils import vcx_agent_provision, vcx_messages_download, vcx_messages_update_status
from vcx.common import mint_tokens
from ctypes import cdll
from vcx.error import VcxError

# Global variables
configPath = "../config/vcx-config.json"

async def makeConnection(connection_type, name, phone_number):
    print("You called {} with parameters {}".format(inspect.stack()[0][3], ', '.join(['{}={}'.format(k,v) for k,v in locals().items()])))
    await _initialize()
    connection = await Connection.create(name)
    print("Attempting connection via {}".format(connection_type))
    if (connection_type == 'QR'): 
        connection_data = {
            'id': name,
            'connection_type': 'QR',
            'use_public_did': False
        }        
        connection_args = json.dumps(connection_data)
        await connection.connect(connection_args)        
        await connection.update_state()
        details = await connection.invite_details(True)
        details_text = str(json.dumps(details))
        print(details_text)
        img = qrcode.make(details_text)
        img.save('../data/{}-connection-invite.png'.format(name))
        print(">>> Open the QR Code at ../data/{}-connection-invite.png for display, and scan it with connect.me".format(name))
    elif (connection_type == 'SMS'):
        connection_data = {
            'id': name,
            'connection_type': 'SMS',
            'phone': phone_number,
            'use_public_did': False
        }
        connection_args = json.dumps(connection_data)
        await connection.connect(connection_args)
        details = await connection.invite_details(True)
        details_text = str(json.dumps(details))
        print(details_text)
 
    else:
        print('Unrecognized connection type: {}'.format(connection_type))
        return
    connection_state = await connection.get_state()
    while connection_state != State.Accepted:
        sleep(2)
        print('The state of the connection is {}'.format(connection_state))
        await connection.update_state()
        connection_state = await connection.get_state()
    serialized_connection = await connection.serialize()
    with open('../data/{}-connection.json'.format(name), 'w') as fh:
        json.dump(serialized_connection, fh)
    print('Success!! Connection complete. The state of the connection is {}'.format(connection_state))
    return


async def askProvableQuestion(connection_name):
    print("You called {} with parameters {}".format(inspect.stack()[0][3], ', '.join(['{}={}'.format(k,v) for k,v in locals().items()])))
    await _initialize()
    with open('../data/{}-connection.json'.format(connection_name),'r') as fh:
        connection_data = json.load(fh)
    connection = await Connection.deserialize(connection_data)    
    pairwiseDid = connection_data['data']['pw_did']
    expiration = datetime.datetime.now() + datetime.timedelta(minutes=5)
    msg_uuid = uuid.uuid4()
    question = {
        '@type': 'did:sov:BzCbsNYhMrjHiqZDTUASHg;spec/committedanswer/1.0/question',
        '@id': '{}'.format(msg_uuid),
        'question_text': 'Test Question',
        'question_detail': 'Are you currently requesting access?',
        'valid_responses': [
            { 'text': "I am, let me in", 'nonce': 'YES' },
            { 'text': "No, block access!", 'nonce': 'NO' }
        ],
        '@timing': {
            'expires_time': expiration.strftime("%Y-%m-%dT%H:%M:%S+0000")
        }
    }
    print('Question JSON: {}'.format(json.dumps(question)))
    msg_id = await connection.send_message(json.dumps(question), "Question", "Asking test question")
    msg_id = msg_id.decode('utf-8')
    # print("Sent message Id: {}".format(msg_id))
    answer = None
    while (datetime.datetime.now() < expiration):
        # poll for question response received
        messages_json = await vcx_messages_download(status='MS-104', uids=msg_id, pw_dids=pairwiseDid)
        messages = json.loads(messages_json.decode('ASCII'))
        if len(messages[0]['msgs']) == 0:
            print("No response yet")
            await vcx_messages_update_status(json.dumps([{'pairwiseDID': pairwiseDid, 'uids': [msg_id]}]))
            sleep(2)
            continue
        else:
            # print('Question message status: {}'.format(messages[0]['msgs']))
            response_id=messages[0]['msgs'][0]['refMsgId']
            await vcx_messages_update_status(json.dumps([{'pairwiseDID': pairwiseDid, 'uids': [response_id]}]))
            # download the answer
            messages_json = await vcx_messages_download(status='', uids=response_id, pw_dids=pairwiseDid)
            messages = json.loads(messages_json.decode('ASCII'))
            # print('Response messages: {}'.format(messages))
            for message in messages[0]['msgs']:
                if message['type'] == 'Answer' and message['uid'] == response_id:
                    answer = json.loads(json.loads(message['decryptedPayload'])['@msg'])
                    break
            if answer == None:
                print('There should have been an answer received...')
                break
            else:
                # We got an answer, determine the response
                signature = base64.b64decode(answer['response.@sig']['signature'])
                data = answer['response.@sig']['sig_data']
                valid = await connection.verify_signature(data.encode(), signature)

                if valid:
                    print("-- The digitally signed response: ", base64.b64decode(data).decode('ASCII'))
                else:
                    print("-- Signature was not valid")

                break
    if answer == None:
        print("Timeout occurred before a response was received")
    return


async def createSchema(schema_name):
    print("You called {} with parameters {}".format(inspect.stack()[0][3], ', '.join(['{}={}'.format(k,v) for k,v in locals().items()])))
    await _initialize()
    with open('../data/{}-schema.json'.format(schema_name),'r') as fh:
        schema_data = json.load(fh)
    # Increment the version to avoid collisions on the ledger
    new_version = float(schema_data['data']['version']) + 0.01
    schema_data['data']['version'] = '{:.2f}'.format(new_version)
    print('schema data: {}'.format(schema_data))
    schema = await Schema.create(schema_data['sourceId'], schema_data['data']['name'], schema_data['data']['version'], schema_data['data']['attrNames'], schema_data['paymentHandle'])
    schema_id = await schema.get_schema_id()
    # Write the resulting transaction ID from the ledger out to the json file for later reference
    schema_data['schemaId'] = schema_id
    with open('../data/{}-schema.json'.format(schema_name),'w') as fh:
        json.dump(schema_data, fh)
    print("Your schema with ID {} was written to the ledger".format(schema_id))
    return


async def createCredentialDef(schema_name):
    print("You called {} with parameters {}".format(inspect.stack()[0][3], ', '.join(['{}={}'.format(k,v) for k,v in locals().items()])))
    await _initialize()
    with open('../data/{}-schema.json'.format(schema_name),'r') as fh:
        schema_data = json.load(fh)
    print('Creating credential definition for schema {}'.format(schema_data['schemaId']))
    cred_def = await CredentialDef.create(schema_data['sourceId'], schema_name, schema_data['schemaId'], schema_data['paymentHandle'])
    serialized_cred_def = await cred_def.serialize()
    with open('../data/{}-credential-definition.json'.format(schema_name), 'w') as fh:
        json.dump(serialized_cred_def, fh)
    print('credential definition data: {}'.format(serialized_cred_def)) 
    cred_def_id = await cred_def.get_cred_def_id()
    print('Success! The credential definition with ID {} was written to the ledger'.format(cred_def_id))
    return


async def offerCredential(credential_name, connection_name):
    print("You called {} with parameters {}".format(inspect.stack()[0][3], ', '.join(['{}={}'.format(k,v) for k,v in locals().items()])))
    await _initialize()
    with open('../data/{}-credential-definition.json'.format(credential_name),'r') as fh:
        credential_definition_data = json.load(fh)
    with open('../data/{}-{}-data.json'.format(connection_name, credential_name),'r') as fh:
        credential_data = json.load(fh)
    with open('../data/{}-connection.json'.format(connection_name),'r') as fh:
        connection_data = json.load(fh)
    connection = await Connection.deserialize(connection_data)
    credential_definition = await CredentialDef.deserialize(credential_definition_data)
    cred_def_handle = credential_definition.handle
    credential = await IssuerCredential.create(
                       'arbitrary_enterprise_tag', 
                       credential_data['attrs'], 
                       cred_def_handle, 
                       'arbitrary_cred_name', 
                       '0')
    print('Credential is successfully created. Now offering it to {}'.format(connection_name))
    await credential.send_offer(connection)
    await credential.update_state()
    state = await credential.get_state()
    while state != State.RequestReceived:
        sleep(2)
        print('The state of the credential offer is {}'.format(state))
        await credential.update_state()
        state = await credential.get_state()    
    print('The state of the credential offer is {}'.format(state))
    print('The credential offer has been accepted. Now sending the signed credential to {}'.format(connection_name))
    await credential.send_credential(connection)
    await credential.update_state()
    state = await credential.get_state()
    while state != State.Accepted:
        sleep(2)
        print('The state of the credential transmission is {}'.format(state))
        await credential.update_state()
        state = await credential.get_state()
    print('The state of the credential transmission is {}'.format(state))
    print('Success! The verifiable credential has been sent to {}'.format(connection_name))
    return


async def requestProof(proof_name, connection_name):
    print("You called {} with parameters {}".format(inspect.stack()[0][3], ', '.join(['{}={}'.format(k,v) for k,v in locals().items()])))
    await _initialize()
    with open('../data/{}-proof-definition.json'.format(proof_name),'r') as fh:
        proof_template = json.load(fh)
    with open('../data/{}-connection.json'.format(connection_name),'r') as fh:
        connection_data = json.load(fh)
    connection = await Connection.deserialize(connection_data)
    print('sending proof request for: {}'.format(json.dumps(proof_template)))
    proof = await Proof.create(proof_template['sourceId'],
                               proof_template['name'], 
                               proof_template['attrs'],
                               proof_template['revocationInterval'])
    await proof.request_proof(connection)    
    await proof.update_state()
    state = await proof.get_state()
    while state != State.RequestReceived:
        sleep(2)
        print('The state of the proof request is {}'.format(state))
        await proof.update_state()
        state = await proof.get_state()
    print('The state of the proof request is {}'.format(state) + ' Checking validity of proof{}'.format(state))
    returned_proof = await proof.get_proof(connection) 
    if _verifyClaims(returned_proof, proof_template):
        print("All restricted claims in proof are verified!!")
    else:
        print("Could NOT verify all restricted claims in proof :(")

    with open('../data/{}-proof.json'.format(connection_name),'w') as fh:
        fh.write(json.dumps(returned_proof, sort_keys=True, indent=4, separators=(',', ': ')))
    print("For proof details, look in {}".format('../data/{}-proof.json'.format(connection_name)))
    return


async def getProofAttribute(connection_name, attribute_name):
    print("You called {} with parameters {}".format(inspect.stack()[0][3], ', '.join(['{}={}'.format(k,v) for k,v in locals().items()])))
    with open('../data/{}-proof.json'.format(connection_name),'r') as fh:
        proof_obj = json.load(fh)
    if (attribute_name in proof_obj["requested_proof"]["revealed_attrs"]):
        issuer_index = proof_obj["requested_proof"]["revealed_attrs"][attribute_name]["sub_proof_index"]
        cred_def_id = proof_obj["identifiers"][int(issuer_index)]["cred_def_id"]
        issuer_did = cred_def_id.split(':')[0]
        print('The attribute "{}" is "{}". The validatated issuer is: {}'.format(attribute_name, proof_obj["requested_proof"]["revealed_attrs"][attribute_name]["raw"], issuer_did))
    elif (attribute_name in proof_obj["requested_proof"]["predicates"]):
        issuer_index = proof_obj["requested_proof"]["predicates"][attribute_name]["sub_proof_index"]
        cred_def_id = proof_obj["identifiers"][int(issuer_index)]["cred_def_id"]        
        issuer_did = cred_def_id.split(':')[0]
        print('The attribute "{}" predicate is "{}". The validatated issuer is: {}'.format(attribute_name, proof_obj["requested_proof"]["predicates"][attribute_name]["raw"], issuer_did))
    elif (attribute_name in proof_obj["requested_proof"]["self_attested_attrs"]):
        print('The self-attested attribute "{}" is "{}"'.format(attribute_name, proof_obj["requested_proof"]["self_attested_attrs"][attribute_name]))
    else:
        print('{} was not found in the returned proof'.format(attribute_name)) 
    return

# Utility functions

async def _initialize():
    lib = cdll.LoadLibrary('/usr/lib/libsovtoken.so')
    lib.sovtoken_init()
    await vcx_init(configPath)
    return


def _verifyClaims(theProof, proofTemplate):
    #determine which claims should have restrictions applied
    restricted = []
    for attribute in proofTemplate['attrs']:
        if "restrictions" in attribute:
            restricted.append(attribute["name"])
    verified = True
    for claim in restricted:
        if claim not in theProof["requested_proof"]["revealed_attrs"]:
            verified = False
            print('Attribute "{}" has unmet restrictions.'.format(claim))
    return verified


if __name__ == '__main__':
    function = getattr(sys.modules[__name__], sys.argv[1])
    loop = asyncio.get_event_loop()
    loop.run_until_complete(function(*sys.argv[2:]))
    loop.stop()
    loop.close()
    print("Exiting...")
    sleep(1)
    exit()

