#!/usr/bin/env node

/*
Original Code From      : vcx-server.js (Evernym's Verity UI customer-toolkit)
Studied and Modified by : Hyun Ji (Clara) Lee
Description             : This is vcx-server.js, a server-side JavaScript code. 
                          vcx-client.js sends requests over to vcx-server.js 
                          using XMLHttpRequest objects. vcx-server.js receives
                          server requests through Express.js and further calls
                          functions from vcx-web-tools.js to handle different
                          types of requests. 
                          Once the request processing is completed, most of the
                          functions of vcx-server.js returns different types of
                          results back to vcx-client.js.
                          Some functions return JSON objects using send() function
                          of Express.js. These JSON objects will contain data or
                          the result of the request processing. Some other functions
                          do not return anything but calls the io.emit() function
                          from socket.io API. This will return different strings
                          back to vcx-client.js.
*/

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
const PORT = 5050;
const app = express();
app.use(session({secret: "Secret Key"}));
app.use(bodyParser.urlencoded({ extended: false }));
const server = require('http').Server(app);
const io = require('socket.io')(server,{path:`/api/socket.io`});
var this_did;
var connection_id = 0;

async function getConfigData(){
  let config = await fs.readJSON("../config/vcx-config.json");
  // let this_did = config['institution_did'];
  return config;
}

// sockets.io listen
io.on('connection',socket=>{
    socket.on('disconnect',()=>{
    })
    socket.on('message',function(data){
        console.log(data);
    })
})

// express server listen
server.listen(PORT, async function(){
    let config =  await getConfigData();
    this_did = config['institution_did'];
    console.log(`VCX Server DID ${this_did} is Listening on Port ${PORT}`);
});

// app settings for json, url, cors, and a public folder for shared use
app.use(express.json());

// express use url encoded for post messages
app.use(express.urlencoded());

// express set up Cross Origin
app.use(cors());

// Receive a list of files from the server data directory
app.get(`/api/v1/file_list`,async function(req,res){
  let pfilter = req.body['filter'];
  let filter="schema.json";
  console.log(pfilter);
  const directoryPath = `../data/`;
  let file_list = [];
  await fs.readdir(directoryPath, function (err, files) {
      //handling error
      if (err) {
          return console.log('Unable to scan directory: ' + err);
      }
      files.forEach(function (file) {
          // Do whatever you want to do with the file
          if(file.includes("schema")){
            console.log(file);
            file=file.replace('-schema.json','');
            file_list.push(file);
          }
      });
      res.send(file_list);
  });
})

// file_list2 Function
// Initially built to implement "Remove" function, which is now deprecated
// Code written by: Hyun Ji Lee
app.get(`/api/v1/file_list2`, async function (req, res) {
  let pfilter = req.body["filter"];
  let filter = "data.json";
  console.log(pfilter);
  const directoryPath = `../data/`;
  let file_list = [];
  await fs.readdir(directoryPath, function (err, files) {
    //handling error
    if (err) {
      return console.log("Unable to scan directory: " + err);
    }
    files.forEach(function (file) {
      // Do whatever you want to do with the file
      if (file.includes("data")) {
        console.log(file);
        file = file.replace("-data.json", "");
        file_list.push(file);
      }
    });
    res.send(file_list);
  });
});

