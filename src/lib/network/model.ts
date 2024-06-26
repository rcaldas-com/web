import mongoose, { Document, Schema, model } from 'mongoose';
import { unstable_noStore as noStore } from 'next/cache';
import { ObjectId } from 'mongodb';
import dbConnect from "../mongodb"


export interface IHost extends Document {
    _id?: Schema.ObjectId;
    name: string;
    type: string;
    os: string;
    ip: string;
    provider: string;
    tunnel: number;
    last: Date;
    bkp: Date;
    user: Schema.ObjectId;
}

const hostSchema = new Schema({
    name: { type: String, unique: true, index: true },
    type: { type: String },
    os: { type: String },
    ip: { type: String },
    provider: { type: String },
    tunnel: { type: Number, min: 1024, max: 65535 },
    last: { type: Date },
    bkp: { type: Date },
    user: { type: Schema.ObjectId, ref: 'User' },
}, { timestamps: true });

const Host = mongoose.models.host || model<IHost>('host', hostSchema)
export default Host

export async function fetchHostById(id: string) {
    noStore();
    try {
      new ObjectId(id);
    } catch (e) {
      return null;
    }
    try {


        await new Promise((resolve) => setTimeout(resolve, 2000));


        await dbConnect()
        const data = await Host.findById(id).exec()
        return { data }
    } catch (error: any) {
      console.error('Failed to fetch host:', error);
      return { error: error?.message }      
    }
  }
  


// await hosts.save();

// const instance = await Host.findOne({ /* ... */ });
// console.log(instance.my.key); // 'hello'





// const Comment = new Schema({
//     name: { type: String, default: 'hahaha' },
//     age: { type: Number, min: 18, index: true },
//     bio: { type: String, match: /[a-z]/ },
//     date: { type: Date, default: Date.now },
//     buff: Buffer
// });
  
// // a setter
// Comment.path('name').set(function(v) {
//     return capitalize(v);
// });

// // middleware
// Comment.pre('save', function(next) {
//     notify(this.get('email'));
//     next();
// });