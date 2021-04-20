#!/usr/bin/env node

// imports
var vcx = require("node-vcx-wrapper");
var ffi = require("ffi");
const base64url = require("base64url");
const crypto = require("crypto");
const path = require("path");
var request = require("request");
var cors = require("cors");
var qr = require("qr-image");
var fs = require("fs-extra");
var express = require("express");
var session = require("express-session");
const bodyParser = require("body-parser");
let complete = false;
// set up app express server
const PORT = 5050;
const app = express();
app.use(session({ secret: "Secret Key" }));
app.use(bodyParser.urlencoded({ extended: false }));
const server = require("http").Server(app);
const io = require("socket.io")(server, { path: `/api/socket.io` });
var this_did;
var connection_id = 0;
//vcx imports
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
  rustAPI,
} = vcx;

// global vars
let config = "../config/vcx-config.json";
async function getConfigData() {
  configData = await fs.readJSON("../config/vcx-config.json");
  // let this_did = config['institution_did'];
  return configData;
}

// sockets.io listen
io.on("connection", (socket) => {
  socket.on("disconnect", () => {});
  socket.on("message", function (data) {
    console.log(data);
  });
});

// express server listen
server.listen(PORT, async function () {
  let config = await getConfigData();
  this_did = config["institution_did"];
  console.log(`VCX Server DID ${this_did} is Listening on Port ${PORT}`);
});

// app settings for json, url, cors, and a public folder for shared use
app.use(express.json());

// express use url encoded for post messages
app.use(express.urlencoded());

// express set up Cross Origin
app.use(cors());

// Receive a list of files from the server data directory
app.get(`/api/v1/file_list`, async function (req, res) {
  let pfilter = req.body["filter"];
  let filter = "schema.json";
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
      if (file.includes("schema")) {
        console.log(file);
        file = file.replace("-schema.json", "");
        file_list.push(file);
      }
    });
    res.send(file_list);
  });
});

// This creates a Connection and stores it to a data-connection.json file in ./data/. This connection can be reconstituted later if need be
app.post("/api/v1/store_connection", async function (req, res) {
  console.log(req.body);
  let proof_cred = req.body["proof_cred"];
  let give_cred = req.body["give_cred"];

  let connection = await makeConnection(
    "QR",
    "connection_1",
    req.body["phonenumber"],
    true
  );
  // create qr code
  let qrcode = qr.image(await connection.inviteDetails(true), { type: "png" });
  res.setHeader("Content-type", "image/png");
  res.writeHead(200, { "Content-Type": "image/png" });
  qrcode.pipe(res);
  io.emit("connection waiting");
  // poll for accepted state of Connection Request
  let state = await connection.getState();
  let timer = 0;
  // set up loop to poll for a response or a timeout if there is no response
  while (state != 4 && state != 8 && timer < 200) {
    console.log(
      "The State of the Connection is " + state + " and the timer is " + timer
    );
    await sleep(2000);
    await connection.updateState();
    state = await connection.getState();
    timer += 1;
  }
  // check for expiration or acceptance
  if (state == 4) {
    timer = 0;
    console.log("Connection Accepted!");
    io.emit("connection ready");
    // the proof template below is structured from Village Passport for testing - feel free to create your own.
    // reset global timeout
    timer = 0;
    await storeConnection(connection, connection_id);
    connection_id += 1;
    //offer Proof request for ID
    io.emit("proof requested");
    let proof_state = await requestProof(proof_cred, connection);
    console.log("Proof has processed");
    io.emit("proof processing");
    console.log(`state of y proof is ${proof_state}`);
    if (proof_state == 1) {
      io.emit("proof valid");
      io.emit("credential offered");
      complete = true;
      offerCredential(give_cred, connection);
      io.emit("credential issued");
    } else {
      console.log(`Proof is Invalid`);
      io.emit("proof invalid");
      complete = true;
    }
  } else if (state == 8) {
    // search for connection details in saved connections
    console.log("Connection Redirect");
  }
});

// API endpoint generates schema and credential definition based upon any named json file in ./data/cred_name-schema.json
app.post("/api/v1/build_credential", async function (req, res) {
  let cred_name = req.body["build_cred"];
  io.emit("credential building");
  io.emit("credential built");
  let schema = await createSchema(cred_name);
  let credDef = await createCredentialDef(cred_name);
  let schema_ID = await schema.getSchemaId();
  let credDef_ID = await credDef.getCredDefId();
  res.setHeader("Content-type", "application/json");
  res.send(
    JSON.stringify({
      message: "completed",
      "Schema ID": schema_ID,
      "Cred ID": credDef_ID,
    })
  );
});

