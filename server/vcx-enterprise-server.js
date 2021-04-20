#!/usr/bin/env node

// imports
var request = require('request');
var cors = require('cors');
var qr = require('qr-image');
var fs = require('fs-extra');
var express = require('express');
var session = require('express-session');
const bodyParser = require('body-parser');
var vcxwebtools = require('./vcx-web-tools.js');
let complete = false;
// set up app express server
const INSTALL_DIR = '/opt/village';
const SCHEMA_DIR = `${INSTALL_DIR}/schema`;
const PORT = 5000;
const app = express();
app.use(session({secret: "Secret Key"}));
app.use(bodyParser.urlencoded({ extended: false }));
const server = require('http').Server(app);
const io = require('socket.io')(server);
var vcx = require('node-vcx-wrapper');
const {
  Schema,  
  DisclosedProof,
  CredentialDef,
  Credential,
  Connection,
  IssuerCredential,
  Proof,
  StateType,
  Error,
  rustAPI
} = vcx;
// sockets.io listen
io.on('connection',socket=>{
    socket.on('disconnect',()=>{
    })
    socket.on('message',function(data){
        console.log(data);
    })
})
// express server listen
server.listen(PORT,function(){
    console.log(`Listening on Port ${PORT}`);
});
// app settings for json, url, cors, and a public folder for shared use
app.use(express.json());
// express use url encoded for post messages
app.use(express.urlencoded());
// express set up Cross Origin
app.use(cors());

// url endpoints 
const enterprise_1_api_url = "172.28.128.44";
const enterprise_2_api_url = "172.28.128.45";

// Enterprise issue proof request
app.post(`/api/v1/enterprise/issue_proof_request`, async function(req,res){
    // receive body of request
    console.log(req.body);
    let cred_name = req.body['credential'];
    let endpoint = req.body['endpoint'];
    // make connection
    let connection = await vcxwebtools.makeConnection('QR','enterprise_connection','000');
    let details = await connection.inviteDetails(true);
    // send connection request to endpoint via request
    request.post({
      // headers
      headers: {'content-type' : 'application/json'},
      // REST API endpoint
      url: `${endpoint}/api/v1/enterprise/receive_proof_request`,
      // JSON body data
      body : details
      },
      // callback
      function (error, response, body) {
          console.log(response);
          if (!error && response.statusCode == 200) {
              console.log(body);
          }
      }
    );
    // Poll for successful Connection
    let state = await connection.getState();
    while(state != 4) {
        console.log("The State of the Connection is "+ state);
        await connection.updateState();
        state = await connection.getState();
    }
    // issue proof request to enterprise
    let proof_state = await vcxwebtools.offerProof(cred_name,connection);
    io.emit('proof requested');
    console.log("Proof has processed");
    io.emit('proof processing');
    console.log(`state of y proof is ${proof_state}`);
    if (proof_state == 1){
        io.emit(`${cred_name} valid`);
        io.emit('proof valid');
        }else{
        console.log(`Proof is invalid`);
        io.emit(`${cred_name} invalid`);
        io.emit('proof invalid');
        }
})

// Enterprise Receive Proof Request
app.post(`/api/v1/enterprise/receive_proof_request`, async function(req,res){
    let inviteDetails = JSON.stringify(req.body);
    let nm = req.body['s']['n'];
    io.emit('recipient_news',{connection:`${nm} has requested a Connection with you`});
    // Accept invitation
    let connection= await Connection.createWithInvite({ id: '1', invite: inviteDetails });
    await connection.connect({id:"1"});
    console.log('Connection Invite Accepted');
    await connection.updateState();
    let state = await connection.getState();
    console.log("State is :::");
    console.log(state);
    while(state != StateType.Accepted){
        sleep(5000);
        await connection.updateState();
        state = await connection.getState();
        console.log("State is :::");
        console.log(state);
    }

    let ser_connection = await connection.serialize();
    console.log(ser_connection);
    io.emit('recipient_news',{connection:`Public DID : ${ser_connection['data']['their_public_did']} has Connected with you`});
    io.emit('recipient_news',{connection:`${nm} has Requested a Proof : `});

    let requests = await DisclosedProof.getRequests(connection);
    while(requests.length == 0){
        // sleep(5000);
        requests = await DisclosedProof.getRequests(connection);
        io.emit('news',{connection:'Waiting on Proof Requests'});
        console.log("Waiting on Requests");
    }
    io.emit('recipient_news',{connection:'Request Made'});
    io.emit('recipient_news',{connection:JSON.stringify(requests[0])});
    console.log('Creating a Disclosed proof object from proof request');
    io.emit('recipient_news',{connection:'Creating a Disclosed proof object from proof request'});
    let proof = await DisclosedProof.create({ sourceId: 'proof', request: JSON.stringify(requests[0])});
    console.log(await proof.serialize());
    console.log('Query for credentials in the wallet that satisfy the proof request');
    let credentials = await proof.getCredentials();
    console.log(credentials);
    var self_attested;
    for (let attr in credentials['attrs']) {
        credentials['attrs'][attr] = { credential: credentials['attrs'][attr][0] };
        console.log(attr);
        self_attested = attr;
    }
    // if the proof request matches the credential
    let cred_x = JSON.stringify(credentials['attrs'][self_attested]);
    console.log(`LENGTH OF CREDS IS ${cred_x}`);
    console.log(credentials['attrs']);
    // { 'Supplier CID': { credential: undefined } }
    console.log('Generate the proof');

    if(cred_x != '{}'){
        console.log("The credential exists");
        await proof.generateProof({selectedCreds: credentials, selfAttestedAttrs: {}});
    }else{
        console.log("Credential does not exist");
        io.emit('recipient_news',{connection:'You did not possess this Credential'});
        credentials = { self_attested: { credential: "undefined" } };
        await proof.generateProof({selectedCreds: credentials, selfAttestedAttrs: {}});
    }
    let s_proof = await proof.serialize();
    console.log(s_proof);
    console.log('Send the proof to agent');
    await proof.sendProof(connection);
    await proof.updateState();
    let pstate = await proof.getState();
    while(pstate !== 4){
        sleep(2000);
        console.log(`proof should have been sent  the State is : ${pstate}`);
        await proof.updateState();
        pstate = proof.getState();
    }
    console.log(`Proof sent!!`);
    io.emit('recipient_news',{connection:'Proof has been sent'});

})