// This creates a Connection and stores it to a data-connection.json file in ./data/. This connection can be reconstituted later if need be
app.post('/api/v1/store_connection', async function(req,res){
   console.log(req.body);
   let proof_cred = req.body['proof_cred'];
   let give_cred = req.body['give_cred'];
   let connection = await vcxwebtools.makeConnection('QR','connection_1',req.body['phonenumber'],true);
       // create qr code
    let qrcode = qr.image(await connection.inviteDetails(true), { type: 'png' });
    res.setHeader('Content-type', 'image/png');
    res.writeHead(200, {'Content-Type': 'image/png'});
    qrcode.pipe(res);
    io.emit("connection waiting");
   // poll for accepted state of Connection Request
   let state = await connection.getState();
   let timer = 0;
   // set up loop to poll for a response or a timeout if there is no response
   while(state != 4 && state != 8 && timer < 200) {
       console.log("The State of the Connection is "+ state + " and the timer is "+timer);
       await sleep(2000);
       await connection.updateState();
       state = await connection.getState();
       timer+=1;
   }
   // check for expiration or acceptance
   if(state == 4){
       timer = 0;
       console.log("Connection Accepted!");
       io.emit('connection ready');
      // the proof template below is structured from Village Passport for testing - feel free to create your own.
      // reset global timeout
      timer = 0;
      await vcxwebtools.storeConnection(connection, connection_id);
      connection_id+=1;
      //offer Proof request for ID
      io.emit('proof requested');
      let proof_state = await vcxwebtools.requestProof(proof_cred,connection);
      console.log("Proof has processed");
      io.emit('proof processing');
      console.log(`state of y proof is ${proof_state}`);
      if (proof_state == 1){
            io.emit('proof valid');
            io.emit('credential offered');
            complete=true;
            vcxwebtools.offerCredential(give_cred,connection);
            io.emit('credential issued');
      }else{
        console.log(`Proof is Invalid`);
        io.emit('proof invalid');
        complete=true;
      }
    }else if(state == 8){
      // search for connection details in saved connections
      console.log("Connection Redirect");
    }
})

// API endpoint generates schema and credential definition based upon any named json file in ./data/cred_name-schema.json
app.post('/api/v1/build_credential', async function(req,res){
  let cred_name = req.body['build_cred'];
  io.emit('credential building');
  io.emit("credential built");
  let schema = await vcxwebtools.createSchema(cred_name);
  let credDef = await vcxwebtools.createCredentialDef(cred_name);
  let schema_ID = await schema.getSchemaId();
  let credDef_ID = await credDef.getCredDefId();
  res.setHeader('Content-type', 'application/json');
  res.send(JSON.stringify({
   "message":"completed",
   "Schema ID":schema_ID,
   "Cred ID": credDef_ID 
  }))
})

// Using JSON string from REST Request body to form the schema data, a schema will be saved to the ./data/ dir and then written to the ledger, subsequently writing a Credential Definition with the resulting Schema ID
app.post('/api/v1/make_credential', async function(req, res){
  console.log("Preparing to write schema file");
  let schema_data = req.body;
  console.log(schema_data);
  let cred_name = schema_data['data']['name'];
  // build dummy data for the credential
  let cred_data = {
    "attrs":
    {}
  };
  for(let d of schema_data['data']['attrNames']){
    cred_data['attrs'][d] = "<INSERT DATA HERE>"
  }
  console.log(cred_data);
  let proof_template = {
    "attrs": [],
    "sourceId":"999999",
    "name": "Proof",
    "revocationInterval": {}
  }
  for (let p of schema_data['data']['attrNames']){
    proof_template['attrs'].push({"name":p,"restrictions":[{"issuer_did": this_did}]});
  }
  await fs.writeJSON(`../data/${cred_name}-data.json`,cred_data);
  await fs.writeJSON(`../data/${cred_name}-schema.json`,schema_data);
  await fs.writeJSON(`../data/${cred_name}-proof-definition.json`,proof_template);
  let schema = await vcxwebtools.createSchema(cred_name);
  let credDef = await vcxwebtools.createCredentialDef(cred_name);
  let schema_ID = await schema.getSchemaId();
  let credDef_ID = await credDef.getCredDefId();
  res.setHeader('Content-type', 'application/json');
  res.end(JSON.stringify({
    "message":"completed",
    "Schema ID":schema_ID,
    "Cred ID": credDef_ID 
  })) 
})
app.post('/api/v1/make_proof', async function(req, res){
  console.log("Preparing to write schema file");
  let proof_data = req.body;
  console.log(proof_data);
  let cred_name = proof_data['name'];
  // build  data for the proof
  console.log(cred_data);
  let proof_template = {
    "attrs": [],
    "sourceId":"999999",
    "name": "Proof",
    "revocationInterval": {}
  }
  for (let p of proof_data['attrs']){
    proof_template['attrs'].push({"name":p,"restrictions":[{"issuer_did": this_did}]});
  }
  await fs.writeJSON(`../data/${cred_name}-proof-definition.json`,proof_template);
  res.setHeader('Content-type', 'application/json');
  res.end(JSON.stringify({
    "message":"completed"
  })) 
})

