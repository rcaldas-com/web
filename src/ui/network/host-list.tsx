import Link from "next/link";
import { getHosts } from "@/lib/network/actions"; 
import { IHost } from "@/lib/network/model";
import TimeAgo from "../time-ago";


export default async function HostList() {


    await new Promise((resolve) => setTimeout(resolve, 2000));


    const { data, error } = await getHosts()
    if (error) return <h3 className="bg-red-500">{error}</h3>
    return (
        <ul>
            {data.map((host: IHost) => (
                <li key={host._id} className="mb-2">
                    <div className="max-w-[400px] mx-auto rounded-lg bg-white shadow-lg p-2">
                        <Link href={`/network/hosts/${host._id}`}>
                            <h3 className="text-xl">
                                {host.name} {host.last ? (<span> - <TimeAgo isoDate={host.last}/></span>) : ''}
                            </h3>
                        </Link>
                    </div>
                </li>
            ))}
        </ul>
    );
}