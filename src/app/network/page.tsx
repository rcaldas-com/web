import HostList from "@/ui/network/host-list";
import Link from "next/link";
import { Suspense } from "react";
import { MdLibraryAdd } from "react-icons/md";


export const metadata: Metadata = {
  title: "Network",
};

export default async function NetworkPage() {

  return (
    <main className="text-center bg-white-100 pt-16 px-5">


      <h1 className="text-3xl font-bold mb-5 md:text-4xl">Network</h1>


      <div className="max-w-[700px] mx-auto bg-gray-100 py-4 rounded-xl"> 
        <div className="container mx-auto flex justify-center">
          <h2 className="text-xl md:text-2xl font-semibold">Hosts</h2>
          <Link href="/network/hosts/new" className=" ml-3 bg-blue-500 hover:bg-blue-700 text-white py-2 px-2 rounded-md">
            <MdLibraryAdd className="h-4 w-4" />
          </Link>
        </div>
        <hr className="max-w-[300px] mx-auto mt-2 mb-4" />
        <Suspense fallback={<div className="font-bold my-2">Loading Hosts...</div>}>
          <HostList />
        </Suspense>
      </div>

      <p className="max-w-[750px] mx-auto leading-8">Lorem ipsum dolor sit amet consectetur, adipisicing elit. Sequi, harum, et suscipit deleniti distinctio animi delectus hic explicabo rem deserunt, repellendus ad. Nesciunt incidunt tenetur dolores laborum voluptatibus, aperiam sed.</p>

    </main>
  );
}
