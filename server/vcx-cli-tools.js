#!/usr/bin/env node
var vcx = require('node-vcx-wrapper');
var qr = require('qr-image');
var fs = require('fs-extra');
var ffi = require('ffi');
const base64url = require('base64url')
const crypto = require('crypto');
var request = require('request');

//vcx imports
const {
  Schema,
  CredentialDef,
  Connection,
  IssuerCredential,
  Proof,
  StateType,
  Error,
  rustAPI
} = vcx;

// load up libsovtoken
async function run(){
    const myffi = ffi.Library('/usr/lib/libsovtoken.so', {sovtoken_init: ['void', []]});
    await myffi.sovtoken_init();
}
run();

// global vars
let config = "../config/vcx-config.json";
async function testVCX(){
  try{
      await vcx.initVcx(config);
      return("VCX has been successfully initiated");
  }catch(err){
      console.log("VCX has not been successfully initiated, see error below...");
      return(err.message);
  }
}
async function makeConnection(type,name,phonenumber){
  await vcx.initVcx(config);
  let connectionData ={};
  let connectionArgs={};
  let connection = await Connection.create({"id":name});
  console.log(`vcx will attempt Connection through ${type}`);
  if(type=="QR"){
    connectionData=
      {
        "id":name,
        "connection_type":"QR",
        "use_public_did":true
      }
      connectionArgs = {data: JSON.stringify(connectionData)};
      await connection.connect(connectionArgs);
      let details = await connection.inviteDetails(true);
      console.log(details);
      let qrcode = qr.image(details, { type: 'png' });
      qrcode.pipe(fs.createWriteStream(`../data/${name}-connection.png`));
      let state = await connection.getState();
      let timer =0;
      // Poll Agency for status update
      while(state != StateType.Accepted && timer < 120) {
          await sleep(2000);
          console.log(`The State of the Connection is ${state} and the timer is ${timer}`);
          await connection.updateState();
          await connection.serialize();
          state = await connection.getState();
          timer+=1;
      }
      timer=0;
      if(state == 4){
        let serialized_connection = await connection.serialize();
        let connection_file_path = `../data/${name}-connection.json`;
        await fs.writeJson(connection_file_path,serialized_connection);
        return (`Success!! Connection Complete. You can find the connection data at ${connection_file_path}`);
      }else{
        return (`The Connection has timed out.`);
      }
  }else if(type=="SMS"){
      connectionData=
      {
        "id":name,
        "connection_type":"SMS",
        "phone":String(phonenumber),
        "use_public_did":false
      }
      connectionArgs = {data: JSON.stringify(connectionData)};
      await connection.connect(connectionArgs);
      let details = await connection.inviteDetails(true);
      let state = await connection.getState();
      let timer =0;
      while(state != StateType.Accepted && timer < 120) {
          await sleep(2000);
          console.log(`The State of the Connection is ${state} and the timer is ${timer}`);
          await connection.updateState();
          state = await connection.getState();
          timer+=1;
      }
      timer=0;
      if(state == 4){
        let serialized_connection = await connection.serialize();
        let connection_file_path = `../data/${name}-connection.json`;
        await fs.writeJson(connection_file_path,serialized_connection);
        return (`Success!! Connection Complete. You can find the connection data at ${connection_file_path}`);
      }else{
        return (`The Connection has timed out.`);
      }
  }
}

