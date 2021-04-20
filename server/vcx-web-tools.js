#!/usr/bin/env node

/*
Original Code From      : vcx-web-tools.js (Evernym's Verity UI customer-toolkit)
Studied and Modified by : Hyun Ji (Clara) Lee
Description             : This is vcx-web-tools.js, a server-side JavaScript code. 
                          The functions of vcx-web-tools.js are called from another
                          server-side code, vcx-server.js. 
                          Generally, vcx-web-tools.js interacts with /data folder
                          and its JSON files or creates different types of objects
                          such as Connection, Schema, CredentialDef, and Proof to
                          process various requests sent from the end-users. 
                          vcx-web-tools.js accesses /data folder either to open the
                          JSON files and retrieve data or to create a new JSON file
                          with new data.
                          Connection object is created for establishing connections
                          between the Certificate Authority and the students. Schema,
                          CredentialDef, and Proof objects are used for the processes
                          such as creating, sending, or verifying the transcripts.
*/

var vcx = require("node-vcx-wrapper");
var qr = require("qr-image");
var fs = require("fs-extra");
var ffi = require("ffi");
const base64url = require("base64url");
const crypto = require("crypto");
const path = require("path");

//vcx imports
const {
  Schema,
  Logger,
  CredentialDef,
  Connection,
  IssuerCredential,
  Proof,
  StateType,
  Error,
  rustAPI,
} = vcx;
// load up libsovtoken
async function run() {
  const myffi = ffi.Library("/usr/lib/libsovtoken.so", {
    sovtoken_init: ["void", []],
  });
  await myffi.sovtoken_init();
  await vcx.initVcx(config);
}
run();

// global vars
let config = "../config/vcx-config.json";

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
          console.log(JSON.parse(message));
          answer = JSON.parse(message["decryptedPayload"]["@msg"]);
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
  let state = await proof.getState();
  let timer = 0;
  while (state != StateType.RequestReceived && timer < 20) {
    console.log(`The state of the proof is ${state} and the timer is ${timer}`);
    await sleep(2000);
    await proof.updateState();
    state = await proof.getState();
    timer += 1;
    if (state == StateType.Accepted) {
      let proof_return = await proof.getProof(connection);
      console.log(`The proof was accepted, proof state is ${proof_return}`);
      break;
    } else if (state == StateType.Rejected) {
      let proof_return = await proof.getProof(connection);
      console.log(`The get proof state is ${proof_return}, and is REJECTED`);
      return 2;
    }
  }
  if (timer >= 20) {
    console.log(`The proof request has expired, and is INVALID`);
    return 4;
  }
  await proof.updateState();
  state = await proof.getState();
  let proof_return = await proof.getProof(connection);
  let proof_state = await proof_return.proofState;
  let rawProof = JSON.stringify(proof_return);
  console.log(JSON.stringify(rawProof));
  // return proof;
  let pdata = await proof.serialize();
  // Manual validation "for-reals" check
  let libindyproof = pdata["data"]["proof"]["libindy_proof"];
  console.log("libindy saved Proof is: ");
  console.log(libindyproof);
  let json_lbp = JSON.parse(libindyproof);
  
  // Modified by: Hyun Ji Lee (and Nick Zeman)
  // let revealed_attrs = json_lbp["requested_proof"]["revealed_attrs"];
  // let covid_results = revealed_attrs["credentialSubject.holder.outcome"];
  // console.log(covid_results);
  // if (covid_results["raw"] === "Negative") {
  //   return 2;
  // } else if (covid_results["raw"] === "IgM/IgG Positive") {
  //   return 1;
  // } else if (covid_results["raw"] === "IgM Positive or IgG Positive") {
  //   return 3;
  // } else {
  //   return 2;
  // }

  return proof_state;
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

// Enterprise or CLoud Wallet VCX Functions

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

// var StateType;
// (function (StateType) {
//     StateType[StateType["None"] = 0] = "None";
//     StateType[StateType["Initialized"] = 1] = "Initialized";
//     StateType[StateType["OfferSent"] = 2] = "OfferSent";
//     StateType[StateType["RequestReceived"] = 3] = "RequestReceived";
//     StateType[StateType["Accepted"] = 4] = "Accepted";
//     StateType[StateType["Unfulfilled"] = 5] = "Unfulfilled";
//     StateType[StateType["Expired"] = 6] = "Expired";
//     StateType[StateType["Revoked"] = 7] = "Revoked";
//     StateType[StateType["Redirected"] = 8] = "Redirected";
//     StateType[StateType["Rejected"] = 9] = "Rejected";
// })(StateType = exports.StateType || (exports.StateType = {}));
// //# sourceMappingURL=common.js.map

module.exports = {
  makeConnection,
  getConnection,
  storeConnection,
  createSchema,
  createCredentialDef,
  offerCredential,
  requestProof,
  askProvableQuestion,
  connectWithInvitation,
  searchConnectionsByTheirDid,
};
