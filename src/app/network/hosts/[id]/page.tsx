import { Suspense } from "react";
import HostEdit from "@/ui/network/host-edit";
import Breadcrumbs from '@/ui/breadcrumbs';


export const metadata: Metadata = {
  title: "Host",
};

export default async function Host({ params }: { params: { id: string } }) {
  const id = params.id;

  return (
    <main className="text-center pt-4 px-16">
      <Breadcrumbs
        breadcrumbs={[
          { label: 'Network', href: '/network' },
          {
            label: 'Edit Host',
            href: `/network/hosts/${id}`,
            active: true,
          },
        ]}
      />

      <h1 className="text-xl md:text-2xl font-bold mb-3 pt-4">Host</h1>
      
      <Suspense fallback={<div>Loading...</div>}>
        <HostEdit id={id} />
      </Suspense>

    </main>
  );
}
