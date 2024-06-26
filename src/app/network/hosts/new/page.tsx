import { createHost } from '@/lib/network/actions'
import Breadcrumbs from '@/ui/breadcrumbs';


export default function NewHostPage() {
    return (
        <main className="text-center pt-4 px-16">
            <Breadcrumbs
                breadcrumbs={[
                { label: 'Network', href: '/network' },
                {
                    label: 'New Host',
                    href: `/network/hosts/new`,
                    active: true,
                },
                ]}
            />

            <h1 className="text-xl md:text-2xl font-semibold mb-3 pt-4">New Host</h1>
            <form action={createHost} className="mt-6 h-6 space-x-2">
                <input
                    type="text"
                    name="name"
                    placeholder="Hostname"
                    className="h-full border border-gray-300 rounded-md px-3"
                    required
                />
                <button type="submit" className="h-full bg-blue-500 hover:bg-blue-700 text-white rounded-md px-3">Save</button>
            </form>

        </main>
    );
}