async function askProvableQuestion (connection_name) {
    await vcx.initVcx(config);
    serialized_connection = await fs.readJson(`../data/${connection_name}-connection.json`);
    deserialized_connection = await Connection.deserialize(serialized_connection);
    const pairwiseDid = serialized_connection.data.pw_did;
    const expiration = getExpirationDate({ seconds: 60 });
    const question = {
      '@type': 'did:sov:BzCbsNYhMrjHiqZDTUASHg;spec/committedanswer/1.0/question',
      '@id': '518be002-de8e-456e-b3d5-8fe472477a86',
      'question_text': 'Test Question',
      'question_detail': 'Are you There?',
      'valid_responses': [
        { 'text': "ACCEPT", 'nonce': 'YES' },
        { 'text': "REJECT", 'nonce': 'NO' }
      ],
      '@timing': {
        'expires_time': expiration
      }
    }
    await deserialized_connection.sendMessage({
      msg: JSON.stringify(question),
      type: 'Question',
      title: 'Asking login question'
    })
    let answer;
    while (!isExpired(expiration)) {
      let messages = await vcx.downloadMessages({ status: 'MS-103', pairwiseDids: pairwiseDid });
      messages = JSON.parse(messages);
      for (const message of messages[0]['msgs']) {
        if (message.type === 'Answer') {
          if (answer) {
            console.log('More then one "Answer" message')
          } else {
            answer = JSON.parse(JSON.parse(message['decryptedPayload'])['@msg'])
          }
          await vcx.updateMessages({ msgJson: JSON.stringify([{ 'pairwiseDID': pairwiseDid, 'uids': [message.uid] }]) });
        }
      }
      if (answer) {
        break
      }
    }
    if (isExpired(expiration)) {
      console.log("expired");
      throw Error('Timeout');
    } else {
      console.log(answer);
      const signature = Buffer.from(answer['response.@sig']['signature'], 'base64')
      const data = answer['response.@sig']['sig_data']
      console.log('validating signature');
      const valid = await deserialized_connection.verifySignature({ data: Buffer.from(data), signature });
      if (valid) {
        console.log('Signature is valid!')
        return base64decode(data)
      } else {
        console.log('Signature validation failed')
        return false
      }
    }
}

async function createSchema(schema_name){
    await vcx.initVcx(config);
    let schema_data = await fs.readJson(`../data/${schema_name}-schema.json`);
    //set up incremental version float in order to avoid schema version conflicts
    let currentVersion = parseFloat (schema_data.data.version);
    newVersion = currentVersion +.01;
    schema_data.data.version = String(newVersion.toFixed(2));
    console.log(schema_data);
    let schema = await Schema.create(schema_data);
    //retrieve schema ID on Ledger
    let schemaId = await schema.getSchemaId();
    //write the Ledger ID to the schema json file for future use
    schema_data['schemaId'] = schemaId;
    await fs.writeJson(`../data/${schema_name}-schema.json`,schema_data);
    return(`Congratulations! Your schema was written to the Ledger and the id is : ${schemaId}`);
}

