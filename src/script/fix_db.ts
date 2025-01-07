import mongoose from "mongoose"
import dbConnect from "../lib/mongodb"
import Host from "../lib/network/model"


async function find(name: string, query: object): Promise<any[]> {
    const collection = mongoose.connection.db.collection(name);
    return collection.find(query).toArray();
}

async function fixHosts() {
    try {
        await dbConnect()
        const hosts = await find('host', {});
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
            await new Host(host).save();
        }

        // hostCol.drop()
    } catch (error) {
        console.error('Error fixing hosts', error);
    }
}

fixHosts();