app.post('/api/v1/offer_credential', async function(req,res){
  console.log(req.body);
   let give_cred = req.body['give_cred'];
   let connection = await vcxwebtools.makeConnection('QR','connection_1',req.body['phonenumber'],true);
       // create qr code
    let qrcode = qr.image(await connection.inviteDetails(true), { type: 'png' });
    res.setHeader('Content-type', 'image/png');
    res.writeHead(200, {'Content-Type': 'image/png'});
    qrcode.pipe(res);
    io.emit("connection waiting");
   // poll for accepted state of Connection Request
   let state = await connection.getState();
   let timer = 0;
   // set up loop to poll for a response or a timeout if there is no response
   while(state != 4 && state != 8 && timer < 1250) {
       console.log("The State of the Connection is "+ state + " "+timer);
       await sleep(2000);
       await connection.updateState();
       state = await connection.getState();
       timer+=1;
   }
   timer=0;
   // check for expiration or acceptance
   if(state == 4){
       timer = 0;
       console.log(`Connection Accepted! Connection ID is : ${connection_id}`);
       io.emit('connection ready');
       connection_id+=1;
       await vcxwebtools.storeConnection(connection, connection_id);
       console.log(` connection ID is :  ${connection_id}`);
      // reset global timeout
      timer = 0;
      io.emit('credential offered');
      let cred = await vcxwebtools.offerCredential(give_cred,connection);
      if(cred){
        io.emit('credential issued');
        complete=true;
      }
    }else if(state == 8){//check for redirected state
      timer = 0;
      console.log("Connection Redirected!");
      await connection.updateState();
      state = await connection.getState();
      io.emit('connection ready');
      // reset global timeout
      timer = 0;
      io.emit('credential offered');
      // get the redirect details
      let redirected_details = await connection.getRedirectDetails();
      // search and return name of Connection data with matching public DID
      let redirected_connection = await vcxwebtools.searchConnectionsByTheirDid(redirected_details);
      // deserialize connection return
      console.log(redirected_connection);
      // offer cred to old connection
      if(redirected_connection != false){
        let cred = await vcxwebtools.offerCredential(give_cred,redirected_connection);
        if(cred){
          io.emit('credential issued');
        }
      }else{
        io.emit('connection not found');
      }
      complete=true;
    }
})