async function createCredentialDef(schema_name){
    await vcx.initVcx(config);
    let schema_data = await fs.readJson(`../data/${schema_name}-schema.json`);
    if(schema_data.schemaId == null){
      console.log(`schema ${schema_name} doesn't exist yet on Ledger, writing it before writing the Credential Definition...`);
      //set up incremental version float in order to avoid schema version conflicts
      let currentVersion = parseFloat (schema_data.data.version);
      newVersion = currentVersion +.01;
      schema_data.data.version = String(newVersion.toFixed(2));
      console.log(schema_data);
      let schema = await Schema.create(schema_data);
      //retrieve schema ID on Ledger
      let schemaId = await schema.getSchemaId();
      //write the Ledger ID to the schema json file for future use
      schema_data['schemaId'] = schemaId;
      await fs.writeJson(`../data/${schema_name}-schema.json`,schema_data);
      console.log(`Congratulations! Your schema was written to the Ledger and the id is : ${schemaId}`);
    }
    console.log(schema_data.schemaId);
    console.log('creating credential definition');
    const data = {
        name: schema_name,
        paymentHandle: 0,
        revocation: false,
        revocationDetails: {
            tailsFile: 'tails.txt',
        },
        schemaId: schema_data.schemaId,
        sourceId: schema_data.sourceId
    };
    console.log(data);
    let credentialDef = await CredentialDef.create(data);
    let ser_CredDef = await credentialDef.serialize();
    console.log(ser_CredDef);
    let credDefId = await credentialDef.getCredDefId();
    await fs.writeJson(`../data/${schema_name}-credential-definition.json`,ser_CredDef);
    return(`Congratulations! Your Credential Definition was written to the Ledger and the id is : ${credDefId}`);
}
async function offerCredential(credential_name,connection_name){
    await vcx.initVcx(config);
    let credential_definition = await fs.readJson(`../data/${credential_name}-credential-definition.json`);
    let credential_data = await fs.readJson(`../data/${connection_name}-${credential_name}-data.json`);
    let connection_data = await fs.readJson(`../data/${connection_name}-connection.json`);
    let connection = await Connection.deserialize(connection_data);
    let serial_connection = await connection.serialize();
    var cred_def_deserialzed = await CredentialDef.deserialize(credential_definition);
    // get credential definition handle
    cred_def_handle = await cred_def_deserialzed.handle;
    console.log (`handle is _ ${cred_def_handle}`);
    let credential = await IssuerCredential.create({
        "sourceId":"1",
        "credDefHandle": cred_def_handle,
        "attr": credential_data.attrs,
        "credentialName":"Cred Name",
        "price": "0"
    });
    console.log(`Successfully created A Credential, now offering it to ${connection_name}...`);
    await credential.sendOffer(connection);
    await credential.updateState();
    let state = await credential.getState();
    let timer = 0;
    while(state != 3 && timer < 120) {
      await sleep(2000);
        console.log("Offer Sent, The State of the Credential Offer is "+ state);
        await credential.updateState();
        state = await credential.getState();
    }
    timer = 0;
    await credential.sendCredential(connection);
    while(state != 4) {
      console.log("Credential Sent, The State of the Credential is "+ state);
      await credential.updateState();
      state = await credential.getState();
    }
    return(`Congratulations! Your Credential was offered and accepted by ${connection_name}`);
}
async function requestProof(proof_name,connection_name){
    await vcx.initVcx(config);
    let proof_data = await fs.readJson(`../data/${proof_name}-proof-definition.json`);
    let connection_data = await fs.readJson(`../data/${connection_name}-connection.json`);
    let connection = await Connection.deserialize(connection_data);
    await connection.updateState();
    await connection.serialize();
    console.log(proof_data);
    let proof = await Proof.create(proof_data);
    await proof.requestProof(connection);
    await proof.updateState();
    state = await proof.getState();
    while(state != StateType.RequestReceived){
        console.log(`The state of the proof is ${state}`)
        await proof.updateState();
        state = await proof.getState();
        if(state == StateType.Accepted) {
            let proof_return = await proof.getProof(connection);
            console.log(`The get proof state is ${JSON.stringify(proof_return)}`);
            break;
        }
    }
    await proof.updateState();
    state = await proof.getState();
    var proof_return = await proof.getProof(connection);
    var proof_state = await proof_return.proofState;
    if(proof_state == 1){
        let proof_output = proof.serialize();
        await fs.writeJson(`../data/${connection_name}-${proof_name}-proof.json`,proof_output);
        return(`Congratulations! You have Issued a Proof request to ${connection_name} and validated it. You can find this data in ${connection_name}-${proof_name}-proof.json`);
    }else{
        return(`You issued a Proof request to ${connection_name} but it was not valid. Try again`);
    }

}

module.exports={
  testVCX,
  makeConnection,
  createSchema,
  createCredentialDef,
  offerCredential,
  requestProof,
  askProvableQuestion
}
//make script runnable in CLI
require('make-runnable/custom')({
    printOutputFrame: false
})

// helper functions for structured messaging
function getToken (size) {
    return base64url(crypto.randomBytes(size))
  }
function getExpirationDate (config = {}) {
    let expiration = new Date()
    if (config.hours) {
        expiration = new Date(expiration.setHours(expiration.getHours() + config.hours))
    }
    if (config.minutes) {
        expiration = new Date(expiration.setMinutes(expiration.getMinutes() + config.minutes))
    }
    if (config.seconds) {
        expiration = new Date(expiration.setSeconds(expiration.getSeconds() + config.seconds))
    }
        return expiration.toISOString()
}
function isExpired (expirationDate) {
    // return (expirationDate < new Date().toISOString())
    return false;
}
function base64decode (data) {
    const buff = Buffer.from(data, 'base64')
    return buff.toString('ascii')
  }
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
