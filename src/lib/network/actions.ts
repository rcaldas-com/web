'use server'
import dbConnect from "../mongodb"
import Host from "./model"
import { unstable_noStore as noStore } from 'next/cache';
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"


export async function getHosts() {
    noStore()
    try {
        await dbConnect()
        const data = await Host.find()
        return { data }
    } catch (error: any) {
        return { error: error?.message }
    }
}

export async function createHost(formData: FormData) {
    const name = formData.get('name')
    try {
        await dbConnect()
        const data = await Host.create({ name })
    } catch (error: any) {
        return { error: error?.message }
    }
    revalidatePath('/network')
    redirect('/network')
}