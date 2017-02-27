#!/usr/bin/env node

"use strict"

// Retrieve
const MongoClient = require('mongodb').MongoClient;

// const DB_URL = "mongo mongodb://hireme:fawcaukwen0Shnupperk@ds021046.mlab.com:21046/hireme-demo"
const DB_URL = "mongodb://hireme:SehrGeheim@ds029655.mlab.com:29655/hireme-dev"

// Connect to the db
MongoClient.connect(DB_URL).then((db) => {
  const prof = db.collection("system.profile");
  
  return new Promise(resolve => {
    const stream = prof.find().stream();
    
    stream.on("data", (q) => {
        if (q.docsExamined !== q.nreturned) {
            console.log(`${q.ns}   --   ${q.nreturned} / ${q.docsExamined}`);
            console.log(q.query);
            console.log();
        }
    });
    
    stream.on("end", () => resolve());
  });
}).then(() => {
    process.exit(0)
}).catch(e => {
    console.error(e);
    process.exit(1);
});