// Using JSON string from REST Request body to form the schema data, a schema will be saved to the ./data/ dir and then written to the ledger, subsequently writing a Credential Definition with the resulting Schema ID
app.post("/api/v1/make_credential", async function (req, res) {
  console.log("Preparing to write schema file");
  let schema_data = req.body;
  console.log(schema_data);
  let cred_name = schema_data["data"]["name"];
  // build dummy data for the credential
  let cred_data = {
    attrs: {},
  };
  for (let d of schema_data["data"]["attrNames"]) {
    cred_data["attrs"][d] = "<INSERT DATA HERE>";
  }
  console.log(cred_data);
  let proof_template = {
    attrs: [],
    sourceId: "999999",
    name: "Proof",
    revocationInterval: {},
  };
  for (let p of schema_data["data"]["attrNames"]) {
    proof_template["attrs"].push({
      name: p,
      restrictions: [{ issuer_did: this_did }],
    });
  }
  await fs.writeJSON(`../data/${cred_name}-data.json`, cred_data);
  await fs.writeJSON(`../data/${cred_name}-schema.json`, schema_data);
  await fs.writeJSON(
    `../data/${cred_name}-proof-definition.json`,
    proof_template
  );
  let schema = await createSchema(cred_name);
  let credDef = await createCredentialDef(cred_name);
  let schema_ID = await schema.getSchemaId();
  let credDef_ID = await credDef.getCredDefId();
  res.setHeader("Content-type", "application/json");
  res.end(
    JSON.stringify({
      message: "completed",
      "Schema ID": schema_ID,
      "Cred ID": credDef_ID,
    })
  );
});
app.post("/api/v1/make_proof", async function (req, res) {
  console.log("Preparing to write schema file");
  let proof_data = req.body;
  console.log(proof_data);
  let cred_name = proof_data["name"];
  // build  data for the proof
  console.log(cred_data);
  let proof_template = {
    attrs: [],
    sourceId: "999999",
    name: "Proof",
    revocationInterval: {},
  };
  for (let p of proof_data["attrs"]) {
    proof_template["attrs"].push({
      name: p,
      restrictions: [{ issuer_did: this_did }],
    });
  }
  await fs.writeJSON(
    `../data/${cred_name}-proof-definition.json`,
    proof_template
  );
  res.setHeader("Content-type", "application/json");
  res.end(
    JSON.stringify({
      message: "completed",
    })
  );
});
app.post("/api/v1/offer_credential", async function (req, res) {
  console.log(req.body);
  let give_cred = req.body["give_cred"];
  let connection = await makeConnection(
    "QR",
    "connection_1",
    req.body["phonenumber"],
    true
  );
  // create qr code
  let qrcode = qr.image(await connection.inviteDetails(true), { type: "png" });
  res.setHeader("Content-type", "image/png");
  res.writeHead(200, { "Content-Type": "image/png" });
  qrcode.pipe(res);
  io.emit("connection waiting");
  // poll for accepted state of Connection Request
  let state = await connection.getState();
  let timer = 0;
  // set up loop to poll for a response or a timeout if there is no response
  while (state != 4 && state != 8 && timer < 1250) {
    console.log("The State of the Connection is " + state + " " + timer);
    await sleep(2000);
    await connection.updateState();
    state = await connection.getState();
    timer += 1;
  }
  timer = 0;
  // check for expiration or acceptance
  if (state == 4) {
    timer = 0;
    console.log(`Connection Accepted! Connection ID is : ${connection_id}`);
    io.emit("connection ready");
    connection_id += 1;
    await storeConnection(connection, connection_id);
    console.log(` connection ID is :  ${connection_id}`);
    // reset global timeout
    timer = 0;
    io.emit("credential offered");
    let offer = await offerCredential(give_cred, connection);
    if (offer === true) {
      io.emit("credential issued");
    }
  } else if (state == 8) {
    //check for redirected state
    timer = 0;
    console.log("Connection Redirected!");
    await connection.updateState();
    state = await connection.getState();
    io.emit("connection ready");
    // reset global timeout
    timer = 0;
    io.emit("credential offered");
    // get the redirect details
    let redirected_details = await connection.getRedirectDetails();
    // search and return name of Connection data with matching public DID
    let redirected_connection = await searchConnectionsByTheirDid(
      redirected_details
    );
    // deserialize connection return
    console.log(redirected_connection);
    // offer cred to old connection
    if (redirected_connection != false) {
      offerCredential(give_cred, redirected_connection);
      io.emit("credential issued");
    } else {
      io.emit("connection not found");
    }
    complete = true;
  }
});

