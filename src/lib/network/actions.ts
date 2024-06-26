'use server'

import dbConnect from "../mongodb"
import Host from "./model"

export async function getHosts() {
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
        return { data: true }
    } catch (error: any) {
        return { error: error?.message }
    }
}