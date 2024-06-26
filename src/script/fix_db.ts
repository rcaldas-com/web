import mongoose from "mongoose"
import dbConnect from "../lib/mongodb"
import Host from "../lib/network/model"


function find (name, query, cb) {
    mongoose.connection.db.collection(name, function (err, collection) {
       collection.find(query).toArray(cb);
   });
}

async function fixHosts() {
    try {
        await dbConnect()
        const hostCol = mongoose.connection.db.collection('host')        
        const hosts = await hostCol.find().toArray()
        for (let i of hosts) {
            const host = {
                name: i.name,
                type: i.type,
                os: i.os,
                ip: i.info?.ip,
                provider: i.provider,
                tunnel: i.net?.port || undefined,
                last: i.last,
                bkp: i.bkp?.last,
            }
            new Host(host).save()
        }

        hostCol.drop()
    } catch (error) {
        console.error(error)
    }
}

async function main() {
    fixHosts()
}

main()