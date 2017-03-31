#!/usr/bin/env node

"use strict"

const MongoClient = require('mongodb').MongoClient;
const fs = require('fs');
const _ = require("lodash");
const Mustache = require("mustache");
const path = require("path");

const TEMPLATES = {
    index: fs.readFileSync(__dirname + '/templates/index.mustache', { encoding: "utf8" }),
    detail: fs.readFileSync(__dirname + '/templates/detail.mustache', { encoding: "utf8" }),
}

if (process.argv.length <= 3) {
    const path = process.argv[1].split("/");
    console.log("Usage: node " + _.last(path) + " <mongo-url> <out-dir> [timespan in sec]");
    process.exit(1);
}

const DB_URL = process.argv[2]
const OUT_DIR = process.argv[3]
const TIMESPAN = parseInt(process.argv[4]) * 1000

const DB = _.last(DB_URL.split("/"))

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

    get filterAttrs() {
        let q;
        if (this.json.op === "query") {
            q = this.json.query.filter
        } else if (this.json.op === "command") {
            q = this.json.command.query
        } else if (this.json.op === "update") {
            q = this.json.query
        } else {
            return "";
        }

        return Object.keys(q).sort().join(", ")
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

            const h = hashQuery(q.filter);

            // dashboard requests without a filter
            if (h === "") {
                return null;
            }

            this.qHash += h
        } else if (this.json.op === "command") {
            if (!this.json.command.query || this.json.command.count) {
                return null;
            }
            this.qHash += hashQuery(this.json.command.query)
        } else if (this.json.op === "update") {
            this.qHash += hashQuery(this.json.query)
        } else if (this.json.op === "insert" || this.json.op === "remove") {
            return null;
        } else {
            console.error(this.json)
            this.qHash += (i++)
            return this.qHash
        }

        return this.qHash
    }

    get isIndexed() {
        return this.docsExamined === this.nreturned
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
        return (this.nreturned || this.nMatched || 0) - this.docsExamined
    }

    get ts() {
        return this.json.ts;
    }

    get containsCollScan() {
        let stage = this.json.execStats

        while (stage) {
            if (stage.stage === "COLLSCAN") {
                return true
            }
            stage = stage.inputStage
        }

        return false
    }
}

class RequestGroup {
    constructor() {
        this.requests = []
    }

    push(r) {
        this.requests.push(r)
    }

    get filterAttrs() {
        return this.requests[0].filterAttrs
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

    get lastOccurrence() {
        return _.max(this.requests.map(r => r.ts));
    }

    get firstOccurrence() {
        return _.min(this.requests.map(r => r.ts));
    }

    get someCollScan() {
        return _.some(this.requests, r => r.containsCollScan) && !this.allCollScan
    }

    get allCollScan() {
        return _.reduce(this.requests, (a, r) => a && r.containsCollScan, true)
    }

    get size() {
        return this.requests.length
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
            },
            "op": {
                $ne: "getmore"
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
            const h = r.queryHash;
            if (h) {
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

    const requestGroups = _.sortBy(Object.keys(queries).map(k => queries[k]).filter(k => k.avgScore !== 0), rg => rg.avgScore)

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
    console.log(`Open:`);
    console.log(`sensible-browser file://${path.resolve(idxFile)}`);
}).then(() => {
    console.log("Finished.");
    process.exit(0)
}).catch(e => {
    console.error(e);
    process.exit(1);
});