#!/usr/bin/env node

"use strict"

const MongoClient = require('mongodb').MongoClient;
const fs = require('fs');
const _ = require("lodash");
const Mustache = require("mustache");
const path = require("path");

// const DB = "hireme-demo"
// const DB_URL = "mongo mongodb://hireme:fawcaukwen0Shnupperk@ds021046.mlab.com:21046/hireme-demo"

const DB = "hireme-dev"
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

let i = 0;

function hashQuery(query) {
    return Object.keys(query).sort().join("")
}

class Request {
    constructor(json) {
        this.json = json
        this.qHash = null
    }

    get queryHash() {
        if (this.qHash) {
            return this.qHash
        }

        this.qHash = this.json.op + this.collection

        if (this.json.op === "query") {
            const q = this.json.query;
            for (const k in q.sort) {
                this.qHash += k + q.sort[k]
            }

            this.qHash += hashQuery(q.filter)
        } else if (this.json.op === "command") {
            this.qHash += hashQuery(this.json.command.query)
        } else if (this.json.op === "update") {
            this.qHash += hashQuery(this.json.query)
        } else {
            console.error(this.json)
            this.qHash += (i++)
            return this.qHash
        }
        
        
        

        return this.qHash
    }

    get isIndexed() {
        return this.docsExamined !== this.nreturned
    }

    get nreturned() {
        return this.json.nreturned
    }

    get docsExamined() {
        return this.json.docsExamined
    }

    get collection() {
        return this.json.ns.substring(DB.length + 1)
    }

    get raw() {
        return JSON.stringify(this.json, null, 4)
    }

    get score() {
        return (this.nreturned || 0) - this.docsExamined
    }
}

class RequestGroup {
    constructor() {
        this.requests = []
    }

    push(r) {
        this.requests.push(r)
    }

    get avgScore() {
        return Math.round(_.reduce(this.requests, (sum, r) => sum + r.score, 0) / this.requests.length)
    }

    get medianScore() {
        return this.requests.map(r => r.score).sort()[parseInt(this.requests.length / 2)]
    }

    get minScore() {
        return _.min(this.requests.map(r => r.score))
    }

    get maxScore() {
        return _.max(this.requests.map(r => r.score))
    }

    get queryHash() {
        return this.requests[0].queryHash
    }

    get collection() {
        return this.requests[0].collection
    }
}

// Connect to the db
MongoClient.connect(DB_URL).then((db) => {
    console.log("connected");

    const prof = db.collection("system.profile");
  
    process.stdout.write("Fetching data");

    return new Promise(resolve => {
        const arg = {
            "ns": {
                $ne: DB + ".system.profile"
            }

        }

        if (TIMESPAN) {
            arg["ts"] = {
                $gt: new Date(new Date().getTime() - TIMESPAN),
            }
        }

        const stream = prof.find(arg).stream();
        
        const res = {}

        stream.on("data", (q) => {
            process.stdout.write(".");
            const r = new Request(q);
            if (r.isIndexed) {
                const h = r.queryHash;
                res[h] = res[h] || new RequestGroup()
                res[h].push(r)
            }
        });
        
        stream.on("end", () => {
            resolve(res);
        });
    });
}).then(queries => {
    console.log()
    process.stdout.write("Writing Files");

    const requestGroups = _.sortBy(Object.keys(queries).map(k => queries[k]), rg => rg.avgScore)

    const idxFile = OUT_DIR + "/index.html"
    for (const rg of requestGroups) {
        fs.writeFileSync(`${OUT_DIR}/${rg.queryHash}.html`, Mustache.render(TEMPLATES.detail, rg));
        process.stdout.write(".");
    }
    
    fs.writeFileSync(idxFile, Mustache.render(TEMPLATES.index, {
        requestGroups: requestGroups
    }));

    process.stdout.write(".");
    
    fs.writeFileSync(OUT_DIR + "/styles.css", fs.readFileSync(__dirname + "/styles.css"))

    console.log();
    console.log(`Open: sensible-browser file://${path.resolve(idxFile)}`)
}).then(() => {
    console.log("Finished.");
    process.exit(0)
}).catch(e => {
    console.error(e);
    process.exit(1);
});