// API endpoint for credential exchange with a proof sent (using template name) and credential sent upon validation of requested credential
app.post("/api/v1/proof_credential", async function (req, res) {
  console.log(req.body);
  let proof_cred = req.body["proof_cred"];
  let give_cred = req.body["give_cred"];
  let connection = await makeConnection(
    "QR",
    "connection_1",
    req.body["phonenumber"],
    true
  );
  // create qr code
  let qrcode = qr.image(await connection.inviteDetails(true), { type: "png" });
  res.setHeader("Content-type", "image/png");
  res.writeHead(200, { "Content-Type": "image/png" });
  qrcode.pipe(res);
  io.emit("connection waiting");
  // poll for accepted state of Connection Request
  let state = await connection.getState();
  let timer = 0;
  // set up loop to poll for a response or a timeout if there is no response
  while (state != 4 && state != 8 && timer < 1250) {
    console.log("The State of the Connection is " + state + " " + timer);
    await sleep(2000);
    await connection.updateState();
    state = await connection.getState();
    timer += 1;
  }
  // check for expiration or acceptance
  if (state == 4) {
    timer = 0;
    console.log("Connection Accepted!");
    io.emit("connection ready");
    await storeConnection(connection, connection_id);
    // the proof template below is structured from Village Passport for testing - feel free to create your own.
    // reset global timeout
    timer = 0;
    //offer Proof request for ID
    io.emit("proof requested");
    let proof_state = await requestProof(proof_cred, connection);
    console.log("Proof has processed");
    io.emit("proof processing");
    console.log(`state of y proof is ${proof_state}`);
    if (proof_state == 1) {
      io.emit("proof valid");
      io.emit("credential offered");
      complete = true;
      offerCredential(give_cred, connection);
      io.emit("credential issued");
    } else {
      console.log(`Proof is Invalid`);
      io.emit("proof invalid");
      complete = true;
    }
  } else if (state == 8) {
    timer = 0;
    console.log("Connection Redirected!");
    await connection.updateState();
    state = await connection.getState();
    io.emit("connection ready");
    // reset global timeout
    timer = 0;
    io.emit("credential offered");
    // get the redirect details
    let redirected_details = await connection.getRedirectDetails();
    // search and return name of Connection data with matching public DID
    let redirected_connection = await searchConnectionsByTheirDid(
      redirected_details
    );
    // deserialize connection return
    console.log(redirected_connection);
    // offer cred to old connection
    if (redirected_connection != false) {
      io.emit("proof requested");
      let proof_state = await requestProof(proof_cred, redirected_connection);
      console.log("Proof has processed");
      io.emit("proof processing");
      console.log(`state of y proof is ${proof_state}`);
      if (proof_state == 1) {
        io.emit("proof valid");
        io.emit("credential offered");
        complete = true;
        offerCredential(give_cred, redirected_connection);
        io.emit("credential issued");
      } else {
        console.log(`Proof is Invalid`);
        io.emit("proof invalid");
        complete = true;
      }
    } else {
      io.emit("connection not found");
    }
    complete = true;
  }
});
app.post("/api/v1/validate_proof", async function (req, res) {
  console.log(req.body);
  let proof_cred = req.body["proof_cred"];
  let connection = await makeConnection(
    "QR",
    "connection_1",
    req.body["phonenumber"],
    true
  );
  // create qr code
  let qrcode = qr.image(await connection.inviteDetails(true), { type: "png" });
  res.setHeader("Content-type", "image/png");
  res.writeHead(200, { "Content-Type": "image/png" });
  qrcode.pipe(res);
  io.emit("connection waiting");
  // poll for accepted state of Connection Request
  let state = await connection.getState();
  let timer = 0;
  // set up loop to poll for a response or a timeout if there is no response
  while (state != 4 && state != 8 && timer < 1250) {
    console.log("The State of the Connection is " + state + " " + timer);
    await sleep(2000);
    await connection.updateState();
    state = await connection.getState();
    timer += 1;
  }
  // check for expiration or acceptance
  if (state == 4) {
    timer = 0;
    console.log("Connection Accepted!");
    io.emit("connection ready");
    await storeConnection(connection, connection_id);
    // the proof template below is structured from Village Passport for testing - feel free to create your own.
    // reset global timeout
    timer = 0;
    //offer Proof request for ID
    io.emit("proof requested");
    let proof_state = await requestProof(proof_cred, connection);
    console.log("Proof has processed");
    io.emit("proof processing");
    console.log(`state of y proof is ${proof_state}`);
    if (proof_state == 1) {
      io.emit("proof valid");
      complete = true;
    } else {
      console.log(`Proof is Invalid`);
      io.emit("proof invalid");
      complete = true;
    }
  } else if (state == 8) {
    timer = 0;
    console.log("Connection Redirected!");
    await connection.updateState();
    state = await connection.getState();
    io.emit("connection ready");
    // reset global timeout
    timer = 0;
    // get the redirect details
    let redirected_details = await connection.getRedirectDetails();
    // search and return name of Connection data with matching public DID
    let redirected_connection = await searchConnectionsByTheirDid(
      redirected_details
    );
    // deserialize connection return
    console.log(redirected_connection);
    // offer cred to old connection
    if (redirected_connection != false) {
      io.emit("proof requested");
      let proof_state = await requestProof(proof_cred, redirected_connection);
      console.log("Proof has processed");
      io.emit("proof processing");
      console.log(`state of y proof is ${proof_state}`);
      if (proof_state == 1) {
        io.emit("proof valid");
        complete = true;
      } else {
        console.log(`Proof is Invalid`);
        io.emit("proof invalid");
        complete = true;
      }
    } else {
      io.emit("connection not found");
    }
    complete = true;
  }
});
// sends structured question to saved connection from REST API Request
app.post(`/api/v1/ask_question_from_saved_connection`, async function (
  req,
  res
) {
  console.log(req.body);
  let connection_name = req.body["connection-name"];
  let connection = await getConnection(connection_name);
  let qtext = JSON.stringify(req.body["qtext"]);
  let answer = await askProvableQuestion(connection, qtext);
  io.emit("question sent");
  console.log(answer);
  io.emit("message_news", {
    connection: `Your message has been sent. The answer was ${answer} `,
  });
});

