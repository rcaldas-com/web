import { fetchHostById } from '@/lib/network/model'
import { notFound } from 'next/navigation';
import Link from "next/link";
import TimeAgo from "../time-ago";

import { IHost } from "@/lib/network/model";


export default async function HostEdit({ id }: { id: string }) {
    const result = await fetchHostById(id);
    if (!result) {
        notFound();
    }
    const { data, error } = result;
    if (error) {
        return <h3 className="bg-red-500">{error}</h3>;
    }
    if (!data) {
        notFound();
    }
    return (
        <div className="max-w-[400px] mx-auto rounded-lg bg-white shadow-lg p-2">
            <Link href={`/network/hosts/${data._id}`}>
                <h3 className="text-xl">
                    {data.name} {data.last ? (<span> - <TimeAgo isoDate={data.last}/></span>) : ''}
                </h3>
            </Link>
        </div>
    );
}