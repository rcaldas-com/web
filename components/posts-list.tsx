import Link from "next/link";

export default async function PostsList() {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const data = [{id: 1, title: 'Post 1'}, {id: 2, title: 'Post 2'}, {id: 3, title: 'Post 3'}]

    return (
        <ul>
            {data.map((post) => (
            <li key={post.id} className="mb-5">
                <Link href={`/posts/${post.id}`}>
                    <h2 className="text-xl font-bold mb-3">{post.title}</h2>
                </Link>

                {/* <p>{post.body}</p> */}
            </li>
            ))}
        </ul>
    );
}