// API for structured message to new Connection via QR Code
app.post("/api/v1/ask_question", async function (req, res) {
  let qtext = JSON.stringify(req.body["qtext"]);
  let connection = await makeConnection("QR", "connection_1", "blank", true);
  // create qr code
  let qrcode = qr.image(await connection.inviteDetails(true), { type: "png" });
  res.setHeader("Content-type", "image/png");
  res.writeHead(200, { "Content-Type": "image/png" });
  qrcode.pipe(res);
  io.emit("connection waiting");
  // poll for accepted state of Connection Request
  let state = await connection.getState();
  let timer = 0;
  // set up loop to poll for a response or a timeout if there is no response
  while (state != 4 && state != 8 && timer < 1250) {
    console.log("The State of the Connection is " + state + " " + timer);
    await connection.updateState();
    state = await connection.getState();
    timer += 1;
  }
  // check for expiration or acceptance
  if (state == 4) {
    io.emit("connection ready");
    await storeConnection(connection, connection_id);
    let answer = await askProvableQuestion(connection, qtext);
    io.emit("question sent");
    console.log(answer);
    io.emit("message_news", {
      connection: `Your message has been sent. The answer was ${answer} `,
    });
  } else if (state == 8) {
    // get the redirect details
    io.emit("connection ready");
    console.log("Connection Redirected");
    let redirected_details = await connection.getRedirectDetails();
    // search and return name of Connection data with matching public DID
    let redirected_connection = await searchConnectionsByTheirDid(
      redirected_details
    );
    let answer = await askProvableQuestion(redirected_connection, qtext);
    io.emit("question sent");
    console.log(answer);
    io.emit("message_news", {
      connection: `Your message has been sent. The answer was ${answer} `,
    });
  }
});

// Enterprise API endpoints (included from vcx-enterprise-server.js)

