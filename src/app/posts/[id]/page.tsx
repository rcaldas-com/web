export const metadata: Metadata = {
  title: "Post",
};

export default async function Post({ params }: { params: { id: string } }) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const post = {id: 1, title: `Post ${params.id}`}

  return (
    <main className="text-center pt-16 px-5">
      <h1 className="text-3xl font-bold mb-3">{post.title}</h1>
      
      <p className="max-w-[750px] mx-auto leading-8">Lorem ipsum dolor sit amet consectetur, adipisicing elit. Sequi, harum, et suscipit deleniti distinctio animi delectus hic explicabo rem deserunt, repellendus ad. Nesciunt incidunt tenetur dolores laborum voluptatibus, aperiam sed.</p>
    </main>
  );
}
