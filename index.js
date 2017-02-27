#!/usr/bin/env node

"use strict"

const MongoClient = require('mongodb').MongoClient;
const fs = require('fs');
const _ = require("lodash");
const Mustache = require("mustache");
const path = require("path");

// const DB_URL = "mongo mongodb://hireme:fawcaukwen0Shnupperk@ds021046.mlab.com:21046/hireme-demo"
const DB_URL = "mongodb://hireme:SehrGeheim@ds029655.mlab.com:29655/hireme-dev"

const TEMPLATES = {
    index: fs.readFileSync(__dirname + '/templates/index.mustache', { encoding: "utf8" }),
    detail: fs.readFileSync(__dirname + '/templates/detail.mustache', { encoding: "utf8" }),
}

if (process.argv.length <= 2) {
    const path = process.argv[1].split("/");
    console.log("Usage: node " + _.last(path) + " <out-dir> [timespan in sec]");
    process.exit(1);
}

const OUT_DIR = process.argv[2]
const TIMESPAN = parseInt(process.argv[3]) * 1000

if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR);
}

// Connect to the db
MongoClient.connect(DB_URL).then((db) => {
    console.log("connected");

    const prof = db.collection("system.profile");
  
    process.stdout.write("Fetching data");

    return new Promise(resolve => {
        const arg = {
            "query.find": {
                $ne: "system.profile"
            }
        }

        if (TIMESPAN) {
            arg["ts"] = {
                $gt: new Date(new Date().getTime() - TIMESPAN),
            }
        }

        const stream = prof.find(arg).stream();
        
        const res = []

        stream.on("data", (q) => {
            process.stdout.write(".");
            if (q.docsExamined !== q.nreturned) {
                res.push(q);
            }
        });
        
        stream.on("end", () => {
            resolve(res);
        });
    });
}).then(queries => {
    console.log()
    process.stdout.write("Writing Files");

    queries = _.sortBy(queries, q => q.nreturned - q.docsExamined)

    const idxFile = OUT_DIR + "/index.html"
    for (const q of queries) {
        q.raw = JSON.stringify(q, null, 4);
        q.tsstr = JSON.stringify(q.ts)
        fs.writeFileSync(`${OUT_DIR}/${q.tsstr}.html`, Mustache.render(TEMPLATES.detail, q));
        process.stdout.write(".");
    }
    
    fs.writeFileSync(idxFile, Mustache.render(TEMPLATES.index, {
        queries: queries
    }));

    process.stdout.write(".");

    console.log();
    console.log(`Open: sensible-browser file://${path.resolve(idxFile)}`)
}).then(() => {
    console.log("Finished.");
    process.exit(0)
}).catch(e => {
    console.error(e);
    process.exit(1);
});