// Enterprise issue proof request
app.post(`/api/v1/enterprise/issue_proof_request`, async function (req, res) {
  // receive body of request
  console.log(req.body);
  let cred_name = req.body["credential"];
  let endpoint = req.body["endpoint"];
  // make connection
  let connection = await makeConnection("QR", "enterprise_connection", "000");
  let details = await connection.inviteDetails(true);
  // send connection request to endpoint via request
  request.post(
    {
      // headers
      headers: { "content-type": "application/json" },
      // REST API endpoint
      url: `${endpoint}/api/v1/enterprise/receive_proof_request`,
      // JSON body data
      body: details,
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
  while (state != 4) {
    console.log("The State of the Connection is " + state);
    await connection.updateState();
    state = await connection.getState();
  }
  // issue proof request to enterprise
  let proof_state = await offerProof(cred_name, connection);
  io.emit("proof requested");
  console.log("Proof has processed");
  io.emit("proof processing");
  console.log(`state of y proof is ${proof_state}`);
  if (proof_state == 1) {
    io.emit(`${cred_name} valid`);
    io.emit("proof valid");
  } else {
    console.log(`Proof is invalid`);
    io.emit(`${cred_name} invalid`);
    io.emit("proof invalid");
  }
});

// Enterprise Receive Proof Request
app.post(`/api/v1/enterprise/receive_proof_request`, async function (req, res) {
  let inviteDetails = JSON.stringify(req.body);
  let nm = req.body["s"]["n"];
  io.emit("recipient_news", {
    connection: `${nm} has requested a Connection with you`,
  });
  // Accept invitation
  let connection = await Connection.createWithInvite({
    id: "1",
    invite: inviteDetails,
  });
  await connection.connect({ id: "1" });
  console.log("Connection Invite Accepted");
  await connection.updateState();
  let state = await connection.getState();
  console.log("State is :::");
  console.log(state);
  while (state != StateType.Accepted) {
    sleep(5000);
    await connection.updateState();
    state = await connection.getState();
    console.log("State is :::");
    console.log(state);
  }

  let ser_connection = await connection.serialize();
  console.log(ser_connection);
  io.emit("recipient_news", {
    connection: `Public DID : ${ser_connection["data"]["their_public_did"]} has Connected with you`,
  });
  io.emit("recipient_news", { connection: `${nm} has Requested a Proof : ` });

  let requests = await DisclosedProof.getRequests(connection);
  while (requests.length == 0) {
    // sleep(5000);
    requests = await DisclosedProof.getRequests(connection);
    io.emit("news", { connection: "Waiting on Proof Requests" });
    console.log("Waiting on Requests");
  }
  io.emit("recipient_news", { connection: "Request Made" });
  io.emit("recipient_news", { connection: JSON.stringify(requests[0]) });
  console.log("Creating a Disclosed proof object from proof request");
  io.emit("recipient_news", {
    connection: "Creating a Disclosed proof object from proof request",
  });
  let proof = await DisclosedProof.create({
    sourceId: "proof",
    request: JSON.stringify(requests[0]),
  });
  console.log(await proof.serialize());
  console.log(
    "Query for credentials in the wallet that satisfy the proof request"
  );
  let credentials = await proof.getCredentials();
  console.log(credentials);
  var self_attested;
  for (let attr in credentials["attrs"]) {
    credentials["attrs"][attr] = { credential: credentials["attrs"][attr][0] };
    console.log(attr);
    self_attested = attr;
  }
  // if the proof request matches the credential
  let cred_x = JSON.stringify(credentials["attrs"][self_attested]);
  console.log(`LENGTH OF CREDS IS ${cred_x}`);
  console.log(credentials["attrs"]);
  // { 'Supplier CID': { credential: undefined } }
  console.log("Generate the proof");

  if (cred_x != "{}") {
    console.log("The credential exists");
    await proof.generateProof({
      selectedCreds: credentials,
      selfAttestedAttrs: {},
    });
  } else {
    console.log("Credential does not exist");
    io.emit("recipient_news", {
      connection: "You did not possess this Credential",
    });
    credentials = { self_attested: { credential: "undefined" } };
    await proof.generateProof({
      selectedCreds: credentials,
      selfAttestedAttrs: {},
    });
  }
  let s_proof = await proof.serialize();
  console.log(s_proof);
  console.log("Send the proof to agent");
  await proof.sendProof(connection);
  await proof.updateState();
  let pstate = await proof.getState();
  while (pstate !== 4) {
    sleep(2000);
    console.log(`proof should have been sent  the State is : ${pstate}`);
    await proof.updateState();
    pstate = proof.getState();
  }
  console.log(`Proof sent!!`);
  io.emit("recipient_news", { connection: "Proof has been sent" });
});

// Enterprise Offer Credentials

app.post(`/api/v1/enterprise/offer_credentials`, async function (req, res) {
  console.log(req.body);
  let cred_name = req.body["credential"];
  let endpoint = req.body["endpoint"];
  let connection = await makeConnection("QR", "enterprise_connection", "000");
  let details = await connection.inviteDetails(true);
  // send connection request to endpoint via request
  request.post(
    {
      // headers
      headers: { "content-type": "application/json" },
      // REST API endpoint
      url: `${endpoint}/api/v1/enterprise/receive_credentials`,
      // JSON body data
      body: details,
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
  while (state != StateType.Accepted) {
    console.log("The State of the Connection is " + state);
    await connection.updateState();
    state = await connection.getState();
  }
  offerCredential(cred_name, connection);
});

// Enterprise Receive Credentials

app.post(`/api/v1/enterprise/receive_credentials`, async function (req, res) {
  //get details
  console.log("ACCEPTING REQUEST...");
  let inviter = req.body["s"]["n"];
  let inviteDetails = JSON.stringify(req.body);
  console.log(inviteDetails);
  //io.emit('recipient_news',{connection:`Connection Requested has been sent by ${inviter}`});

  let connection = await connectWithInvitation("1", inviteDetails);
  // build connection
  await connection.connect({ id: "1" });
  console.log("Connection Invite Accepted");
  await connection.updateState();
  let state = await connection.getState();
  while (state != StateType.Accepted) {
    await connection.updateState();
    state = await connection.getState();
    console.log("State is :::");
    console.log(state);
  }
  io.emit("recipient_news", {
    connection: `Credential offers from ${inviter} are :`,
  });

  let offers = await Credential.getOffers(connection);
  while (offers.length < 1) {
    offers = await Credential.getOffers(connection);
    console.log("Credential Offers Below:");
    console.log(JSON.stringify(offers[0]));
    io.emit("recipient_news", { connection: JSON.stringify(offers[0]) });
  }
  let credential = await Credential.create({
    sourceId: "enterprise",
    offer: JSON.stringify(offers[0]),
    connection: connection,
  });
  await credential.sendRequest({ connection: connection, payment: 0 });
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
});

// formerly "vcx-web-tools", now included in Verity Server 1.0 code

// load up libsovtoken
async function run() {
  const myffi = ffi.Library("/usr/lib/libsovtoken.so", {
    sovtoken_init: ["void", []],
  });
  await myffi.sovtoken_init();
  await vcx.initVcx(config);
}
run();

async function pollConnection(connection) {
  let state = await connection.getState();
  let timer = 0;
  // set up loop to poll for a response or a timeout if there is no response
  while (state != 4 && state != 8 && timer < 200) {
    console.log(
      "The State of the Connection is " + state + " and the timer is " + timer
    );
    await sleep(2000);
    await connection.updateState();
    state = await connection.getState();
    timer += 1;
  }
  // check for expiration or acceptance
  if (state == 4) {
    timer = 0;
    console.log("Connection Accepted!");
    io.emit("connection ready");
    timer = 0;
    //swap with DB call here
    await storeConnection(connection, connection_id);
    connection_id += 1;
    //offer Proof request for ID
    io.emit("proof requested");
    let proof_state = await requestProof(proof_cred, connection);
    console.log("Proof has processed");
    io.emit("proof processing");
    console.log(`state of y proof is ${proof_state}`);
    if (proof_state == 1) {
      io.emit("proof valid");
      io.emit("credential offered");
      complete = true;
      offerCredential(give_cred, connection);
      io.emit("credential issued");
    } else {
      console.log(`Proof is Invalid`);
      io.emit("proof invalid");
      complete = true;
    }
  } else if (state == 8) {
    console.log("Connection Redirect");
    timer = 0;
    console.log("Connection Redirected!");
    await connection.updateState();
    state = await connection.getState();
    io.emit("connection ready");
    // reset global timeout
    timer = 0;
    let redirected_details = await connection.getRedirectDetails();
    let redirected_connection = await searchConnectionsByTheirDid(
      redirected_details
    );
    complete = true;
    return 8;
  }
}
async function connectWithInvitation(details) {
  let connection = await Connection.createWithInvite({
    id: "1",
    invite: details,
  });
  return connection;
}
async function serializedConnection(connection) {
  let result = await Connection.serialize(connection);
  return result;
}
async function makeConnection(type, name, phonenumber, public) {
  let connectionData = {};
  let connectionArgs = {};
  let connection = await Connection.create({ id: name });
  connectionData = {
    id: name,
    connection_type: "QR",
    use_public_did: public,
  };
  connectionArgs = { data: JSON.stringify(connectionData) };
  await connection.connect(connectionArgs);
  return connection;
}
async function getConnection(name) {
  let connection_serialized = await fs.readJSON(
    `../data/${name}-connection.json`
  );
  let connection = await Connection.deserialize(connection_serialized);
  return connection;
}
async function storeConnection(connection, name) {
  let serialized_connection = await connection.serialize();
  let n = 0;
  let file_list = readFilesSync("../data/");
  for (let f of file_list) {
    if (f.name.includes("connection")) {
      n += 1;
    }
  }
  await fs.writeJSON(`../data/${n + 1}-connection.json`, serialized_connection);
  return serialized_connection;
}

async function searchConnectionsByTheirDid(redirected_connection) {
  // search connection data for connection DID
  console.log(`redirect is : ${redirected_connection}`);
  let info = JSON.parse(redirected_connection);
  let did = info["theirDID"];
  console.log(`redirect DID is : ${did}`);
  const directoryPath = `../data/`;
  let file_list = readFilesSync(directoryPath);
  for (let f of file_list) {
    if (f.name.includes("connection")) {
      console.log(`file is ${f.name}`);
      let cFile = await fs.readJSON(`../data/${f.name}${f.ext}`);
      console.log(cFile);
      if (cFile["data"]["their_pw_did"] == did) {
        console.log(
          `redirected did:  ${did} is equal to existing did: ${cFile["data"]["their_pw_did"]}`
        );
        connection_file_name = f;
        console.log(f.name + f.ext);
        let redirected_connection = await getConnection(
          f.name.replace("-connection", "")
        );
        return redirected_connection;
      }
    }
  }
  return false;
}
async function askProvableQuestion(connection, qtext) {
  if (connection == null) {
    console.log(
      "Connection Was Not Found in Records. Please Delete Your Connection and Try Again."
    );
  } else {
    console.log(connection);
  }
  let serialized_connection = await connection.serialize();
  const pairwiseDid = serialized_connection.data.pw_did;
  const expiration = getExpirationDate({ seconds: 60 });
  const question = {
    "@type": "did:sov:BzCbsNYhMrjHiqZDTUASHg;spec/committedanswer/1.0/question",
    "@id": "518be002-de8e-456e-b3d5-8fe472477a86",
    question_text: "Validated Question",
    question_detail: qtext,
    valid_responses: [
      { text: "Confirm", nonce: "CONFIRMED" },
      { text: "Decline", nonce: "DECLINED" },
    ],
    "@timing": {
      expires_time: expiration,
    },
  };
  await connection.sendMessage({
    msg: JSON.stringify(question),
    type: "Question",
    title: "Asking login question",
  });
  let answer;
  while (!isExpired(expiration)) {
    let messages = await vcx.downloadMessages({
      status: "MS-103",
      pairwiseDids: pairwiseDid,
    });
    messages = JSON.parse(messages);
    for (const message of messages[0]["msgs"]) {
      if (message.type === "Answer") {
        if (answer) {
          console.log('More then one "Answer" message');
        } else {
          // console.log(JSON.parse(message))
          answer = JSON.parse(JSON.parse(message["decryptedPayload"])["@msg"]);
        }
        await vcx.updateMessages({
          msgJson: JSON.stringify([
            { pairwiseDID: pairwiseDid, uids: [message.uid] },
          ]),
        });
      }
    }
    if (answer) {
      break;
    }
  }
  if (isExpired(expiration)) {
    console.log("expired");
    throw Error("Timeout");
  } else {
    console.log(answer);
    const signature = Buffer.from(
      answer["response.@sig"]["signature"],
      "base64"
    );
    const data = answer["response.@sig"]["sig_data"];
    console.log("validating signature");
    const valid = await connection.verifySignature({
      data: Buffer.from(data),
      signature,
    });
    if (valid) {
      console.log("Signature is valid!");
      return base64decode(data);
    } else {
      console.log("Signature validation failed");
      return false;
    }
  }
}

async function createSchema(schema_name) {
  let schema_data = await fs.readJson(`../data/${schema_name}-schema.json`);
  //set up incremental version float in order to avoid schema version conflicts
  let currentVersion = parseFloat(schema_data.data.version);
  newVersion = currentVersion + 0.01;
  schema_data.data.version = String(newVersion.toFixed(2));
  console.log(schema_data);
  let schema = await Schema.create(schema_data);
  //retrieve schema ID on Ledger
  let schemaId = await schema.getSchemaId();
  //write the Ledger ID to the schema json file for future use
  schema_data["schemaId"] = schemaId;
  await fs.writeJson(`../data/${schema_name}-schema.json`, schema_data);
  console.log(
    `Congratulations! Your schema was written to the Ledger and the id is : ${schemaId}`
  );
  return schema;
}

async function createCredentialDef(schema_name) {
  let schema_data = await fs.readJson(`../data/${schema_name}-schema.json`);
  console.log(schema_data.schemaId);
  console.log("creating credential definition");
  const data = {
    name: schema_name,
    paymentHandle: 0,
    revocation: false,
    revocationDetails: {
      tailsFile: "tails.txt",
    },
    schemaId: schema_data.schemaId,
    sourceId: schema_data.sourceId,
  };
  let credentialDef = await CredentialDef.create(data);
  // let credentialDef = await CredentialDef.create({"name":schema_data.name,"paymentHandle": 0,"revocation":false,"schemaId":schema_data.schemaId,"sourceId":"55555"});
  let ser_CredDef = await credentialDef.serialize();
  console.log(ser_CredDef);
  let credDefId = await credentialDef.getCredDefId();
  await fs.writeJson(
    `../data/${schema_name}-credential-definition.json`,
    ser_CredDef
  );
  console.log(
    `Congratulations! Your Credential Definition was written to the Ledger and the id is : ${credDefId}`
  );
  return credentialDef;
}
async function offerCredential(credential_name, connection) {
  let credential_definition = await fs.readJson(
    `../data/${credential_name}-credential-definition.json`
  );
  let credential_data = await fs.readJson(
    `../data/${credential_name}-data.json`
  );
  var cred_def_deserialized = await CredentialDef.deserialize(
    credential_definition
  );
  // get credential definition handle
  cred_def_handle = await cred_def_deserialized.handle;
  console.log(`handle is _ ${cred_def_handle}`);
  let credential = await IssuerCredential.create({
    sourceId: "1",
    credDefHandle: cred_def_handle,
    attr: credential_data.attrs,
    credentialName: credential_name,
    price: "0",
  });
  console.log(
    `Successfully created A Credential, now offering it to connection...`
  );
  await credential.sendOffer(connection);
  await credential.updateState();
  let state = await credential.getState();
  let timer = 0;
  while (state != 3 && timer < 120) {
    await sleep(2000);
    console.log("Offer Sent, The State of the Credential Offer is " + state);
    await credential.updateState();
    state = await credential.getState();
  }
  if (state == 3) {
    await credential.sendCredential(connection);
    console.log("Credential sent");
    timer = 0;
  } else {
    console.log("Credential offer ignored or timed out");
    timer = 0;
    return false;
  }
  while (state != StateType.Accepted && timer < 200) {
    console.log(
      "Credential Sent, The State of the Credential is " +
        state +
        "timer " +
        timer
    );
    await sleep(2000);
    await credential.updateState();
    state = await credential.getState();
    timer += 1;
  }
  timer = 0;
  console.log(
    `Congratulations! Your Credential was offered and accepted by the Connection`
  );
  return true;
}
async function requestProof(proof_name, connection) {
  let proof_data = await fs.readJson(
    `../data/${proof_name}-proof-definition.json`
  );
  await connection.updateState();
  await connection.serialize();
  console.log(proof_data);
  let proof = await Proof.create(proof_data);
  await proof.requestProof(connection);
  await proof.updateState();
  state = await proof.getState();
  let timer = 0;
  while (state != StateType.RequestReceived && timer < 2000) {
    console.log(`The state of the proof is ${state} and the timer is ${timer}`);
    await sleep(2000);
    await proof.updateState();
    state = await proof.getState();
    timer += 1;
    if (state == StateType.Accepted) {
      var proof_return = await proof.getProof(connection);
      console.log(`The get proof state is ${proof_return}`);
      break;
    }
  }
  await proof.updateState();
  state = await proof.getState();
  var proof_return = await proof.getProof(connection);
  var proof_state = await proof_return.proofState;
  console.log(proof_state);
  timer = 0;
  if (proof_state == 1) {
    console.log(
      `Congratulations! You have Issued a Proof request to a Connection and validated it.`
    );
    // insert libindy proof check for self-attested claims here
    let pdata = await proof.serialize();
    console.log("Checking for self-attested claims");
    // Manual validation "for-reals" check
    let libindyproof = pdata["data"]["proof"]["libindy_proof"];
    console.log("libindy saved Proof is: ");
    console.log(libindyproof);
    let json_lbp = JSON.parse(libindyproof);
    let self_attested_attrs =
      json_lbp["requested_proof"]["self_attested_attrs"];
    console.log(self_attested_attrs);
    console.log(
      "self attested truths length: " + Object.keys(self_attested_attrs).length
    );
    if (Object.keys(self_attested_attrs).length > 0) {
      console.log("Proof is NOT Valid or contains self-attested values");
      proof_state = 2;
      return proof_state;
    }
    return proof_state;
  } else {
    console.log(
      `You issued a Proof request to a Connection but it was not valid. Try again`
    );
    proof_state = 2;
    return proof_state;
  }
}

function verifyClaims(the_proof, proof_template) {
  // determine which claims should have restrictions applied
  let restricted = [];
  let proof_obj = JSON.parse(the_proof["proof"]);
  for (attribute in proof_template) {
    if ("restrictions" in proof_template[attribute]) {
      restricted.push(proof_template[attribute]["name"]);
    }
    let verified = true;
    for (let claim in restricted) {
      if (
        !(restricted[claim] in proof_obj["requested_proof"]["revealed_attrs"])
      ) {
        verified = false;
        console.log(
          "Attribute " + restricted[claim] + " has unmet restrictions."
        );
      }
    }
    return verified;
  }
}

// reads all files in a dir synchronously
function readFilesSync(dir) {
  const files = [];
  fs.readdirSync(dir).forEach((filename) => {
    const name = path.parse(filename).name;
    const ext = path.parse(filename).ext;
    const filepath = path.resolve(dir, filename);
    const stat = fs.statSync(filepath);
    const isFile = stat.isFile();
    if (isFile) files.push({ filepath, name, ext, stat });
  });
  files.sort((a, b) => {
    return a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
  return files;
}

// Enterprise or Cloud Wallet VCX Functions

let receiveConnection = async function (id, invite_details) {
  let requestedConnection = await Connection.createWithInvite({
    id: id,
    invite: invite_details,
  });
  await requestedConnection.connect({ id: "req_connection" });
  let connectionState = await requestedConnection.getState();
  while (connectionState !== StateType.Accepted) {
    await sleep(2000);
    await requestedConnection.updateState();
    connectionState = await requestedConnection.getState();
  }
  return requestedConnection;
};

let receiveCredential = async function (connection) {
  let offers = await Credential.getOffers(connection);
  let credential = await Credential.create({
    sourceId: "received_credential",
    offer: JSON.stringify(offers[0]),
    connection: connection,
  });
  await credential.sendRequest({ connection: connection, payment: "0" });
  let credentialState = await credential.getState();
  while (credentialState !== StateType.Accepted) {
    await credential.updateState();
    credentialState = await credential.getState();
    await sleep(2000);
  }
  return credential;
};

let receiveProofs = async function (connection) {
  let requests = await DisclosedProof.getRequests(connection);
  let proof = await DisclosedProof.create({
    sourceId: "proof",
    request: JSON.stringify(requests[0]),
  });
  let credentials = await proof.getCredentials();
  for (var attr in credentials["attrs"]) {
    credentials["attrs"][attr] = { credential: credentials["attrs"][attr][0] };
  }
  await proof.generateProof({
    selectedCreds: credentials,
    selfAttestedAttrs: {},
  });
  await proof.sendProof(connection);
  return proof;
};

// helper functions for structured messaging
function getToken(size) {
  return base64url(crypto.randomBytes(size));
}
function getExpirationDate(config = {}) {
  let expiration = new Date();
  if (config.hours) {
    expiration = new Date(
      expiration.setHours(expiration.getHours() + config.hours)
    );
  }
  if (config.minutes) {
    expiration = new Date(
      expiration.setMinutes(expiration.getMinutes() + config.minutes)
    );
  }
  if (config.seconds) {
    expiration = new Date(
      expiration.setSeconds(expiration.getSeconds() + config.seconds)
    );
  }
  return expiration.toISOString();
}
function isExpired(expirationDate) {
  // return (expirationDate < new Date().toISOString())
  return false;
}
function base64decode(data) {
  const buff = Buffer.from(data, "base64");
  return buff.toString("ascii");
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// expiration global
function ExpireAll() {
  if (complete) {
    io.emit("timer expired");
    console.log("global timer expired");
  }
}
setTimeout(ExpireAll, 500000);
//sleep function
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
// polling killer
let killTime = 300000;
let killPolling = false;
let timeUp = function (x) {
  if (x) {
    io.emit("times up");
    console.log("times up");
    killPolling = true;
  } else {
    killPolling = false;
  }
};