// API endpoint for credential exchange with a proof sent (using template name) and credential sent upon validation of requested credential
app.post('/api/v1/proof_credential', async function(req,res){
  console.log(req.body);
   let proof_cred = req.body['proof_cred'];
   let give_cred = req.body['give_cred'];
   let connection = await vcxwebtools.makeConnection('QR','connection_1',req.body['phonenumber'],true);
       // create qr code
    let qrcode = qr.image(await connection.inviteDetails(true), { type: 'png' });
    res.setHeader('Content-type', 'image/png');
    res.writeHead(200, {'Content-Type': 'image/png'});
    qrcode.pipe(res);
    io.emit("connection waiting");
   // poll for accepted state of Connection Request
   let state = await connection.getState();
   let timer = 0;
   // set up loop to poll for a response or a timeout if there is no response
   while(state != 4 && state !=8 && timer < 1250) {
       console.log("The State of the Connection is "+ state + " "+timer);
       await sleep(2000);
       await connection.updateState();
       state = await connection.getState();
       timer+=1;
   }
   // check for expiration or acceptance
   if(state == 4){
       timer = 0;
       console.log("Connection Accepted!");
       io.emit('connection ready');
       await vcxwebtools.storeConnection(connection, connection_id);
      // the proof template below is structured from Village Passport for testing - feel free to create your own.
      // reset global timeout
      timer = 0;
      //offer Proof request for ID
      io.emit('proof requested');
      let proof_state = await vcxwebtools.requestProof(proof_cred,connection);
      console.log("Proof has processed");
      io.emit('proof processing');
      console.log(`state of y proof is ${proof_state}`);
      if (proof_state == 1){
            io.emit('proof valid');
            io.emit('credential offered');
            complete=true;
            vcxwebtools.offerCredential(give_cred,connection);
            io.emit('credential issued');
      }else{
        console.log(`Proof is Invalid`);
        io.emit('proof invalid');
        complete=true;
      }
    }else if (state == 8){
      timer = 0;
      console.log("Connection Redirected!");
      await connection.updateState();
      state = await connection.getState();
      io.emit('connection ready');
      // reset global timeout
      timer = 0;
      io.emit('credential offered');
      // get the redirect details
      let redirected_details = await connection.getRedirectDetails();
      // search and return name of Connection data with matching public DID
      let redirected_connection = await vcxwebtools.searchConnectionsByTheirDid(redirected_details);
      // deserialize connection return
      console.log(redirected_connection);
      // offer cred to old connection
      if(redirected_connection != false){
        io.emit('proof requested');
        let proof_state = await vcxwebtools.requestProof(proof_cred,redirected_connection);
        console.log("Proof has processed");
        io.emit('proof processing');
        console.log(`state of y proof is ${proof_state}`);
        if (proof_state == 1){
              io.emit('proof valid');
              io.emit('credential offered');
              complete=true;
              vcxwebtools.offerCredential(give_cred,redirected_connection);
              io.emit('credential issued');
        }else{
          console.log(`Proof is Invalid`);
          io.emit('proof invalid');
          complete=true;
        }
      }else{
        io.emit('connection not found');
      }
      complete=true;
  }
})
app.post('/api/v1/validate_proof', async function(req,res){
  console.log(req.body);
   let proof_cred = req.body['proof_cred'];
   let connection = await vcxwebtools.makeConnection('QR','connection_1',req.body['phonenumber'],true);
       // create qr code
    let qrcode = qr.image(await connection.inviteDetails(true), { type: 'png' });
    res.setHeader('Content-type', 'image/png');
    res.writeHead(200, {'Content-Type': 'image/png'});
    qrcode.pipe(res);
    io.emit("connection waiting");
   // poll for accepted state of Connection Request
   let state = await connection.getState();
   let timer = 0;
   // set up loop to poll for a response or a timeout if there is no response
   while(state != 4 && state !=8 && timer < 1250) {
       console.log("The State of the Connection is "+ state + " "+timer);
       await sleep(2000);
       await connection.updateState();
       state = await connection.getState();
       timer+=1;
   }
   // check for expiration or acceptance
   if(state == 4){
       timer = 0;
       console.log("Connection Accepted!");
       io.emit('connection ready');
       await vcxwebtools.storeConnection(connection, connection_id);
      // reset global timeout
      timer = 0;
      //offer Proof request for ID
      io.emit('proof requested');
      let proof_state = await vcxwebtools.requestProof(proof_cred,connection);
      console.log("Proof has processed");
      io.emit('proof processing');
      console.log(`state of y proof is ${proof_state}`);
      if (proof_state == 1){
            io.emit('proof valid');
            complete=true;
      }else if(proof_state == 2){
        console.log(`Proof is Invalid`);
        io.emit('proof invalid');
        complete=true;
      }else if(proof_state == 3){
        console.log(`Proof is Invalid`);
        io.emit('proof orange');
        complete=true;
      }else if(proof_state == 4){
        console.log(`Proof is Expired`);
        io.emit('proof expired');
        complete=true;
      }
    }else if (state == 8){
      timer = 0;
      console.log("Connection Redirected!");
      await connection.updateState();
      state = await connection.getState();
      io.emit('connection ready');
      // reset global timeout
      timer = 0;
      // get the redirect details
      let redirected_details = await connection.getRedirectDetails();
      // search and return name of Connection data with matching public DID
      let redirected_connection = await vcxwebtools.searchConnectionsByTheirDid(redirected_details);
      // deserialize connection return
      console.log(redirected_connection);
      // offer cred to old connection
      if(redirected_connection != false){
        io.emit('proof requested');
        let proof_state = await vcxwebtools.requestProof(proof_cred,redirected_connection);
        console.log("Proof has processed");
        io.emit('proof processing');
        console.log(`state of y proof is ${proof_state}`);
        if (proof_state == 1){
              io.emit('proof valid');
              complete=true;
        }else if (proof_state==2){
          console.log(`Proof is Invalid`);
          io.emit('proof invalid');
          complete=true;
        }else if (proof_state==3){
          console.log(`Proof is orange`);
          io.emit('proof orange');
          complete=true;
        }
      }else{
        io.emit('connection not found');
      }
      complete=true;
  }
})
// sends structured question to saved connection from REST API Request 
app.post(`/api/v1/ask_question_from_saved_connection`, async function(req,res){
    console.log(req.body);
    let connection_name = req.body['connection-name'];
    let connection = await vcxwebtools.getConnection(connection_name);
    let qtext = JSON.stringify(req.body['qtext']);
    let answer = await vcxwebtools.askProvableQuestion(connection,qtext);
    io.emit("question sent");
    console.log(answer);
    io.emit('message_news',{connection:`Your message has been sent. The answer was ${answer} `}) ; 
})