// Enterprise Offer Credentials

app.post(`/api/v1/enterprise/offer_credentials`, async function(req,res){
  console.log(req.body);
  let cred_name = req.body['credential'];
  let endpoint = req.body['endpoint'];
  let connection = await vcxwebtools.makeConnection('QR','enterprise_connection','000');
  let details = await connection.inviteDetails(true);
  // send connection request to endpoint via request
  request.post({
    // headers
    headers: {'content-type' : 'application/json'},
    // REST API endpoint
    url: `${endpoint}/api/v1/enterprise/receive_credentials`,
    // JSON body data
    body : details
    },
    // callback
    function (error, response, body) {
        if (!error && response.statusCode == 200) {
            //console.log(body);
        }
    }
  );
  // Poll for successful Connection
  let state = await connection.getState();
  while(state != StateType.Accepted) {
      console.log("The State of the Connection is "+ state);
      await connection.updateState();
      state = await connection.getState();
  }
  vcxwebtools.offerCredential(cred_name,connection);
})

// Enterprise Receive Credentials

app.post(`/api/v1/enterprise/receive_credentials`, async function(req,res){
     //get details
     console.log("ACCEPTING REQUEST...");
     let inviter = req.body['s']['n'];
     let inviteDetails = JSON.stringify(req.body);
     console.log(inviteDetails);
     //io.emit('recipient_news',{connection:`Connection Requested has been sent by ${inviter}`});

     let connection = await vcxwebtools.connectWithInvitation('1', inviteDetails);
     // build connection
     await connection.connect({id:"1"});
     console.log('Connection Invite Accepted');
     await connection.updateState();
     let state = await connection.getState();
     while(state != StateType.Accepted){
         await connection.updateState();
         state = await connection.getState();
         console.log("State is :::");
         console.log(state);
     }
     io.emit('recipient_news',{connection:`Credential offers from ${inviter} are :`});

     let offers = await Credential.getOffers(connection);
     while(offers.length < 1){
         offers = await Credential.getOffers(connection);
         console.log("Credential Offers Below:");
         console.log(JSON.stringify(offers[0]));
         io.emit('recipient_news',{connection: JSON.stringify(offers[0])});

     }
     let credential = await Credential.create({ sourceId: 'enterprise', offer: JSON.stringify(offers[0]), connection: connection});
     await credential.sendRequest({ connection: connection, payment: 0});
     let credentialState = await credential.getState();
     while (credentialState !== StateType.Accepted) {
       sleep(2);
       await credential.updateState();
       credentialState = await credential.getState();
       console.log(`Credential state is : ${credentialState}`);
     }
     let serial_cred = await credential.serialize();
     console.log(serial_cred);
     //await fs.writeJSON(`./data/received-credential.json`,serial_cred);
     //io.emit('recipient_news',{connection:`Credential Accepted`});

})

// Generate schema and credential definition based upon json file in ./data/cred_name-schema.json
app.post('/api/v1/build_credential', async function(req,res){
  let cred_name = req.body['build_cred'];
  io.emit('credential building');
  io.emit("credential built");
  let schema = await vcxwebtools.createSchema(cred_name);
  let credDef = await vcxwebtools.createCredentialDef(cred_name);
  let schema_ID = await schema.getSchemaId();
  let credDef_ID = await credDef.getCredDefId();
  //res.setHeader('Content-type', 'application/json');
//   res.end(JSON.stringify({
//   "message":"completed",
//    "Schema ID":schema_ID,
//    "Cred ID": credDef_ID 
//   }))  
})

// expiration global
function ExpireAll(){
  if(complete){
      io.emit('timer expired');
      console.log('global timer expired');
  }
}
setTimeout(ExpireAll,500000);

// polling killer
let killTime = 300000;
let killPolling = false;
let timeUp = function(x){
    if(x){
        io.emit("times up");
        console.log("times up");
        killPolling = true;
    }else{
        killPolling = false;
    }
}

//sleep function
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