// API for structured message to new Connection via QR Code
app.post('/api/v1/ask_question', async function(req,res){
    let qtext = JSON.stringify(req.body['qtext']);
    let connection = await vcxwebtools.makeConnection('QR','connection_1','blank',true);
    // create qr code
    let qrcode = qr.image(await connection.inviteDetails(true), { type: 'png' });
    res.setHeader('Content-type', 'image/png');
    res.writeHead(200, {'Content-Type': 'image/png'});
    qrcode.pipe(res);
    io.emit("connection waiting");
    // poll for accepted state of Connection Request
    let state = await connection.getState();
    let timer = 0;
    // set up loop to poll for a response or a timeout if there is no response
    while(state != 4 && state!=8 && timer < 1250) {
        console.log("The State of the Connection is "+ state + " "+timer);
        await connection.updateState();
        state = await connection.getState();
        timer+=1;
    }
    // check for expiration or acceptance
    if(state == 4){
        io.emit("connection ready");
        await vcxwebtools.storeConnection(connection, connection_id);
        let answer = await vcxwebtools.askProvableQuestion(connection,qtext);
        io.emit("question sent");
        console.log(answer);
        io.emit('message_news',{connection:`Your message has been sent. The answer was ${answer} `}) ; 
    }else if(state == 8){
      // get the redirect details
      io.emit("connection ready");
      console.log("Connection Redirected");
      let redirected_details = await connection.getRedirectDetails();
      // search and return name of Connection data with matching public DID
      let redirected_connection = await vcxwebtools.searchConnectionsByTheirDid(redirected_details);
      let answer = await vcxwebtools.askProvableQuestion(redirected_connection,qtext);
      io.emit("question sent");
      console.log(answer);
      io.emit('message_news',{connection:`Your message has been sent. The answer was ${answer} `}) ; 
    }
})

// expiration global
function ExpireAll(){
  if(complete){
      io.emit('timer expired');
      console.log('global timer expired');
  }
}

setTimeout(ExpireAll,500000);
//sleep function
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

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